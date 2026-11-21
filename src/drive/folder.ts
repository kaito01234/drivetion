/**
 * 保存先フォルダの検出と作成。
 * アプリで作成したフォルダには appProperties の目印を付けておき、
 * 別の端末(PC と iPhone)でも同じフォルダを自動で見つけられるようにする。
 */
import { DRIVE_API, DriveError, driveJson } from './client'
import { FOLDER_MIME } from './files'

const STORAGE_KEY = 'drivetion.folder'
const MARKER_KEY = 'drivetionRoot'
const MARKER_VALUE = '1'

export interface FolderInfo {
  id: string
  name: string
}

function loadStored(): FolderInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as FolderInfo) : null
  } catch {
    return null
  }
}

export function storeFolder(f: FolderInfo): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f))
  } catch {
    /* noop */
  }
}

export function forgetFolder(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}

/** 保存済みのフォルダ ID、なければ目印付きフォルダを探す。見つからなければ null */
export async function resolveFolder(): Promise<FolderInfo | null> {
  const stored = loadStored()
  if (stored) {
    try {
      const meta = await driveJson<{ id: string; name: string; trashed: boolean }>(
        `${DRIVE_API}/files/${stored.id}?fields=id,name,trashed`,
      )
      if (!meta.trashed) {
        const info = { id: meta.id, name: meta.name }
        storeFolder(info)
        return info
      }
    } catch (e) {
      if (!(e instanceof DriveError) || (e.status !== 404 && e.status !== 403)) throw e
    }
    forgetFolder()
  }

  const params = new URLSearchParams({
    q: `mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='${MARKER_KEY}' and value='${MARKER_VALUE}' }`,
    fields: 'files(id,name)',
    // 複数端末で同時に作ってしまった場合も、最初に作られたものに揃える
    orderBy: 'createdTime',
    pageSize: '10',
    spaces: 'drive',
  })
  const res = await driveJson<{ files: FolderInfo[] }>(`${DRIVE_API}/files?${params}`)
  const found = res.files[0]
  if (found) {
    storeFolder(found)
    return found
  }
  return null
}

export async function createFolder(name: string): Promise<FolderInfo> {
  const folder = await driveJson<FolderInfo>(`${DRIVE_API}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      appProperties: { [MARKER_KEY]: MARKER_VALUE },
    }),
  })
  storeFolder(folder)
  return folder
}
