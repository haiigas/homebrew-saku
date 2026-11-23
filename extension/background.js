importScripts('fill.js')

// The popup closes as soon as a tab opens, so opening + filling lives here.
chrome.runtime.onMessage.addListener((m, sender) => {
  if (sender.id !== chrome.runtime.id || m?.type !== 'openfill') return
  let ok = false
  try { ok = /^https?:$/.test(new URL(m.url).protocol) } catch {}
  if (!ok) return
  chrome.tabs.create({ url: m.url }).then((tab) => {
    const done = (id, info) => {
      if (id !== tab.id || info.status !== 'complete') return
      chrome.tabs.onUpdated.removeListener(done)
      tryFill(tab.id, m.username, m.password, 10)
    }
    chrome.tabs.onUpdated.addListener(done)
  })
})

// login forms of single-page apps appear after load: retry for ~5s
async function tryFill(tabId, u, p, n, needPw) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: fill, args: [u || '', p || '', !!needPw] })
    if (r?.result) return
  } catch {}
  if (n > 0) setTimeout(() => tryFill(tabId, u, p, n - 1, needPw), 500)
}

// Auto-fill: when a page finishes loading, if the setting is on, the vault is unlocked and exactly one login
// matches the site, fill it. No match, several matches or a locked vault: do nothing (use the popup).
const lastRun = new Map()
chrome.tabs.onUpdated.addListener(async (id, info, tab) => {
  // every load and reload ('complete'), and in-page navigation of single-page apps (url change)
  if ((info.status !== 'complete' && !info.url) || !tab.url) return
  if (Date.now() - (lastRun.get(id) || 0) < 1500) return // load + url events of one navigation
  lastRun.set(id, Date.now())
  try {
    const u = new URL(tab.url)
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local))) return // never fill over plain http
    const { autofill, base } = await chrome.storage.local.get(['autofill', 'base'])
    const { token } = await chrome.storage.session.get('token')
    if (!autofill || !base || !token) return
    if (!(await chrome.permissions.contains({ origins: ['https://*/*', 'http://*/*'] }))) return
    const r = await fetch(base + '/api/match?host=' + encodeURIComponent(u.hostname), { headers: { Authorization: 'Bearer ' + token } })
    if (!r.ok) return
    const m = await r.json()
    if (m.length !== 1) return
    const g = await fetch(base + '/api/items/' + m[0].id, { headers: { Authorization: 'Bearer ' + token } })
    if (!g.ok) return
    const it = await g.json()
    tryFill(id, it.data.username, it.data.password, 10, true)
  } catch {}
})
