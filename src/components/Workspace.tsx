import { useCallback, useEffect, useState } from 'react'
import { auth } from '../auth/session'
import {
  createMarkdownFile,
  listMarkdownFiles,
  renameFile,
  trashFile,
  type DriveFile,
} from '../drive/files'
import { forgetFolder, resolveFolder, type FolderInfo } from '../drive/folder'
import { errorMessage } from '../state/format'
import { displayName, toFileName } from '../state/names'
import { useMediaQuery } from '../state/useMediaQuery'
import { EditorPane } from './EditorPane'
import { FileList } from './FileList'
import { FolderSetup } from './FolderSetup'
import { NameDialog } from './NameDialog'

type Dialog = { kind: 'create' } | { kind: 'rename'; file: DriveFile } | null

const sortByModified = (a: DriveFile, b: DriveFile) => b.modifiedTime.localeCompare(a.modifiedTime)

export function Workspace() {
  const isWide = useMediaQuery('(min-width: 768px)')

  // undefined = 確認中, null = 未作成
  const [folder, setFolder] = useState<FolderInfo | null | undefined>(undefined)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [files, setFiles] = useState<DriveFile[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list')
  const [dialog, setDialog] = useState<Dialog>(null)

  const loadFolder = useCallback(async () => {
    setFolderError(null)
    setFolder(undefined)
    try {
      setFolder(await resolveFolder())
    } catch (e) {
      setFolderError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void loadFolder()
  }, [loadFolder])

  const refreshList = useCallback(async () => {
    if (!folder) return
    setListLoading(true)
    setListError(null)
    try {
      setFiles(await listMarkdownFiles(folder.id))
    } catch (e) {
      setListError(errorMessage(e))
    } finally {
      setListLoading(false)
    }
  }, [folder])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  // iPhone: 一覧 ⇔ エディタの切り替えをブラウザの「戻る」と連動させる
  useEffect(() => {
    const onPop = () => setMobileView('list')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const selectFile = useCallback(
    (file: DriveFile) => {
      setSelectedId(file.id)
      if (!isWide && mobileView === 'list') {
        history.pushState({ view: 'editor' }, '')
        setMobileView('editor')
      }
    },
    [isWide, mobileView],
  )

  const backToList = useCallback(() => {
    if (history.state?.view === 'editor') history.back()
    else setMobileView('list')
  }, [])

  /** 保存などで変わったファイル情報を一覧に反映する */
  const upsertFile = useCallback((file: DriveFile) => {
    setFiles((prev) => [file, ...prev.filter((f) => f.id !== file.id)].sort(sortByModified))
  }, [])

  async function handleCreate(name: string) {
    const file = await createMarkdownFile(folder!.id, toFileName(name), '')
    upsertFile(file)
    setDialog(null)
    selectFile(file)
  }

  async function handleRename(file: DriveFile, name: string) {
    const updated = await renameFile(file.id, toFileName(name))
    upsertFile(updated)
    setDialog(null)
  }

  async function handleDelete(file: DriveFile) {
    if (!confirm(`「${displayName(file.name)}」をゴミ箱に移動しますか?`)) return
    try {
      await trashFile(file.id)
      setFiles((prev) => prev.filter((f) => f.id !== file.id))
      if (selectedId === file.id) {
        setSelectedId(null)
        if (!isWide) backToList()
      }
    } catch (e) {
      alert(`削除できませんでした: ${errorMessage(e)}`)
    }
  }

  if (folderError) {
    return (
      <div className="center-screen">
        <div className="card">
          <p className="error-text">{folderError}</p>
          <button className="btn primary" onClick={() => void loadFolder()}>
            再試行
          </button>
        </div>
      </div>
    )
  }
  if (folder === undefined) return <div className="center-screen muted">フォルダを確認中…</div>
  if (folder === null) return <FolderSetup onReady={setFolder} />

  const selectedFile = files.find((f) => f.id === selectedId) ?? null
  const showList = isWide || mobileView === 'list'
  const showEditor = isWide || mobileView === 'editor'

  return (
    <div className={`workspace ${isWide ? 'wide' : 'narrow'}`}>
      {showList && (
        <FileList
          folderName={folder.name}
          files={files}
          loading={listLoading}
          error={listError}
          selectedId={selectedId}
          onSelect={selectFile}
          onCreate={() => setDialog({ kind: 'create' })}
          onRename={(file) => setDialog({ kind: 'rename', file })}
          onDelete={(file) => void handleDelete(file)}
          onRefresh={() => void refreshList()}
          onLogout={() => {
            if (!confirm('ログアウトしますか?')) return
            forgetFolder()
            auth.logout()
          }}
        />
      )}
      {showEditor && <EditorPane file={selectedFile} showBack={!isWide} onBack={backToList} />}

      {dialog?.kind === 'create' && (
        <NameDialog
          title="新しいメモ"
          initialValue={defaultNewName()}
          submitLabel="作成"
          onSubmit={handleCreate}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title="名前を変更"
          initialValue={displayName(dialog.file.name)}
          submitLabel="変更"
          onSubmit={(name) => handleRename(dialog.file, name)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function defaultNewName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} メモ`
}
