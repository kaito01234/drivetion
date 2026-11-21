/**
 * Google Identity Services(トークンモデル)の薄いラッパー。
 *
 * 注意: iPhone ではポップアップを利用者の操作の中で「同期的に」開く必要がある。
 * そのため requestToken() は await を挟まずに requestAccessToken() を呼べるよう、
 * 起動時に initGis() でクライアントを準備しておく。
 */
import { CLIENT_ID, DRIVE_SCOPE } from './config'

const GIS_SRC = 'https://accounts.google.com/gsi/client'

export type TokenResult = google.accounts.oauth2.TokenResponse

export class GisError extends Error {
  constructor(
    public readonly type: string,
    message: string,
  ) {
    super(message)
  }
}

let loadPromise: Promise<void> | null = null
let client: google.accounts.oauth2.TokenClient | null = null
let pending: { resolve: (r: TokenResult) => void; reject: (e: Error) => void } | null = null

function loadScript(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      loadPromise = null
      reject(new GisError('load_failed', 'Google のログイン用スクリプトを読み込めませんでした'))
    }
    document.head.appendChild(s)
  })
  return loadPromise
}

function settle(fn: (p: NonNullable<typeof pending>) => void) {
  const p = pending
  pending = null
  if (p) fn(p)
}

export async function initGis(): Promise<void> {
  if (client) return
  await loadScript()
  client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      if (resp.error) {
        settle((p) => p.reject(new GisError(resp.error, resp.error_description || resp.error)))
        return
      }
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
        settle((p) =>
          p.reject(
            new GisError(
              'scope_not_granted',
              'Google ドライブへのアクセスが許可されませんでした。同意画面でチェックを入れてください',
            ),
          ),
        )
        return
      }
      settle((p) => p.resolve(resp))
    },
    error_callback: (err) => {
      const msg =
        err.type === 'popup_failed_to_open'
          ? 'ログイン用のポップアップを開けませんでした'
          : err.type === 'popup_closed'
            ? 'ログインがキャンセルされました'
            : 'ログインに失敗しました'
      settle((p) => p.reject(new GisError(err.type, msg)))
    },
  })
}

export function isGisReady(): boolean {
  return client !== null
}

/**
 * トークンを要求する。利用者の操作から呼ぶ場合は、この関数より前に await を入れないこと。
 * @param prompt '' = 可能なら同意画面を省略 / 'consent' = 必ず同意画面を表示
 */
export function requestToken(prompt: '' | 'consent' | 'select_account'): Promise<TokenResult> {
  if (!client) return Promise.reject(new GisError('not_ready', 'ログインの準備ができていません'))
  // 前の要求が残っていれば打ち切る(GIS は応答を返さないことがある)
  settle((p) => p.reject(new GisError('superseded', 'ログインがキャンセルされました')))
  const promise = new Promise<TokenResult>((resolve, reject) => {
    pending = { resolve, reject }
  })
  client.requestAccessToken({ prompt })
  return promise
}

export function revokeToken(accessToken: string): void {
  try {
    google.accounts.oauth2.revoke(accessToken, () => {})
  } catch {
    /* noop */
  }
}
