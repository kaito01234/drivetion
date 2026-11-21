import { auth, useAuth } from '../auth/session'

/**
 * トークン失効時に表示する。ポップアップは利用者のタップから開く必要があるため、
 * 自動では開かずにボタンを置く(iPhone のホーム画面アプリ対策)。
 * 未保存の内容はこの間もブラウザ内に退避されている。
 */
export function ReloginBanner() {
  const { status, busy, error } = useAuth()
  if (status !== 'needsRelogin') return null
  return (
    <div className="relogin-banner" role="alert">
      <span>
        ログインの有効期限が切れました。未保存の内容はこの端末に一時保存されています。
        {error && <span className="error-text"> {error}</span>}
      </span>
      <button className="btn primary small" onClick={() => auth.login()} disabled={busy}>
        {busy ? 'ログイン中…' : '再ログイン'}
      </button>
    </div>
  )
}
