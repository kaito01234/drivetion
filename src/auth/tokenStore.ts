/**
 * アクセストークンの保持。
 * iPhone のホーム画面アプリは閉じると sessionStorage が消えるため localStorage に保存する
 * (有効期限内なら再起動後もログインし直さずに済む)。
 */
const KEY = 'drivetion.token'
const LOGGED_IN_KEY = 'drivetion.hasLoggedIn'

/** 失効の少し前から「期限切れ」として扱う */
const EXPIRY_MARGIN_MS = 60_000

export interface StoredToken {
  accessToken: string
  /** epoch ms */
  expiresAt: number
}

export function loadToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as StoredToken
    if (typeof t.accessToken !== 'string' || typeof t.expiresAt !== 'number') return null
    return t
  } catch {
    return null
  }
}

export function saveToken(accessToken: string, expiresInSec: number): StoredToken {
  const t: StoredToken = { accessToken, expiresAt: Date.now() + expiresInSec * 1000 }
  try {
    localStorage.setItem(KEY, JSON.stringify(t))
    localStorage.setItem(LOGGED_IN_KEY, '1')
  } catch {
    /* ストレージが使えなくてもメモリ上で動作は継続する */
  }
  return t
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}

export function isTokenValid(t: StoredToken | null): t is StoredToken {
  return !!t && t.expiresAt - EXPIRY_MARGIN_MS > Date.now()
}

/** 失効扱いになるまでの残り時間(ms) */
export function msUntilExpiry(t: StoredToken): number {
  return t.expiresAt - EXPIRY_MARGIN_MS - Date.now()
}

export function hasLoggedInBefore(): boolean {
  try {
    return localStorage.getItem(LOGGED_IN_KEY) === '1'
  } catch {
    return false
  }
}

export function forgetLogin(): void {
  try {
    localStorage.removeItem(LOGGED_IN_KEY)
  } catch {
    /* noop */
  }
}
