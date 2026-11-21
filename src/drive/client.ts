/**
 * Drive API v3 を fetch で直接呼ぶための共通処理。
 * - Authorization ヘッダーの付与
 * - 401: トークンを再取得して同じリクエストをやり直す(再ログインが必要なら完了まで待つ)
 * - 429 / 5xx / レート制限の 403: 指数バックオフで再試行
 */
import { auth } from '../auth/session'

export const DRIVE_API = 'https://www.googleapis.com/drive/v3'
export const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

export class DriveError extends Error {
  constructor(
    /** HTTP ステータス。ネットワークエラーは 0 */
    public readonly status: number,
    message: string,
    public readonly reason?: string,
  ) {
    super(message)
  }
}

const MAX_AUTH_RETRIES = 2
const MAX_TRANSIENT_RETRIES = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function parseError(res: Response): Promise<DriveError> {
  let message = `Google ドライブの API エラー (${res.status})`
  let reason: string | undefined
  try {
    const body = (await res.json()) as {
      error?: { message?: string; errors?: { reason?: string }[] }
    }
    if (body.error?.message) message = body.error.message
    reason = body.error?.errors?.[0]?.reason
  } catch {
    /* JSON でない応答 */
  }
  if (res.status === 404) message = 'ファイルが見つかりません(削除された可能性があります)'
  return new DriveError(res.status, message, reason)
}

function isTransient(status: number, reason?: string): boolean {
  if (status === 429 || status >= 500) return true
  return status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')
}

export async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let authRetries = 0
  let transientRetries = 0
  let token = await auth.getAccessToken()

  for (;;) {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)

    let res: Response
    try {
      res = await fetch(url, { ...init, headers, cache: 'no-store' })
    } catch {
      throw new DriveError(0, 'ネットワークに接続できません')
    }

    if (res.status === 401 && authRetries < MAX_AUTH_RETRIES) {
      authRetries++
      token = await auth.handleUnauthorized(token)
      continue
    }

    if (!res.ok) {
      const err = await parseError(res)
      if (isTransient(err.status, err.reason) && transientRetries < MAX_TRANSIENT_RETRIES) {
        await sleep(2 ** transientRetries * 1000 + Math.random() * 500)
        transientRetries++
        continue
      }
      throw err
    }
    return res
  }
}

export async function driveJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await driveFetch(url, init)
  return (await res.json()) as T
}
