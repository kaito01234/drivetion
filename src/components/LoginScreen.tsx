import { auth, useAuth } from '../auth/session'

export function LoginScreen() {
  const { busy, error } = useAuth()
  return (
    <div className="center-screen">
      <div className="card">
        <h1>Memo</h1>
        <p className="muted">Google ドライブに保存する Markdown メモ</p>
        <button className="btn primary" onClick={() => auth.login()} disabled={busy}>
          {busy ? 'ログイン中…' : 'Google でログイン'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  )
}
