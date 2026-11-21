/**
 * 未保存の内容をブラウザ内(IndexedDB)に一時保存する。
 * 再ログイン中・オフライン・アプリ終了時でも、入力した内容が失われないようにするため。
 * Drive への保存に成功したら削除する。
 */
import { createStore, del, get, set } from 'idb-keyval'

export interface Draft {
  fileId: string
  fileName: string
  content: string
  /** 下書きの元になった Drive 上の版(競合検知の基準) */
  baseVersion: string
  baseMd5?: string
  updatedAt: number
}

const store = createStore('memo-app', 'drafts')

export async function loadDraft(fileId: string): Promise<Draft | undefined> {
  try {
    return await get<Draft>(fileId, store)
  } catch {
    return undefined
  }
}

export async function saveDraft(draft: Draft): Promise<void> {
  try {
    await set(draft.fileId, draft, store)
  } catch {
    /* IndexedDB が使えない環境(プライベートブラウズ等)では諦める */
  }
}

export async function deleteDraft(fileId: string): Promise<void> {
  try {
    await del(fileId, store)
  } catch {
    /* noop */
  }
}
