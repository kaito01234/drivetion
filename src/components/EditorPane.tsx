import type { DriveFile } from '../drive/files'
import { displayName } from '../state/names'

interface Props {
  file: DriveFile | null
  showBack: boolean
  onBack: () => void
}

export function EditorPane({ file, showBack, onBack }: Props) {
  if (!file) {
    return (
      <main className="editor-pane empty">
        <p className="muted">左の一覧からメモを選択してください</p>
      </main>
    )
  }
  return (
    <main className="editor-pane">
      <header className="pane-header">
        {showBack && (
          <button className="btn icon" onClick={onBack} aria-label="一覧に戻る">
            ‹
          </button>
        )}
        <h2 className="editor-title">{displayName(file.name)}</h2>
      </header>
      <div className="editor-body muted">(エディタは次のステップで実装)</div>
    </main>
  )
}
