const $ = (s) => document.querySelector(s)
const app = $('#app')
const DEFAULT = 'https://localhost:7878'

const h = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids.filter((k) => k != null))
  return e
}
const ic = (name, size = 16) => {
  const s = h('span', { style: 'display:inline-flex' })
  s.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return s
}
const btn = (text, o = {}, icon) => h('button', { type: 'button', ...o }, ...(icon ? [ic(icon)] : []), text)
const show = (...n) => app.replaceChildren(...n)

let base = DEFAULT
let token = ''
let items = []
let st = {}

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
  let o
  try { o = new URL(url).origin } catch { throw new Error('Enter a valid URL, e.g. https://localhost:7878') }
  if (o === 'null') throw new Error('Enter a valid URL, e.g. https://localhost:7878')
  const ok = await chrome.permissions.request({ origins: [o + '/*'] })
  if (!ok) throw new Error('Permission to reach the saku server was denied.')
  base = o
  await chrome.storage.local.set({ base })
}

const field = (label, input, req = true) => h('label', {}, h('span', {}, label, req ? h('i', {}, ' *') : null), input)

function chrome_(on) {
  $('#nav').hidden = !on
  $('#add').hidden = !on
}

// ---- auth ----
function authView({ err = '', editServer = false } = {}) {
  chrome_(false)
  const url = h('input', { value: base, spellcheck: false, disabled: !editServer })
  const pw = h('input', { type: 'password', autocomplete: 'current-password' })
  const e = h('p', { className: 'err', textContent: err })
  const change = btn('Change server', { onclick: () => { url.disabled = false; url.focus(); change.hidden = true } }, 'server')
  change.hidden = editServer
  const go = h('button', { className: 'primary', textContent: 'Unlock' })
  const f = h('form', {},
    h('p', { className: 'muted' }, 'Your vault is locked. Enter your master password to unlock it. Saku runs on your own machine; nothing leaves it.'),
    hr(),
    field('Server', url), change,
    field('Master password', pw), e, go)
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    e.textContent = ''
    if (!pw.value) return (e.textContent = 'Master password is required.')
    go.disabled = true
    try {
      if (!url.disabled) await connect(url.value)
      await call('POST', '/unlock', { password: pw.value })
      start()
    } catch (x) { e.textContent = x.message; go.disabled = false }
  }
  show(h('div', { style: 'display:grid;gap:4px' }, h('h2', {}, 'Locked')), f)
  ;(editServer ? url : pw).focus()
}
const hr = () => h('hr')

async function endSession(path) {
  try { await call('POST', path) } catch {}
  token = ''
  await chrome.storage.session.remove('token')
}

// ---- fill ----
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

const say = (status, ok, msg) => { status.className = ok ? 'ok' : 'err'; status.textContent = msg }

async function doFill(id, status) {
  try {
    const it = await call('GET', '/items/' + id)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fill, args: [it.data.username || '', it.data.password || ''] })
    say(status, !!r?.result, r?.result ? 'Filled.' : 'No login field found on this page.')
  } catch (x) { say(status, false, x.message) }
}

async function doTotp(id, status) {
  try {
    const it = await call('GET', '/items/' + id)
    const { code } = await call('POST', '/totp', { Secret: it.data.totp })
    await navigator.clipboard.writeText(code)
    say(status, true, `2FA code ${code} copied.`)
  } catch (x) { say(status, false, x.message) }
}

const TYPE_ICON = { login: 'key-round', bank: 'landmark', card: 'credit-card', wifi: 'wifi' }
const TYPE_LABEL = { login: 'Logins', bank: 'Bank accounts', card: 'Payment cards', wifi: 'Wireless routers' }

function row(it, status) {
  const a = h('div', { className: 'a' })
  if (it.type === 'login') a.append(h('button', { className: 'primary', textContent: 'Fill', onclick: () => doFill(it.id, status) }))
  if (it.totp) a.append(btn('2FA', { onclick: () => doTotp(it.id, status) }))
  return h('div', { className: 'item' },
    h('div', { className: 't' }, ic(TYPE_ICON[it.type] || 'key-round')),
    h('div', { className: 'n', textContent: it.name }),
    h('div', { className: 's', textContent: it.sub || '' }), a)
}

// ---- tabs ----
let tab = 'all'
const NAV = [['fav', 'Favorites', 'star'], ['all', 'All items', 'layers'], ['gen', 'Generator', 'dices'], ['set', 'Settings', 'settings']]

