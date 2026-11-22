/**
 * 開いているファイル 1 つ分の保存と同期を管理する。
 * - 入力が止まってから約 2 秒後に Drive へ保存する
 * - 保存処理は同時に 1 件だけ実行し、保存中に入力があれば完了後にもう一度保存する
 * - 編集のたびに IndexedDB へ下書きを書き、保存に成功したら消す
 * - 保存の直前に Drive 上の版を確認し、ほかの端末で更新されていれば 3-way マージする。
 *   同じ箇所を両方で変更していて合成できないときだけ「競合」にする
 * - checkRemote(): ほかの端末での更新を取り込む(未保存の変更がなければそのまま反映、あればマージ)
 */
import { DriveError } from '../drive/client'
import { getFileContent, getFileMeta, updateFileContent, type DriveFile } from '../drive/files'
import { errorMessage } from '../state/format'
import { deleteDraft, saveDraft } from './drafts'
import { merge3 } from './merge'

export const AUTOSAVE_DELAY_MS = 2000
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

export interface SessionSnapshot {
  status: SaveStatus
  error: string | null
  lastSavedAt: number | null
  /** 競合が起きたとき、Drive 上の最新のファイル情報 */
  conflict: DriveFile | null
  /**
   * セッション側で内容を差し替えた回数(ほかの端末の更新を取り込んだ・マージした)。
   * 変わったらエディタを currentContent で作り直す
   */
  contentRevision: number
  /** 直近で、ほかの端末の変更を自動で取り込んだ時刻 */
  lastMergedAt: number | null
}

export interface Baseline {
  version: string
  md5?: string
}

/** ファイルごとの保存中の処理。別の画面で同じファイルを開き直すときに完了を待つ */
const inFlight = new Map<string, Promise<void>>()

export function waitForPendingSave(fileId: string): Promise<void> {
  return inFlight.get(fileId) ?? Promise.resolve()
}

/** 保存の直前に Drive 上の内容を取り込むときの結果 */
type MergeOutcome =
  | { kind: 'merged'; content: string; remote: DriveFile; remoteContent: string }
  | { kind: 'conflict'; remote: DriveFile }

export class FileSession {
  private snap: SessionSnapshot
  private listeners = new Set<() => void>()
  /** この端末の最新の内容 */
  private content: string
  /** base の版の Drive 上の内容(3-way マージの共通の祖先、未保存判定の基準) */
  private savedContent: string
  /** savedContent が base の版の内容だと確かに分かっているか */
  private baseKnown: boolean
  private base: Baseline
  private timer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private running: Promise<void> | null = null
  private checking = false
  private disposed = false
  private forceSave = false
  private onSaved?: (meta: DriveFile) => void
  /** エディタ上の最新の内容を取り出す(リスナーの遅延で未反映の入力を拾うため) */
  private pullFromEditor: () => string | null = () => null

  constructor(
    private file: DriveFile,
    remoteContent: string,
    opts: {
      /** 復元した下書き(あれば) */
      draft?: { content: string; base: Baseline; baseContent?: string }
      onSaved?: (meta: DriveFile) => void
    } = {},
  ) {
    this.onSaved = opts.onSaved
    if (opts.draft) {
      this.content = opts.draft.content
      this.base = opts.draft.base
      // 古い下書きには元の内容が無い。その場合はマージせず競合として扱う
      this.baseKnown = opts.draft.baseContent !== undefined
      this.savedContent = opts.draft.baseContent ?? remoteContent
    } else {
      this.content = remoteContent
      this.savedContent = remoteContent
      this.baseKnown = true
      this.base = { version: file.version, md5: file.md5Checksum }
    }
    this.snap = {
      status: this.isDirty ? 'dirty' : 'saved',
      error: null,
      lastSavedAt: null,
      conflict: null,
      contentRevision: 0,
      lastMergedAt: null,
    }
    if (this.isDirty) this.schedule()
    window.addEventListener('online', this.handleOnline)
  }

  get fileId() {
    return this.file.id
  }

  get isDirty() {
    return this.forceSave || this.content !== this.savedContent
  }

