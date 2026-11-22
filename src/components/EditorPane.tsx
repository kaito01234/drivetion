import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { auth } from '../auth/session'
import { getFileContent, getFileMeta, type DriveFile } from '../drive/files'
import type { EditorHandle } from '../editor/MilkdownEditor'
import { FileSession, waitForPendingSave } from '../sync/autosave'
import { deleteDraft, loadDraft, type Draft } from '../sync/drafts'
import { errorMessage } from '../state/format'
import { displayName } from '../state/names'
import { ConflictDialog } from './ConflictDialog'
import { SaveStatus } from './SaveStatus'

// エディタ(ProseMirror + remark)は大きいので、一覧の表示を先に出せるよう遅延読み込みする
const MilkdownEditor = lazy(() =>
  import('../editor/MilkdownEditor').then((m) => ({ default: m.MilkdownEditor })),
)

interface Props {
  file: DriveFile | null
  showBack: boolean
  onBack: () => void
  /** 保存・再読み込みで最新になったファイル情報を一覧へ反映する */
  onFileUpdated: (meta: DriveFile) => void
}

export function EditorPane({ file, showBack, onBack, onFileUpdated }: Props) {
  if (!file) {
    return (
      <main className="editor-pane empty">
        <p className="muted">左の一覧からメモを選択してください</p>
      </main>
    )
  }
  return (
    <FileEditor
      key={file.id}
      file={file}
      showBack={showBack}
      onBack={onBack}
      onFileUpdated={onFileUpdated}
    />
  )
}

const noopSubscribe = () => () => {}

/** 開いている間、ほかの端末での更新を確認する間隔 */
const REMOTE_CHECK_INTERVAL_MS = 30_000

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'askRestore'; meta: DriveFile; remote: string; draft: Draft }
  | {
      kind: 'ready'
      session: FileSession
      initial: string
      editorKey: number
      /** エディタを作り直すときに、スクロール位置を引き継ぐ */
      scrollTop?: number
    }

