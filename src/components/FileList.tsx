import { useState } from 'react'
import type { DriveFile } from '../drive/files'
import { formatDateTime } from '../state/format'
import { displayName } from '../state/names'

interface Props {
  folderName: string
  files: DriveFile[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (file: DriveFile) => void
  onCreate: () => void
  onRename: (file: DriveFile) => void
  onDelete: (file: DriveFile) => void
  onRefresh: () => void
  onLogout: () => void
}

export function FileList(props: Props) {
  const { files, loading, error, selectedId } = props
  const [menuFor, setMenuFor] = useState<string | null>(null)

  return (
    <aside className="file-list">
      <header className="pane-header">
        <h1 className="folder-name" title={props.folderName}>
          {props.folderName}
        </h1>
        <button className="btn icon" onClick={props.onRefresh} title="一覧を更新" aria-label="一覧を更新">
          ⟳
        </button>
        <button className="btn primary small" onClick={props.onCreate}>
          ＋ 新規
        </button>
      </header>

      {error && (
        <div className="list-message error-text">
          {error}
          <button className="btn small" onClick={props.onRefresh}>
            再試行
          </button>
        </div>
      )}
      {loading && files.length === 0 && <div className="list-message muted">読み込み中…</div>}
      {!loading && !error && files.length === 0 && (
        <div className="list-message muted">メモがありません。「＋ 新規」から作成してください。</div>
      )}

      <ul>
        {files.map((f) => (
          <li key={f.id} className={f.id === selectedId ? 'selected' : undefined}>
            <button className="file-item" onClick={() => props.onSelect(f)}>
              <span className="file-name">{displayName(f.name)}</span>
              <span className="file-date muted">{formatDateTime(f.modifiedTime)}</span>
            </button>
            <button
              className="btn icon file-menu-btn"
              aria-label="操作"
              onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}
            >
              ⋯
            </button>
            {menuFor === f.id && (
              <div className="file-menu">
                <button
                  className="btn small"
                  onClick={() => {
                    setMenuFor(null)
                    props.onRename(f)
                  }}
                >
                  名前を変更
                </button>
                <button
                  className="btn small danger"
                  onClick={() => {
                    setMenuFor(null)
                    props.onDelete(f)
                  }}
                >
                  削除
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <footer className="pane-footer">
        <button className="btn link small" onClick={props.onLogout}>
          ログアウト
        </button>
      </footer>
    </aside>
  )
}
