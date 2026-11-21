export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || ''

/** アプリが作成したファイル/フォルダだけにアクセスできる最小権限のスコープ */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export type AuthMode = 'popup' | 'auto' | 'redirect'
const rawMode = import.meta.env.VITE_AUTH_MODE
export const AUTH_MODE: AuthMode = rawMode === 'auto' || rawMode === 'redirect' ? rawMode : 'popup'

/** iPhone で「ホーム画面に追加」から起動しているか */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navigator.standalone === true
  )
}

/** このセッションでリダイレクト方式を使うか */
export function useRedirectFlow(): boolean {
  return AUTH_MODE === 'redirect' || (AUTH_MODE === 'auto' && isStandalone())
}