function FileEditor({
  file,
  showBack,
  onBack,
  onFileUpdated,
}: {
  file: DriveFile
  showBack: boolean
  onBack: () => void
  onFileUpdated: (meta: DriveFile) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const editorRef = useRef<EditorHandle>(null)
  const sessionRef = useRef<FileSession | null>(null)
  const onFileUpdatedRef = useRef(onFileUpdated)
  onFileUpdatedRef.current = onFileUpdated
  const editorKeyRef = useRef(0)

  const startSession = useCallback(
    (meta: DriveFile, remote: string, draft?: Draft) => {
      sessionRef.current?.dispose()
      const session = new FileSession(meta, remote, {
        draft: draft
          ? {
              content: draft.content,
              base: { version: draft.baseVersion, md5: draft.baseMd5 },
              baseContent: draft.baseContent,
            }
          : undefined,
        onSaved: (m) => onFileUpdatedRef.current(m),
      })
      session.setEditorBridge(() => editorRef.current?.getMarkdown() ?? null)
      sessionRef.current = session
      editorKeyRef.current++
      setPhase({
        kind: 'ready',
        session,
        initial: draft ? draft.content : remote,
        editorKey: editorKeyRef.current,
      })
    },
    [],
  )

  /** Drive から読み込む。未保存の下書きがあれば復元するか確認する */
  const load = useCallback(async () => {
    setPhase({ kind: 'loading' })
    try {
      // 直前に同じファイルを編集していた場合、その保存が終わるのを待つ
      await waitForPendingSave(file.id)
      const meta = await getFileMeta(file.id)
      const [remote, draft] = await Promise.all([getFileContent(file.id), loadDraft(file.id)])
      onFileUpdatedRef.current(meta)
      if (draft && draft.content !== remote) {
        setPhase({ kind: 'askRestore', meta, remote, draft })
      } else {
        if (draft) void deleteDraft(file.id)
        startSession(meta, remote)
      }
    } catch (e) {
      setPhase({ kind: 'error', message: errorMessage(e) })
    }
  }, [file.id, startSession])

  useEffect(() => {
    void load()
  }, [load])

  // 名前変更などで一覧側のファイル情報が更新されたら、下書きのファイル名にも反映する
  useEffect(() => {
    sessionRef.current?.updateFileInfo(file)
  }, [file])

  /** エディタ上の最新内容を取り込んでから、すぐ保存する */
  const flushNow = useCallback(() => {
    const session = sessionRef.current
    if (!session) return Promise.resolve()
    session.syncFromEditor()
    return session.flush()
  }, [])

  // アプリが裏に回る・閉じられるときはすぐ保存する(iPhone は beforeunload が当てにならない)
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushNow()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void flushNow()
      if (sessionRef.current?.isDirty) e.preventDefault()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushNow)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushNow)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [flushNow])

  // 別のファイルに切り替えたとき: 残りを保存してから破棄する(失敗しても下書きは残る)
  useEffect(
    () => () => {
      const session = sessionRef.current
      if (!session) return
      void flushNow().finally(() => session.dispose())
    },
    [flushNow],
  )

  const session = phase.kind === 'ready' ? phase.session : null
  const conflict = useSyncExternalStore(
    session?.subscribe ?? noopSubscribe,
    () => session?.getSnapshot().conflict ?? null,
  )

  // ほかの端末の変更を取り込んだ(またはマージした)ら、エディタをその内容で作り直す
  const contentRevision = useSyncExternalStore(
    session?.subscribe ?? noopSubscribe,
    () => session?.getSnapshot().contentRevision ?? 0,
  )
  useEffect(() => {
    if (!session || contentRevision === 0) return
    const scrollTop = editorRef.current?.getScrollTop()
    editorKeyRef.current++
    setPhase((p) =>
      p.kind === 'ready' && p.session === session
        ? { ...p, initial: session.currentContent, editorKey: editorKeyRef.current, scrollTop }
        : p,
    )
  }, [session, contentRevision])

  // ほかの端末での更新を確認する: 画面に戻ったとき・オンラインに戻ったとき・表示中は定期的に
  useEffect(() => {
    if (!session) return
    const check = () => {
      // トークンが切れているときは確認しない(バックグラウンド処理で再ログインを促さない)
      if (document.visibilityState === 'visible' && auth.hasValidToken()) void session.checkRemote()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    const timer = setInterval(check, REMOTE_CHECK_INTERVAL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      clearInterval(timer)
    }
  }, [session])

  async function reloadDiscardingMine() {
    const s = sessionRef.current
    sessionRef.current = null
    if (s) await s.resolveByDiscard()
    await load()
  }

  return (
    <main className="editor-pane">
      <header className="pane-header">
        {showBack && (
          <button
            className="btn icon"
            onClick={() => {
              void flushNow()
              onBack()
            }}
            aria-label="一覧に戻る"
          >
            ‹
          </button>
        )}
        <h2 className="editor-title" title={file.name}>
          {displayName(file.name)}
        </h2>
        <SaveStatus session={session} onRetry={() => void session?.flush()} />
      </header>

      {phase.kind === 'loading' && <div className="editor-message muted">読み込み中…</div>}

      {phase.kind === 'error' && (
        <div className="editor-message">
          <p className="error-text">{phase.message}</p>
          <button className="btn" onClick={() => void load()}>
            再試行
          </button>
        </div>
      )}

      {phase.kind === 'askRestore' && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>未保存の内容があります</h2>
            <p>
              この端末に、Google ドライブへ保存されていない編集内容が残っています(
              {new Date(phase.draft.updatedAt).toLocaleString('ja-JP')})。復元しますか?
            </p>
            <div className="modal-actions">
              <button
                className="btn danger"
                onClick={() => {
                  void deleteDraft(file.id)
                  startSession(phase.meta, phase.remote)
                }}
              >
                破棄してドライブの内容を開く
              </button>
              <button
                className="btn primary"
                onClick={() => startSession(phase.meta, phase.remote, phase.draft)}
              >
                復元する
              </button>
            </div>
          </div>
        </div>
      )}

      {session && conflict && (
        <ConflictDialog
          remote={conflict}
          getMyContent={() => editorRef.current?.getMarkdown() ?? session.currentContent}
          onReload={() => void reloadDiscardingMine()}
          onOverwrite={() => {
            session.syncFromEditor()
            void session.resolveByOverwrite()
          }}
        />
      )}

      {phase.kind === 'ready' && (
        <Suspense fallback={<div className="editor-message muted">エディタを読み込み中…</div>}>
          <MilkdownEditor
            key={phase.editorKey}
            defaultValue={phase.initial}
            initialScrollTop={phase.scrollTop}
            onChange={(md) => phase.session.edit(md)}
            handleRef={editorRef}
          />
        </Suspense>
      )}
    </main>
  )
}
