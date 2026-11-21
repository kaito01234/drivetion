import { CLIENT_ID } from './auth/config'
import { useAuth } from './auth/session'
import { LoginScreen } from './components/LoginScreen'
import { ReloginBanner } from './components/ReloginBanner'
import { Workspace } from './components/Workspace'

export function App() {
  const { status } = useAuth()

  if (!CLIENT_ID) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>設定が必要です</h1>
          <p>
            環境変数 <code>VITE_GOOGLE_CLIENT_ID</code> が設定されていません。README の手順に従って
            OAuth クライアント ID を設定し、ビルドし直してください。
          </p>
        </div>
      </div>
    )
  }

  if (status === 'initializing') {
    return <div className="center-screen muted">読み込み中…</div>
  }

  if (status === 'signedOut') return <LoginScreen />

  // signedIn / needsRelogin: 画面はそのまま表示し、再ログインはバナーから行う
  return (
    <>
      <ReloginBanner />
      <Workspace />
    </>
  )
}