  get currentContent() {
    return this.content
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = () => this.snap

  private set(patch: Partial<SessionSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  setEditorBridge(pull: () => string | null) {
    this.pullFromEditor = pull
  }

  /** 名前変更などでファイル情報が変わったとき */
  updateFileInfo(meta: DriveFile) {
    this.file = { ...this.file, name: meta.name }
  }

  /** エディタで内容が変わったとき */
  edit(markdown: string) {
    if (this.disposed || markdown === this.content) return
    this.content = markdown
    if (this.snap.status === 'conflict') {
      // 競合の解決待ち: 保存はしないが、入力内容は下書きに残す
      void this.writeDraft()
      return
    }
    if (this.isDirty) {
      void this.writeDraft()
      if (this.snap.status !== 'saving') this.set({ status: 'dirty', error: null })
      this.schedule()
    } else {
      void deleteDraft(this.file.id)
      this.clearTimer()
      if (this.snap.status !== 'saving') this.set({ status: 'saved', error: null })
    }
  }

  /** エディタに残っている未反映の入力を取り込む */
  syncFromEditor() {
    const md = this.pullFromEditor()
    if (md != null) this.edit(md)
  }

  /** 待たずにすぐ保存する(画面切り替え・アプリが裏に回るときなど) */
  flush(): Promise<void> {
    this.clearTimer()
    if (this.running) {
      // 実行中の保存が終わったら、まだ差分があればもう一度保存する
      return this.running.then(() => (this.isDirty && this.canAutoSave() ? this.flush() : undefined))
    }
    if (!this.isDirty || !this.canAutoSave()) return Promise.resolve()
    const p = this.save().finally(() => {
      this.running = null
      if (inFlight.get(this.file.id) === p) inFlight.delete(this.file.id)
    })
    this.running = p
    inFlight.set(this.file.id, p)
    return p
  }

  /**
   * ほかの端末での更新を確認して取り込む(画面に戻ったとき・定期的に呼ぶ)。
   * 未保存の変更があるときは何もしない(次の自動保存でマージされる)。
   */
  async checkRemote(): Promise<void> {
    if (this.disposed || this.running || this.checking || this.snap.status === 'conflict') return
    this.syncFromEditor()
    if (this.isDirty) return
    this.checking = true
    try {
      const meta = await getFileMeta(this.file.id)
      if (meta.version === this.base.version) return
      if (meta.md5Checksum && meta.md5Checksum === this.base.md5) {
        this.base = { version: meta.version, md5: meta.md5Checksum }
        return
      }
      const remoteContent = await getFileContent(this.file.id)
      // 取得の途中でさらに更新された場合は、次の確認に回す
      const again = await getFileMeta(this.file.id)
      if (again.version !== meta.version) return
      // (await の間に状態が変わっている可能性があるので、もう一度確認する)
      if (this.disposed || this.running || this.isInConflict()) return

      // 待っている間に入力があったかもしれないので、取り込んでからマージする
      this.syncFromEditor()
      const merged = merge3(this.savedContent, remoteContent, this.content)
      if (merged === null) {
        void this.writeDraft()
        this.set({ status: 'conflict', conflict: meta, error: null })
        return
      }
      this.adoptRemote(meta, remoteContent)
      this.replaceContent(merged)
      this.onSaved?.(meta)
      this.afterContentChanged()
    } catch {
      // 確認は失敗しても次の機会にやり直せばよい(保存処理側でも確認する)
    } finally {
      this.checking = false
    }
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
    window.removeEventListener('online', this.handleOnline)
    this.listeners.clear()
  }

  /**
   * 競合の解決: 自分の内容で上書きする。
   * Drive 上の最新版を新しい基準にして保存する(その間にさらに更新されていれば、再び競合になる)。
   */
  resolveByOverwrite(): Promise<void> {
    const remote = this.snap.conflict
    if (this.snap.status !== 'conflict' || !remote) return Promise.resolve()
    this.base = { version: remote.version, md5: remote.md5Checksum }
    // 上書きを選んだので、Drive 上の内容をマージの祖先としては使わない
    this.baseKnown = false
    // 内容を元に戻していた場合でも、上書きを選んだのだから保存する
    this.forceSave = true
    this.set({ status: 'dirty', conflict: null, error: null })
    return this.flush()
  }

  /** 競合の解決: 自分の変更を破棄する。呼び出し側で Drive から読み込み直すこと */
  async resolveByDiscard(): Promise<void> {
    this.dispose()
    await deleteDraft(this.file.id)
  }

  private isInConflict(): boolean {
    return this.snap.status === 'conflict'
  }

  /** 自動保存してよい状態か(競合の解決待ちでは止める) */
  private canAutoSave(): boolean {
    return !this.disposed && this.snap.status !== 'conflict'
  }

  private async save(): Promise<void> {
    const snapshot = this.content
    this.set({ status: 'saving', error: null })
    try {
      let toSave = snapshot
      // 保存の直前に Drive 上の版を確認する
      const remote = await getFileMeta(this.file.id)
      if (remote.version !== this.base.version) {
        if (remote.md5Checksum && remote.md5Checksum === this.base.md5) {
          // 版は進んだが内容は同じ(名前変更など)。基準だけ更新する
          this.base = { version: remote.version, md5: remote.md5Checksum }
        } else {
          const outcome = await this.mergeWithRemote(remote, snapshot)
          if (outcome.kind === 'conflict') {
            this.file = { ...this.file, name: outcome.remote.name }
            void this.writeDraft()
            this.set({ status: 'conflict', conflict: outcome.remote, error: null })
            return
          }
          this.adoptRemote(outcome.remote, outcome.remoteContent)
          this.set({ lastMergedAt: Date.now() })
          toSave = outcome.content
          if (toSave === outcome.remoteContent && !this.forceSave) {
            // 自分の変更はすでに Drive 側に含まれていた。書き込みは不要
            this.afterSaved(outcome.remote, toSave, snapshot)
            return
          }
        }
      }
      const meta = await updateFileContent(this.file.id, toSave)
      this.afterSaved(meta, toSave, snapshot)
    } catch (e) {
      this.handleError(e)
    }
  }

  /** Drive 上の最新の内容を取得し、この端末の内容と 3-way マージする */
  private async mergeWithRemote(remote: DriveFile, local: string): Promise<MergeOutcome> {
    if (!this.baseKnown) return { kind: 'conflict', remote }
    let current = remote
    for (let i = 0; i < 3; i++) {
      const remoteContent = await getFileContent(this.file.id)
      const again = await getFileMeta(this.file.id)
      if (again.version === current.version) {
        const merged = merge3(this.savedContent, remoteContent, local)
        return merged === null
          ? { kind: 'conflict', remote: current }
          : { kind: 'merged', content: merged, remote: current, remoteContent }
      }
      // 取得中にさらに更新された。取り直す
      current = again
    }
    return { kind: 'conflict', remote: current }
  }

  /** Drive 上の版を新しい基準にする */
  private adoptRemote(meta: DriveFile, content: string) {
    this.file = meta
    this.base = { version: meta.version, md5: meta.md5Checksum }
    this.savedContent = content
    this.baseKnown = true
  }

  /** 内容をセッション側で差し替え、エディタに作り直しを知らせる */
  private replaceContent(next: string) {
    if (next === this.content) return
    this.content = next
    this.set({ contentRevision: this.snap.contentRevision + 1, lastMergedAt: Date.now() })
  }

  /**
   * @param saved Drive に書き込んだ(または既に Drive 上にあった)内容
   * @param snapshot 保存を始めた時点のこの端末の内容
   */
  private afterSaved(meta: DriveFile, saved: string, snapshot: string) {
    this.adoptRemote(meta, saved)
    this.forceSave = false
    this.retryCount = 0
    this.onSaved?.(meta)

    if (saved !== snapshot) {
      // ほかの端末の変更をマージして保存した。エディタにも反映する。
      // 保存中に入力があれば、それも取り込んでからマージする
      this.syncFromEditor()
      const next = merge3(snapshot, saved, this.content)
      if (next === null) {
        void this.writeDraft()
        this.set({ status: 'conflict', conflict: meta, error: null, lastSavedAt: Date.now() })
        return
      }
      this.replaceContent(next)
    }
    this.afterContentChanged(Date.now())
  }

  /** 内容・基準が変わった後に、保存状態と下書きを整える */
  private afterContentChanged(savedAt?: number) {
    const patch: Partial<SessionSnapshot> = savedAt ? { lastSavedAt: savedAt } : {}
    if (this.isDirty) {
      // まだ Drive に無い変更がある。下書きを最新の基準で書き直して次の保存を予約する
      void this.writeDraft()
      this.set({ ...patch, status: 'dirty', error: null })
      this.schedule()
    } else {
      void deleteDraft(this.file.id)
      this.set({ ...patch, status: 'saved', error: null })
    }
  }

  private handleError(e: unknown) {
    const msg = errorMessage(e)
    this.set({ status: 'error', error: msg })
    // ファイルが消えた・権限がない場合は自動では再試行しない(下書きは残る)
    if (e instanceof DriveError && (e.status === 404 || e.status === 403)) return
    const delay = RETRY_DELAYS_MS[Math.min(this.retryCount, RETRY_DELAYS_MS.length - 1)]
    this.retryCount++
    this.schedule(delay)
  }

  private writeDraft() {
    return saveDraft({
      fileId: this.file.id,
      fileName: this.file.name,
      content: this.content,
      baseVersion: this.base.version,
      baseMd5: this.base.md5,
      baseContent: this.baseKnown ? this.savedContent : undefined,
      updatedAt: Date.now(),
    })
  }

  private schedule(delay = AUTOSAVE_DELAY_MS) {
    if (this.disposed) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delay)
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private handleOnline = () => {
    if (this.snap.status === 'error') void this.flush()
  }
}
