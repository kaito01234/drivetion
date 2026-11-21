import { useSyncExternalStore } from 'react'
import { useAuth } from '../auth/session'
import type { FileSession } from '../sync/autosave'

const EMPTY = () => () => {}

export function SaveStatus({ session, onRetry }: { session: FileSession | null; onRetry: () => void }) {
  const auth = useAuth()
  const snap = useSyncExternalStore(
    session?.subscribe ?? EMPTY,
    session ? session.getSnapshot : () => null,
  )
  if (!snap) return null

  let cls = 'save-status'
  let text: string
  switch (snap.status) {
    case 'saved':
      text = snap.lastSavedAt ? '保存済み' : '変更なし'
      cls += ' ok'
      break
    case 'dirty':
      text = '未保存の変更'
      break
    case 'saving':
      text = auth.status === 'needsRelogin' ? '再ログイン待ち' : '保存中…'
      cls += auth.status === 'needsRelogin' ? ' warn' : ''
      break
    case 'conflict':
      text = '競合'
      cls += ' error'
      break
    case 'error':
      text = '保存エラー'
      cls += ' error'
      break
  }

  return (
    <span className={cls} role="status" title={snap.error ?? undefined}>
      <span className="dot" aria-hidden />
      {text}
      {snap.status === 'error' && (
        <button className="btn small" onClick={onRetry}>
          再試行
        </button>
      )}
    </span>
  )
}
