/**
 * 認証状態の管理。
 *
 * - getAccessToken(): 有効なトークンを返す。失効している場合は、再取得できるまで待つ
 *   (API 呼び出しは失敗させずに待機させ、再ログイン後にそのままやり直す)
 * - PC のブラウザ: 再取得が必要になったら、まず自動でポップアップを試す。ブロックされたらボタンを表示する
 * - ホーム画面アプリ(iPhone): 自動ではポップアップを開かず、「再ログイン」ボタンを表示する
 */
import { useSyncExternalStore } from 'react'
import { CLIENT_ID, isStandalone, useRedirectFlow } from './config'
import { initGis, requestToken, revokeToken, type TokenResult } from './gis'
import { consumeRedirectResult, startRedirectLogin } from './redirect'
import {
  clearToken,
  forgetLogin,
  hasLoggedInBefore,
  isTokenValid,
  loadToken,
  msUntilExpiry,
  saveToken,
  type StoredToken,
} from './tokenStore'

export type AuthStatus = 'initializing' | 'signedOut' | 'signedIn' | 'needsRelogin'

export interface AuthSnapshot {
  status: AuthStatus
  /** ログイン操作中 */
  busy: boolean
  error: string | null
}

export class SignedOutError extends Error {
  constructor() {
    super('ログアウトしました')
  }
}

type Waiter = { resolve: (token: string) => void; reject: (e: Error) => void }

class AuthManager {
  private snap: AuthSnapshot = { status: 'initializing', busy: false, error: null }
  private listeners = new Set<() => void>()
  private waiters: Waiter[] = []
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private autoAttemptInFlight = false
  /** 自動再取得に失敗した(以後は利用者のボタン操作を待つ) */
  private autoAttemptFailed = false
  /** トークン(localStorage が使えない環境向けにメモリにも持つ) */
  private token: StoredToken | null = null

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = () => this.snap

  private set(patch: Partial<AuthSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  async init(): Promise<void> {
    if (!CLIENT_ID) {
      this.set({ status: 'signedOut', error: 'VITE_GOOGLE_CLIENT_ID が設定されていません' })
      return
    }

    const redirect = consumeRedirectResult()
    if (redirect?.ok) {
      this.token = saveToken(redirect.accessToken, redirect.expiresIn)
    } else if (redirect && !redirect.ok) {
      this.set({ error: redirect.error })
    }

    try {
      await initGis()
    } catch (e) {
      // リダイレクト方式なら GIS が無くてもログインできる
      if (!useRedirectFlow()) this.set({ error: (e as Error).message })
    }

    if (!this.token) this.token = loadToken()
    if (isTokenValid(this.token)) {
      this.set({ status: 'signedIn' })
      this.scheduleExpiry()
    } else if (hasLoggedInBefore()) {
      // 以前ログインしていたなら画面はそのまま出し、「再ログイン」ボタンで復帰させる
      this.set({ status: 'needsRelogin' })
    } else {
      this.set({ status: 'signedOut' })
    }

    // iPhone はバックグラウンド中にタイマーが止まるため、復帰時に有効期限を確認する
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkExpiry()
    })
  }

  /**
   * ログイン / 再ログイン。必ず利用者の操作(クリック・タップ)のハンドラから呼ぶこと。
   * ポップアップをブロックされないよう、この関数内では await より前に requestToken を呼ぶ。
   */
  login(): void {
    const prompt = hasLoggedInBefore() ? '' : 'consent'
    if (useRedirectFlow()) {
      this.set({ busy: true, error: null })
      startRedirectLogin(prompt)
      return
    }
    this.set({ busy: true, error: null })
    requestToken(prompt).then(
      (resp) => this.accept(resp),
      (e: Error) => this.set({ busy: false, error: e.message }),
    )
  }

  logout(): void {
    const t = this.token
    if (t) revokeToken(t.accessToken)
    this.token = null
    clearToken()
    forgetLogin()
    this.clearExpiryTimer()
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach((w) => w.reject(new SignedOutError()))
    this.set({ status: 'signedOut', busy: false, error: null })
  }

  /** いま有効なトークンを持っているか(バックグラウンドの確認処理で、再ログインを促さないために使う) */
  hasValidToken(): boolean {
    return this.snap.status === 'signedIn' && isTokenValid(this.token)
  }

  /** 有効なアクセストークンを返す。失効していれば再ログインされるまで待つ */
  getAccessToken(): Promise<string> {
    if (isTokenValid(this.token)) return Promise.resolve(this.token.accessToken)
    return this.waitForToken()
  }

  /** API が 401 を返したときに呼ぶ。そのトークンを捨て、新しいトークンを待つ */
  handleUnauthorized(rejectedToken: string): Promise<string> {
    if (this.token?.accessToken === rejectedToken) {
      this.token = null
      clearToken()
    }
    return this.getAccessToken()
  }

  private accept(resp: TokenResult) {
    this.token = saveToken(resp.access_token, Number(resp.expires_in) || 3600)
    this.autoAttemptFailed = false
    this.set({ status: 'signedIn', busy: false, error: null })
    this.scheduleExpiry()
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach((w) => w.resolve(this.token!.accessToken))
  }

  private waitForToken(): Promise<string> {
    if (this.snap.status === 'signedOut') return Promise.reject(new SignedOutError())
    const p = new Promise<string>((resolve, reject) => this.waiters.push({ resolve, reject }))

    if (this.autoAttemptInFlight) return p

    if (!isStandalone() && !useRedirectFlow() && !this.autoAttemptFailed && hasLoggedInBefore()) {
      // PC など: 自動でトークン再取得を試す(ブロックされたらボタン表示に切り替える)
      this.autoAttemptInFlight = true
      requestToken('').then(
        (resp) => {
          this.autoAttemptInFlight = false
          this.accept(resp)
        },
        () => {
          this.autoAttemptInFlight = false
          this.autoAttemptFailed = true
          this.set({ status: 'needsRelogin' })
        },
      )
    } else if (this.snap.status !== 'needsRelogin') {
      this.set({ status: 'needsRelogin' })
    }
    return p
  }

  private checkExpiry() {
    if (this.snap.status === 'signedIn' && !isTokenValid(this.token)) {
      // 期限切れを先に知らせる(次の API 呼び出しを待たずにボタンを出す)
      this.set({ status: 'needsRelogin' })
    }
  }

  private scheduleExpiry() {
    this.clearExpiryTimer()
    if (!this.token) return
    const ms = Math.max(0, msUntilExpiry(this.token))
    this.expiryTimer = setTimeout(() => this.checkExpiry(), Math.min(ms, 2 ** 31 - 1))
  }

  private clearExpiryTimer() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = null
  }
}

export const auth = new AuthManager()

export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(auth.subscribe, auth.getSnapshot)
}
