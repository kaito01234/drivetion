import { useRegisterSW } from 'virtual:pwa-register/react'

/** 新しいバージョンが配信されたら知らせる。適用は利用者の操作で行う(編集中の自動リロードを避ける) */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // 開きっぱなしでも更新に気付けるよう、1時間ごとに確認する
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000)
    },
  })

  if (!needRefresh) return null
  return (
    <div className="update-toast" role="status">
      <span>新しいバージョンがあります</span>
      <button className="btn small" onClick={() => setNeedRefresh(false)}>
        あとで
      </button>
      <button className="btn primary small" onClick={() => void updateServiceWorker(true)}>
        更新
      </button>
    </div>
  )
}
