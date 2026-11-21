import { useEffect, useRef, useState, type FormEvent } from 'react'
import { validateName } from '../state/names'

interface Props {
  title: string
  initialValue: string
  submitLabel: string
  onSubmit: (value: string) => Promise<void>
  onCancel: () => void
}

/** ファイル名・フォルダ名の入力ダイアログ */
export function NameDialog({ title, initialValue, submitLabel, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const v = validateName(value)
    if (v) return setError(v)
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value.trim())
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{title}</h2>
        <div className="name-input">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="done"
          />
          <span className="muted">.md</span>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? '処理中…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