function renderNav() {
  $('#nav').replaceChildren(...NAV.map(([k, label, icon]) =>
    h('button', { className: k === tab ? 'on' : '', title: label, onclick: () => go(k) }, ic(icon, 18), label)))
}

function go(k) {
  tab = k
  renderNav()
  ;({ fav: listView, all: listView, gen: genView, set: settingsView }[k])().catch(failed)
}

function failed(x) {
  if (x.status === 401) return endSession('/signout').then(() => authView({ err: 'Session ended. Unlock again.' }))
  show(h('p', { className: 'err', textContent: x.message }))
}

async function listView() {
  const status = h('p', { role: 'status' })
  const q = h('input', { placeholder: 'Search', type: 'search', style: 'flex:1' })
  const type = h('select', {}, h('option', { value: '' }, 'All categories'), ...Object.entries(TYPE_LABEL).map(([v, l]) => h('option', { value: v }, l)))
  const tags = [...new Set(items.flatMap((i) => i.tags || []))].sort((a, b) => a.localeCompare(b))
  const tg = h('select', {}, h('option', { value: '' }, 'All tags'), ...tags.map((t) => h('option', { value: t }, t)))
  const list = h('div', { className: 'list' })
  const render = () => {
    const s = q.value.trim().toLowerCase()
    const rows = items.filter((i) =>
      (tab !== 'fav' || i.favorite) && (!type.value || i.type === type.value) && (!tg.value || (i.tags || []).includes(tg.value)) &&
      (!s || `${i.name} ${i.sub || ''} ${(i.tags || []).join(' ')}`.toLowerCase().includes(s)))
    list.replaceChildren(...(rows.length ? rows.map((i) => row(i, status)) : [h('p', { className: 'muted', textContent: items.length ? 'Nothing found.' : 'No items yet. Use + to add a login.' })]))
  }
  ;[q, type, tg].forEach((e) => (e.oninput = render))
  show(h('div', { className: 'row' }, q), h('div', { className: 'row' }, type, tg), h('h2', {}, tab === 'fav' ? 'Favorites' : 'All items'), list, status)
  render()
}

async function loadItems() { items = await call('GET', '/items') }

// ---- add ----
async function addView() {
  tab = ''
  renderNav()
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
  let u = ''
  try { const x = new URL(t.url); if (/^https?:$/.test(x.protocol)) u = x.origin } catch {}
  const name = h('input', { value: u ? new URL(u).hostname : '' })
  const user = h('input', { autocomplete: 'off', spellcheck: false })
  const pass = h('input', { type: 'password', autocomplete: 'new-password' })
  const site = h('input', { value: u, spellcheck: false })
  const e = h('p', { className: 'err' })
  const eye = btn('', { className: 'icon', title: 'Show password', onclick: () => (pass.type = pass.type === 'password' ? 'text' : 'password') }, 'eye')
  eye.className = 'icon'
  const gen = btn('', { className: 'icon', title: 'Generate password', onclick: () => { pass.value = generate(); pass.type = 'text' } }, 'dices')
  gen.className = 'icon'
  const f = h('form', {}, field('Name', name), field('Username', user, false),
    field('Password', h('div', { className: 'row' }, pass, gen, eye), false), field('Website', site, false), e,
    h('div', { className: 'row' }, btn('Cancel', { onclick: () => go('all') }), h('button', { className: 'primary', style: 'flex:1', textContent: 'Save' })))
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    if (!name.value.trim()) return (e.textContent = 'Name is required.')
    try {
      await call('POST', '/items', { type: 'login', name: name.value.trim(), tags: [], data: { username: user.value, password: pass.value, totp: '', urls: site.value.trim() ? [site.value.trim()] : [], fields: [], notes: '' } })
      await loadItems()
      go('all')
    } catch (x) { e.textContent = x.message }
  }
  show(h('h2', {}, 'New login'), f)
  name.focus()
}
$('#add').onclick = () => addView().catch(failed)
$('#add').append(ic('plus'))

// ---- generator ----
const SETS = { upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{};:,.?' }
const gopt = { length: 20, upper: true, lower: true, digits: true, symbols: true }
function rnd(n) {
  const max = Math.floor(0x100000000 / n) * n
  const b = new Uint32Array(1)
  do crypto.getRandomValues(b); while (b[0] >= max)
  return b[0] % n
}
function generate() {
  const pools = Object.keys(SETS).filter((k) => gopt[k]).map((k) => SETS[k].replace(/[O0Il1|]/g, ''))
  if (!pools.length) return ''
  const all = pools.join('')
  const out = pools.map((s) => s[rnd(s.length)])
  while (out.length < gopt.length) out.push(all[rnd(all.length)])
  for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]] }
  return out.join('')
}

