import { useState, type FormEvent } from 'react'
import { createFolder, type FolderInfo } from '../drive/folder'
import { errorMessage } from '../state/format'
import { validateName } from '../state/names'

/**
 * 初回のみ: 保存先フォルダを作成する。
 * スコープが drive.file のため、アプリが作成したフォルダだけを扱う。
 * 一度作れば、別の端末でも自動的に同じフォルダが使われる。
 */
export function FolderSetup({ onReady }: { onReady: (f: FolderInfo) => void }) {
  const [name, setName] = useState('Memo')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const v = validateName(name)
    if (v) return setError(v)
    setBusy(true)
    setError(null)
    try {
      onReady(await createFolder(name.trim()))
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <form className="card" onSubmit={handleSubmit}>
        <h1>保存先フォルダの作成</h1>
        <p className="muted">
          Google ドライブのマイドライブ直下にメモ用のフォルダを作成します。ほかの端末からログインしたときも、同じフォルダが自動で使われます。
        </p>
        <label className="field">
          <span>フォルダ名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? '作成中…' : 'フォルダを作成'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  )
}
