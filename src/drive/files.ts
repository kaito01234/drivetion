/** Drive 上の Markdown ファイル操作 */
import { DRIVE_API, DRIVE_UPLOAD_API, driveFetch, driveJson } from './client'

export const MARKDOWN_MIME = 'text/markdown'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
  /** ファイルの変更(内容・名前など)ごとに増える番号。文字列で返る */
  version: string
  /** 内容の MD5。内容が同じなら同じ値になる */
  md5Checksum?: string
}

export const FILE_FIELDS = 'id,name,modifiedTime,version,md5Checksum'

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

export async function listMarkdownFiles(folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      orderBy: 'modifiedTime desc',
      pageSize: '1000',
      spaces: 'drive',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await driveJson<{ files: DriveFile[]; nextPageToken?: string }>(
      `${DRIVE_API}/files?${params}`,
    )
    files.push(...res.files)
    pageToken = res.nextPageToken
  } while (pageToken)
  // Drive のクエリでは拡張子の後方一致ができないため、ここで絞り込む
  return files.filter((f) => isMarkdownName(f.name))
}

export async function getFileMeta(fileId: string): Promise<DriveFile> {
  return driveJson<DriveFile>(`${DRIVE_API}/files/${fileId}?fields=${FILE_FIELDS}`)
}

export async function getFileContent(fileId: string): Promise<string> {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`)
  return res.text()
}

function multipartBody(metadata: object, content: string, contentType: string) {
  const boundary = `drivetion-${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`
  return { body, contentType: `multipart/related; boundary=${boundary}` }
}

export async function createMarkdownFile(
  folderId: string,
  name: string,
  content = '',
): Promise<DriveFile> {
  const { body, contentType } = multipartBody(
    { name, mimeType: MARKDOWN_MIME, parents: [folderId] },
    content,
    `${MARKDOWN_MIME}; charset=UTF-8`,
  )
  return driveJson<DriveFile>(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
    { method: 'POST', headers: { 'Content-Type': contentType }, body },
  )
}

export async function updateFileContent(fileId: string, content: string): Promise<DriveFile> {
  return driveJson<DriveFile>(
    `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media&fields=${FILE_FIELDS}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': `${MARKDOWN_MIME}; charset=UTF-8` },
      body: content,
    },
  )
}

export async function renameFile(fileId: string, name: string): Promise<DriveFile> {
  return driveJson<DriveFile>(`${DRIVE_API}/files/${fileId}?fields=${FILE_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

/** ゴミ箱へ移動(完全削除はしない) */
export async function trashFile(fileId: string): Promise<void> {
  await driveFetch(`${DRIVE_API}/files/${fileId}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}
