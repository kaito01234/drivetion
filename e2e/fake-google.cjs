const crypto = require('crypto')
// In-memory fake of Drive v3 + GIS for e2e tests
function createFake() {
  const st = { files: new Map(), seq: 0, validTokens: new Set(), tokenSeq: 0, force401: 0, calls: [] }
  const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex')
  const meta = (f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, version: String(f.version), md5Checksum: f.folder ? undefined : md5(f.content) })
  const touch = (f) => { f.version++; f.modifiedTime = new Date(Date.now() + st.seq++).toISOString() }
  st.newFile = (o) => { const id = 'f' + (++st.seq); const f = { id, version: 1, modifiedTime: new Date().toISOString(), trashed: false, content: '', parents: [], appProperties: {}, ...o }; st.files.set(id, f); return f }
  st.externalEdit = (id, content) => { const f = st.files.get(id); f.content = content; touch(f) }

  const gisScript = `
    window.google = { accounts: { oauth2: {
      initTokenClient(cfg) { return { requestAccessToken(o) {
        window.__gisRequests = (window.__gisRequests||0)+1;
        fetch('https://fake.test/token').then(r=>r.json()).then(t => cfg.callback({ access_token: t.token, expires_in: 3600, scope: cfg.scope }))
      } } },
      hasGrantedAllScopes() { return true },
      revoke(t, cb) { cb && cb() },
    } } };`

  async function handle(route) {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    if (url.href.startsWith('https://accounts.google.com/gsi/client')) return route.fulfill({ contentType: 'text/javascript', body: gisScript })
    if (url.host === 'fake.test') { const t = 'tok' + (++st.tokenSeq); st.validTokens.add(t); return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ token: t }) }) }
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (st.offline && url.host.endsWith('googleapis.com')) return route.abort('internetdisconnected')
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const tok = (req.headers()['authorization'] || '').replace('Bearer ', '')
    st.calls.push(method + ' ' + url.pathname + url.search)
    if (st.force401 > 0 || !st.validTokens.has(tok)) { if (st.force401 > 0) { st.force401--; st.validTokens.delete(tok) } return json(401, { error: { message: 'Invalid Credentials' } }) }

    const p = url.pathname
    let m
    if (p === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q')
      let list = [...st.files.values()].filter((f) => !f.trashed)
      if (q.includes('appProperties has')) list = list.filter((f) => f.folder && f.appProperties.memoAppRoot === '1')
      const pm = q.match(/'([^']+)' in parents/)
      if (pm) list = list.filter((f) => f.parents.includes(pm[1]) && !f.folder)
      return json(200, { files: list.map((f) => ({ ...meta(f), name: f.name })) })
    }
    if (p === '/drive/v3/files' && method === 'POST') {
      const b = JSON.parse(req.postData())
      const f = st.newFile({ name: b.name, folder: true, appProperties: b.appProperties || {} })
      return json(200, { id: f.id, name: f.name })
    }
    if ((m = p.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
      const f = st.files.get(m[1])
      if (!f) return json(404, { error: { message: 'File not found' } })
      if (method === 'GET') {
        if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/markdown' }, body: f.content })
        return json(200, { ...meta(f), trashed: f.trashed })
      }
      if (method === 'PATCH') {
        const b = JSON.parse(req.postData())
        if (b.name) f.name = b.name
        if (b.trashed) f.trashed = true
        touch(f)
        return json(200, meta(f))
      }
    }
    if (p === '/upload/drive/v3/files' && method === 'POST') {
      const body = req.postData()
      const parts = body.split(/--memo-[^\r\n]+/)
      const md = JSON.parse(parts[1].split('\r\n\r\n')[1])
      const content = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '')
      const f = st.newFile({ name: md.name, parents: md.parents, content })
      return json(200, meta(f))
    }
    if ((m = p.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)) && method === 'PATCH') {
      const f = st.files.get(m[1]); f.content = req.postData() || ''; touch(f)
      return json(200, meta(f))
    }
    return json(400, { error: { message: 'unhandled ' + method + ' ' + p } })
  }
  return { st, handle }
}
module.exports = { createFake }
