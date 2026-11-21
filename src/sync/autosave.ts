/**
 * 開いているファイル 1 つ分の保存を管理する。
 * - 入力が止まってから約 2 秒後に Drive へ保存する
 * - 保存処理は同時に 1 件だけ実行し、保存中に入力があれば完了後にもう一度保存する
 * - 編集のたびに IndexedDB へ下書きを書き、保存に成功したら消す
 */
import { DriveError } from '../drive/client'
import { getFileMeta, updateFileContent, type DriveFile } from '../drive/files'
import { errorMessage } from '../state/format'
import { deleteDraft, saveDraft } from './drafts'

export const AUTOSAVE_DELAY_MS = 2000
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

export interface SessionSnapshot {
  status: SaveStatus
  error: string | null
  lastSavedAt: number | null
  /** 競合が起きたとき、Drive 上の最新のファイル情報 */
  conflict: DriveFile | null
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

export class FileSession {
  private snap: SessionSnapshot
  private listeners = new Set<() => void>()
  private content: string
  /** Drive 上(base の版)と一致していることが分かっている内容 */
  private savedContent: string
  private base: Baseline
  private timer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private running: Promise<void> | null = null
  private disposed = false
  private forceSave = false

  constructor(
    private file: DriveFile,
    remoteContent: string,
    opts: {
      /** 復元した下書き(あれば) */
      draft?: { content: string; base: Baseline }
      onSaved?: (meta: DriveFile) => void
    } = {},
  ) {
    this.onSaved = opts.onSaved
    this.savedContent = remoteContent
    if (opts.draft) {
      this.content = opts.draft.content
      this.base = opts.draft.base
    } else {
      this.content = remoteContent
      this.base = { version: file.version, md5: file.md5Checksum }
    }
    this.snap = {
      status: this.isDirty ? 'dirty' : 'saved',
      error: null,
      lastSavedAt: null,
      conflict: null,
    }
    if (this.isDirty) this.schedule()
    window.addEventListener('online', this.handleOnline)
  }

  private onSaved?: (meta: DriveFile) => void

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

  /** 名前変更などでファイル情報が変わったとき */
  updateFileInfo(meta: DriveFile) {
    this.file = meta
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

  /** 自動保存してよい状態か(競合の解決待ちでは止める) */
  private canAutoSave(): boolean {
    return !this.disposed && this.snap.status !== 'conflict'
  }

  private async save(): Promise<void> {
    const snapshot = this.content
    this.set({ status: 'saving', error: null })
    try {
      // 競合検知: 保存の直前に Drive 上の版を確認し、開いた時点(前回の保存時点)から変わっていれば上書きしない
      const remote = await getFileMeta(this.file.id)
      if (remote.version !== this.base.version) {
        if (remote.md5Checksum && remote.md5Checksum === this.base.md5) {
          // 版は進んだが内容は同じ(名前変更など)。競合ではないので基準だけ更新する
          this.base = { version: remote.version, md5: remote.md5Checksum }
        } else {
          this.file = { ...this.file, name: remote.name }
          void this.writeDraft()
          this.set({ status: 'conflict', conflict: remote, error: null })
          return
        }
      }
      const meta = await updateFileContent(this.file.id, snapshot)
      this.afterSaved(meta, snapshot)
    } catch (e) {
      this.handleError(e)
    }
  }

  private afterSaved(meta: DriveFile, snapshot: string) {
    this.file = meta
    this.base = { version: meta.version, md5: meta.md5Checksum }
    this.savedContent = snapshot
    this.forceSave = false
    this.retryCount = 0
    this.onSaved?.(meta)
    if (this.isDirty) {
      // 保存中に入力があった。下書きを最新の基準で書き直して次の保存を予約する
      void this.writeDraft()
      this.set({ status: 'dirty', lastSavedAt: Date.now() })
      this.schedule()
    } else {
      void deleteDraft(this.file.id)
      this.set({ status: 'saved', error: null, lastSavedAt: Date.now() })
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
