// Google(GIS と Drive API)をモックした E2E テスト。
// 使い方: README の「テスト」を参照
const { chromium, devices } = require('playwright')
const { createFake } = require('./fake-google.cjs')
const BASE = process.env.BASE || 'http://localhost:5173/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitUntil = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(100) } return false }
const assert = (c, msg) => { if (!c) throw new Error('ASSERT: ' + msg); console.log('  ok -', msg) }

async function setup(browser, ctxOpts = {}) {
  const fake = createFake()
  const ctx = await browser.newContext(ctxOpts)
  await ctx.route(/accounts\.google\.com|googleapis\.com|fake\.test/, (r) => fake.handle(r))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
  return { fake, ctx, page }
}

;(async () => {
  const browser = await chromium.launch()
  const shots = process.argv[2]
  // ---------- PC ----------
  console.log('PC flow')
  const { fake, page } = await setup(browser, { viewport: { width: 1200, height: 800 } })
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE)
  await page.getByRole('button', { name: 'Google でログイン' }).click()
  await page.getByRole('button', { name: 'フォルダを作成' }).click()
  await page.getByText('メモがありません').waitFor()
  assert([...fake.st.files.values()].some((f) => f.folder && f.appProperties.drivetionRoot === '1'), 'folder created with marker')

  await page.getByRole('button', { name: '＋ 新規' }).click()
  await page.locator('.modal input').fill('テスト')
  await page.getByRole('button', { name: '作成' }).click()
  await page.locator('.ProseMirror').waitFor()
  const file = [...fake.st.files.values()].find((f) => f.name === 'テスト.md')
  assert(file, 'file created as テスト.md')

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('# 見出し')
  await page.keyboard.press('Enter')
  await page.keyboard.type('本文です')
  await page.locator('.save-status', { hasText: '未保存の変更' }).waitFor()
  const before = fake.st.calls.filter((c) => c.startsWith('PATCH /upload')).length
  await sleep(1000)
  assert(fake.st.calls.filter((c) => c.startsWith('PATCH /upload')).length === before, 'not saved before 2s')
  await page.locator('.save-status', { hasText: '保存済み' }).waitFor({ timeout: 5000 })
  assert(file.content.includes('# 見出し') && file.content.includes('本文です'), 'content saved: ' + JSON.stringify(file.content))
  if (shots) await page.screenshot({ path: shots + '/pc.png' })

  // conflict -> overwrite
  fake.st.externalEdit(file.id, 'remote edit\n')
  await page.keyboard.type(' 追記A')
  await page.getByText('ほかの場所で更新されています').waitFor({ timeout: 5000 })
  assert(file.content === 'remote edit\n', 'remote content not overwritten automatically')
  if (shots) await page.screenshot({ path: shots + '/conflict.png' })
  await page.getByRole('button', { name: '上書き' }).click()
  await page.locator('.save-status', { hasText: '保存済み' }).waitFor({ timeout: 5000 })
  assert(file.content.includes('追記A'), 'overwrite saved local content')

  // conflict -> reload
  fake.st.externalEdit(file.id, '# リモート版\n')
  await page.locator('.ProseMirror').click()
  await page.keyboard.type(' 追記B')
  await page.getByText('ほかの場所で更新されています').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '再読み込み' }).click()
  await page.locator('.ProseMirror h1', { hasText: 'リモート版' }).waitFor()
  assert(file.content === '# リモート版\n', 'reload kept remote content')

  // rename (version change, same content) must not cause conflict
  await page.locator('.file-menu-btn').first().click()
  await page.getByRole('button', { name: '名前を変更' }).click()
  await page.locator('.modal input').fill('改名後')
  await page.getByRole('button', { name: '変更' }).click()
  await page.getByText('改名後').first().waitFor()
  assert(file.name === '改名後.md', 'renamed')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 改名後の編集')
  await page.locator('.save-status', { hasText: '保存済み' }).waitFor({ timeout: 6000 })
  assert(file.content.includes('改名後の編集'), 'saved after rename without conflict')

  // 401 -> auto re-acquire on PC, retry
  fake.st.force401 = 1
  const gisBefore = await page.evaluate(() => window.__gisRequests)
  await page.keyboard.type(' 401後')
  assert(await waitUntil(() => file.content.includes('401後')), 'saved after 401 + token refresh')
  assert((await page.evaluate(() => window.__gisRequests)) === gisBefore + 1, 'token re-requested once')

  // draft survives: block network, type, reload page -> restore prompt
  fake.st.force401 = 0
  fake.st.offline = true
  await page.keyboard.type(' オフライン入力')
  await page.locator('.save-status', { hasText: '保存エラー' }).waitFor({ timeout: 8000 })
  await page.reload()
  await page.getByRole('button', { name: '再試行' }).waitFor()
  fake.st.offline = false
  await page.getByRole('button', { name: '再試行' }).click()
  await page.getByText('未保存の内容があります').waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: '復元する' }).click()
  assert(await waitUntil(() => file.content.includes('オフライン入力')), 'draft restored and saved after reload')

  // delete
  await page.locator('.file-menu-btn').first().click()
  await page.getByRole('button', { name: '削除' }).click()
  await page.getByText('メモがありません').waitFor()
  assert(file.trashed, 'trashed')

  // ---------- iPhone (standalone simulation: no auto popup) ----------
  console.log('iPhone flow')
  const m = await setup(browser, { ...devices['iPhone 13'] })
  await m.page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }))
  m.page.on('dialog', (d) => d.accept())
  await m.page.goto(BASE)
  await m.page.getByRole('button', { name: 'Google でログイン' }).tap()
  await m.page.getByRole('button', { name: 'フォルダを作成' }).tap()
  await m.page.getByRole('button', { name: '＋ 新規' }).tap()
  await m.page.getByRole('button', { name: '作成' }).tap()
  await m.page.locator('.ProseMirror').waitFor()
  assert(await m.page.locator('.file-list').count() === 0, 'narrow: editor replaces list')
  await m.page.locator('.ProseMirror').tap()
  await m.page.keyboard.type('iPhone から')
  await m.page.locator('.save-status', { hasText: '保存済み' }).waitFor({ timeout: 5000 })
  if (shots) await m.page.screenshot({ path: shots + '/iphone-editor.png' })
  // token expiry -> banner, no auto popup
  m.fake.st.force401 = 1
  const g0 = await m.page.evaluate(() => window.__gisRequests)
  await m.page.keyboard.type(' 失効後')
  await m.page.getByRole('button', { name: '再ログイン' }).waitFor({ timeout: 6000 })
  assert((await m.page.evaluate(() => window.__gisRequests)) === g0, 'standalone: no automatic popup')
  await m.page.locator('.save-status', { hasText: '再ログイン待ち' }).waitFor()
  if (shots) await m.page.screenshot({ path: shots + '/iphone-relogin.png' })
  await m.page.getByRole('button', { name: '再ログイン' }).tap()
  const mf = [...m.fake.st.files.values()].find((f) => !f.folder)
  assert(await waitUntil(() => mf.content.includes('失効後')), 'saved after manual relogin')
  await m.page.locator('.save-status', { hasText: '保存済み' }).waitFor({ timeout: 6000 })
  await m.page.getByRole('button', { name: '一覧に戻る' }).tap()
  await m.page.locator('.file-list').waitFor()
  assert(await m.page.locator('.editor-pane').count() === 0, 'narrow: back to list')
  if (shots) await m.page.screenshot({ path: shots + '/iphone-list.png' })

  await browser.close()
  console.log('ALL PASSED')
})().catch((e) => { console.error(e); process.exit(1) })
