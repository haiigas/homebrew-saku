const $ = (s) => document.querySelector(s)
const app = $('#app')
const DEFAULT = 'https://localhost:7878'

const h = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids.filter((k) => k != null))
  return e
}
const show = (...n) => app.replaceChildren(...n)

let base = DEFAULT
let token = ''

async function call(method, path, body) {
  const r = await fetch(base + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body && JSON.stringify(body),
  })
  const t = r.headers.get('X-Saku-Token')
  if (t) { token = t; await chrome.storage.session.set({ token }) }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status })
  return j
}

async function connect(url) {
  const o = new URL(url).origin
  const ok = await chrome.permissions.request({ origins: [o + '/*'] })
  if (!ok) throw new Error('Permission to reach the saku server was denied.')
  base = o
  await chrome.storage.local.set({ base })
}

function field(label, input) {
  return h('label', {}, h('span', {}, label, h('i', {}, ' *')), input)
}

function serverView(err = '') {
  const url = h('input', { value: base, spellcheck: false })
  const e = h('p', { className: 'err', textContent: err })
  const f = h('form', { style: 'display:grid;gap:10px' }, field('Server URL', url), e,
    h('button', { className: 'primary', textContent: 'Connect' }))
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    try { await connect(url.value); start() } catch (x) { e.textContent = x.message }
  }
  show(h('p', { className: 'muted' }, 'Run saku, then enter its address (same host you use in the browser).'), f)
}

function unlockView(err = '') {
  const pw = h('input', { type: 'password', autocomplete: 'current-password' })
  const e = h('p', { className: 'err', textContent: err })
  const f = h('form', { style: 'display:grid;gap:10px' }, field('Master password', pw), e,
    h('button', { className: 'primary', textContent: 'Unlock' }),
    h('button', { type: 'button', textContent: 'Change server', onclick: () => serverView() }))
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    if (!pw.value) return (e.textContent = 'Password is required.')
    try { await call('POST', '/unlock', { password: pw.value }); start() } catch (x) { e.textContent = x.message }
  }
  show(f)
  pw.focus()
}

function fill(username, password) {
  const vis = (el) => el.offsetParent !== null && !el.disabled && !el.readOnly
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const inputs = [...document.querySelectorAll('input')].filter(vis)
  const pwEl = inputs.find((i) => i.type === 'password')
  const userEls = inputs.filter((i) => ['text', 'email', 'tel', ''].includes(i.type))
  const userEl = pwEl ? userEls.filter((i) => i.compareDocumentPosition(pwEl) & Node.DOCUMENT_POSITION_FOLLOWING).pop() : userEls[0]
  if (userEl && username) set(userEl, username)
  if (pwEl) set(pwEl, password)
  return !!(userEl || pwEl)
}

async function doFill(id, status) {
  try {
    const it = await call('GET', '/items/' + id)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fill, args: [it.data.username || '', it.data.password || ''] })
    status.className = r?.result ? 'ok' : 'err'
    status.textContent = r?.result ? 'Filled.' : 'No login field found on this page.'
  } catch (x) { status.className = 'err'; status.textContent = x.message }
}

async function doTotp(id, status) {
  try {
    const it = await call('GET', '/items/' + id)
    const { code } = await call('POST', '/totp', { Secret: it.data.totp })
    await navigator.clipboard.writeText(code)
    status.className = 'ok'
    status.textContent = `2FA code ${code} copied.`
  } catch (x) { status.className = 'err'; status.textContent = x.message }
}

function row(it, status) {
  const a = h('div', { className: 'a' }, h('button', { className: 'primary', textContent: 'Fill', onclick: () => doFill(it.id, status) }))
  if (it.totp) a.append(h('button', { textContent: '2FA', onclick: () => doTotp(it.id, status) }))
  return h('div', { className: 'item' }, h('div', { className: 'n', textContent: it.name }), h('div', { className: 's', textContent: it.sub || '' }), a)
}

async function listView() {
  $('#lock').hidden = false
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  let host = ''
  try { host = new URL(tab.url).hostname } catch {}
  const q = h('input', { placeholder: 'Search logins', type: 'search' })
  const status = h('p', { className: 'muted', role: 'status' })
  const list = h('div')
  const title = h('h2')
  const load = async () => {
    const s = q.value.trim()
    const items = s ? await call('GET', '/match?q=' + encodeURIComponent(s)) : host ? await call('GET', '/match?host=' + encodeURIComponent(host)) : []
    title.textContent = s ? 'Results' : host ? `Logins for ${host}` : 'Logins'
    list.replaceChildren(...(items.length ? items.map((i) => row(i, status)) : [h('p', { className: 'muted', textContent: s ? 'Nothing found.' : 'No saved login for this site. Search above.' })]))
  }
  q.oninput = () => load().catch((x) => (status.textContent = x.message))
  show(q, title, list, status)
  await load()
}

$('#lock').onclick = async () => {
  try { await call('POST', '/lock') } catch {}
  token = ''
  await chrome.storage.session.remove('token')
  $('#lock').hidden = true
  unlockView()
}

async function start() {
  const s = await chrome.storage.local.get('base')
  base = s.base || DEFAULT
  token = (await chrome.storage.session.get('token')).token || ''
  if (!(await chrome.permissions.contains({ origins: [base + '/*'] }))) return serverView()
  try {
    const st = await call('GET', '/status')
    if (!st.initialized) return show(h('p', { className: 'muted' }, 'No vault yet. Open ' + base + ' in your browser to create one.'))
    if (!st.unlocked) return unlockView()
    await listView()
  } catch (x) {
    if (x.status === 401) return unlockView()
    serverView(`Cannot reach ${base}. Is saku running? (${x.message})`)
  }
}

start()
