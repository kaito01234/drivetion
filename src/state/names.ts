/** 一覧では拡張子を省いて表示し、作成・名前変更時は .md を自動で付ける */
export function displayName(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, '')
}

export function toFileName(input: string): string {
  const name = input.trim()
  return /\.(md|markdown)$/i.test(name) ? name : `${name}.md`
}

export function validateName(input: string): string | null {
  const name = input.trim()
  if (!name) return '名前を入力してください'
  if (/[/\\]/.test(name)) return '「/」「\\」は使えません'
  if (name.length > 200) return '名前が長すぎます'
  return null
}
