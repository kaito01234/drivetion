/**
 * リダイレクト方式の OAuth(implicit flow, response_type=token)。
 * iPhone のホーム画面アプリで GIS のポップアップが戻ってこない場合の代替手段。
 * VITE_AUTH_MODE=auto|redirect のときだけ使われる。
 * 利用する場合は、Google Cloud の「承認済みのリダイレクト URI」にアプリの URL(末尾 /)を登録する。
 */
import { CLIENT_ID, DRIVE_SCOPE } from './config'

const STATE_KEY = 'drivetion.oauthState'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

export function redirectUri(): string {
  return `${location.origin}/`
}

export function startRedirectLogin(prompt: '' | 'consent'): void {
  const state = crypto.randomUUID()
  localStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state,
  })
  if (prompt) params.set('prompt', prompt)
  location.assign(`${AUTH_ENDPOINT}?${params.toString()}`)
}

export type RedirectResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; error: string }

/** 起動時に URL フラグメントを確認し、リダイレクトから戻ってきた結果を取り出す */
export function consumeRedirectResult(): RedirectResult | null {
  if (!location.hash || location.hash.length < 2) return null
  const params = new URLSearchParams(location.hash.slice(1))
  if (!params.has('access_token') && !params.has('error')) return null

  // URL からトークンを消す
  history.replaceState(history.state, '', location.pathname + location.search)

  const expected = localStorage.getItem(STATE_KEY)
  localStorage.removeItem(STATE_KEY)
  if (!expected || params.get('state') !== expected) {
    return { ok: false, error: 'ログイン応答の検証に失敗しました(state 不一致)' }
  }
  const error = params.get('error')
  if (error) return { ok: false, error: `ログインに失敗しました: ${error}` }

  const granted = (params.get('scope') ?? '').split(' ')
  if (!granted.includes(DRIVE_SCOPE)) {
    return { ok: false, error: 'Google ドライブへのアクセスが許可されませんでした' }
  }
  return {
    ok: true,
    accessToken: params.get('access_token')!,
    expiresIn: Number(params.get('expires_in') ?? '3600'),
  }
}
