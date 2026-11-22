import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../auth/session'
import type { FileSession } from '../sync/autosave'

const EMPTY = () => () => {}

export function SaveStatus({ session, onRetry }: { session: FileSession | null; onRetry: () => void }) {
  const auth = useAuth()
  const snap = useSyncExternalStore(
    session?.subscribe ?? EMPTY,
    session ? session.getSnapshot : () => null,
  )
  // ほかの端末の変更を取り込んだ直後は、数秒だけそのことを表示する
  const lastMergedAt = snap?.lastMergedAt ?? null
  const [showMerged, setShowMerged] = useState(false)
  useEffect(() => {
    if (!lastMergedAt) return
    setShowMerged(true)
    const t = setTimeout(() => setShowMerged(false), 4000)
    return () => clearTimeout(t)
  }, [lastMergedAt])

  if (!snap) return null

  let cls = 'save-status'
  let text: string
  switch (snap.status) {
    case 'saved':
      text = showMerged ? '他の端末の変更を反映' : snap.lastSavedAt ? '保存済み' : '変更なし'
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