async function genView() {
  const out = h('div', { className: 'gen' })
  const status = h('p', { role: 'status' })
  const make = () => { out.textContent = generate() || 'Pick at least one character set.' }
  const len = h('input', { type: 'number', min: 8, max: 64, value: gopt.length, style: 'width:72px' })
  len.oninput = () => { gopt.length = Math.min(64, Math.max(8, +len.value || 20)); make() }
  const box = (k, l) => h('label', { className: 'chk' }, h('input', { type: 'checkbox', checked: gopt[k], onchange: (ev) => { gopt[k] = ev.target.checked; make() } }), l)
  show(h('h2', {}, 'Password generator'), out,
    h('div', { className: 'row' },
      btn('Regenerate', { style: 'flex:1', onclick: make }, 'dices'),
      btn('Copy', { className: 'primary', style: 'flex:1', onclick: async () => { await navigator.clipboard.writeText(out.textContent); say(status, true, 'Copied.') } }, 'copy')),
    hr(), field('Length (8-64)', len, false), box('upper', 'Uppercase A-Z'), box('lower', 'Lowercase a-z'), box('digits', 'Digits 0-9'), box('symbols', 'Symbols !@#$'), status)
  make()
}

// ---- settings ----
async function settingsView() {
  const { autofill } = await chrome.storage.local.get('autofill')
  const status = h('p', { role: 'status' })
  const lockSel = h('select', {}, ...[[300, '5 minutes'], [900, '15 minutes'], [1800, '30 minutes'], [0, 'Never']].map(([v, l]) => h('option', { value: v, selected: v === st.autolock }, l)))
  lockSel.onchange = async () => {
    try { await call('POST', '/autolock', { seconds: +lockSel.value }); st.autolock = +lockSel.value; say(status, true, 'Auto-lock saved.') } catch (x) { say(status, false, x.message) }
  }
  const af = h('input', { type: 'checkbox', checked: !!autofill, onchange: () => chrome.storage.local.set({ autofill: af.checked }) })
  show(
    h('div', { className: 'set' }, h('h2', {}, 'Security'), field('Auto-lock after', lockSel, false)),
    h('div', { className: 'set' }, h('h2', {}, 'Auto-fill'),
      h('label', { className: 'chk' }, af, 'Fill automatically when exactly one login matches the site'),
      h('p', { className: 'muted' }, 'Runs when you open this popup on a page. Off by default.')),
    h('div', { className: 'set' }, h('h2', {}, 'Server'), h('p', { className: 'muted' }, base),
      btn('Change server', { onclick: () => endSession('/signout').then(() => authView({ editServer: true })) }, 'server')),
    h('div', { className: 'set', style: 'border:0' }, h('h2', {}, 'Session'),
      btn('Lock vault', { onclick: () => endSession('/lock').then(() => authView()) }, 'lock'),
      btn('Sign out', { className: 'danger', onclick: () => endSession('/signout').then(() => authView()) }, 'log-out')),
    status)
}

// ---- boot ----
async function maybeAutofill() {
  if (!(await chrome.storage.local.get('autofill')).autofill) return
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
  let host = ''
  try { host = new URL(t.url).hostname } catch { return }
  const m = await call('GET', '/match?host=' + encodeURIComponent(host))
  if (m.length === 1) {
    const status = $('#app p[role=status]')
    if (status) await doFill(m[0].id, status)
  }
}

async function start() {
  const s = await chrome.storage.local.get('base')
  base = s.base || DEFAULT
  token = (await chrome.storage.session.get('token')).token || ''
  if (!(await chrome.permissions.contains({ origins: [base + '/*'] }))) return authView({ editServer: true, err: 'Allow access to the saku server first.' })
  try {
    st = await call('GET', '/status')
    if (!st.initialized) return show(h('p', { className: 'muted' }, 'No vault yet. Open ' + base + ' in your browser to create one.'))
    if (!st.unlocked) return authView()
    await loadItems()
    chrome_(true)
    tab = 'all'
    renderNav()
    await listView()
    await maybeAutofill()
  } catch (x) {
    if (x.status === 401) return authView()
    authView({ editServer: true, err: `Cannot reach ${base}. Is saku running? (${x.message})` })
  }
}

start()
