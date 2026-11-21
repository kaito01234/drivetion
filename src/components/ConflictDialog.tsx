import { useState } from 'react'
import type { DriveFile } from '../drive/files'

interface Props {
  remote: DriveFile
  getMyContent: () => string
  onReload: () => void
  onOverwrite: () => void
}

/**
 * 保存しようとしたら、開いた後に別の端末などで Drive 上のファイルが更新されていた。
 * 自動では上書きせず、利用者に選んでもらう。
 */
export function ConflictDialog({ remote, getMyContent, onReload, onOverwrite }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null)

  async function copyMine() {
    try {
      await navigator.clipboard.writeText(getMyContent())
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" aria-labelledby="conflict-title">
        <h2 id="conflict-title">ほかの場所で更新されています</h2>
        <p>
          このメモは開いた後に、別の端末などで更新されました(
          {new Date(remote.modifiedTime).toLocaleString('ja-JP')})。
          自動保存を止めています。どちらかを選んでください。
        </p>
        <ul className="conflict-choices">
          <li>
            <b>再読み込み</b>: ドライブ上の最新の内容を開きます。<span className="error-text">この端末での変更は破棄されます。</span>
          </li>
          <li>
            <b>上書き</b>: この端末の内容で保存します。<span className="error-text">ほかの場所での変更は失われます。</span>
          </li>
        </ul>
        <button className="btn link small align-start" onClick={() => void copyMine()}>
          この端末の内容をクリップボードにコピー
        </button>
        {copied === true && <p className="muted">コピーしました</p>}
        {copied === false && <p className="error-text">コピーできませんでした</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onReload}>
            再読み込み
          </button>
          <button className="btn primary" onClick={onOverwrite}>
            上書き
          </button>
        </div>
      </div>
    </div>
  )
}
