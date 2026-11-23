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
let tab = 'all'
let view = { tab: 'all', q: '', type: '', tag: '' } // restored when the popup reopens
const saveView = () => { if (tab) view.tab = tab; chrome.storage.session.set({ view }) }

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
  await chrome.storage.session.remove(['token', 'view'])
}

// ---- fill ----
const say = (status, ok, msg) => { status.className = ok ? 'ok' : 'err'; status.textContent = msg }

async function fillHere(id, status) {
  try {
    const it = await call('GET', '/items/' + id)
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
    const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: fill, args: [it.data.username || '', it.data.password || ''] })
    say(status, !!r?.result, r?.result ? 'Filled.' : 'No login field found on this page.')
  } catch (x) { say(status, false, x.message) }
}

// A tab opened by the extension has no activeTab grant, so filling it needs site access (asked once).
const ALL_SITES = { origins: ['https://*/*', 'http://*/*'] }
async function openFill(id, status) {
  try {
    if (!(await chrome.permissions.contains(ALL_SITES)) && !(await chrome.permissions.request(ALL_SITES))) throw new Error('Allow access to sites so saku can fill after opening.')
    const it = await call('GET', '/items/' + id)
    const url = (it.data.urls || []).find((u) => u && u.trim())
    if (!url) return fillHere(id, status)
    const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url
    if (!/^https?:\/\//i.test(href)) throw new Error('Website is not an http(s) address.')
    await chrome.runtime.sendMessage({ type: 'openfill', url: href, username: it.data.username || '', password: it.data.password || '' })
    window.close()
  } catch (x) { say(status, false, x.message) }
}

// ponytail: no 30s clipboard clear here (the popup closes, so a timer would not survive); the web UI does clear.
async function copyField(id, key, label, status) {
  try {
    const it = await call('GET', '/items/' + id)
    let v = it.data[key] || ''
    if (key === 'totp') v = (await call('POST', '/totp', { Secret: v })).code
    await navigator.clipboard.writeText(v)
    say(status, true, `${label} copied.`)
  } catch (x) { say(status, false, x.message) }
}

const TYPE_ICON = { login: 'key-round', bank: 'landmark', card: 'credit-card', wifi: 'wifi' }
const TYPE_LABEL = { login: 'Logins', bank: 'Bank accounts', card: 'Payment cards', wifi: 'Wireless routers' }

let openMenu = null
document.addEventListener('click', () => { openMenu?.(); openMenu = null })

function kebab(it, status) {
  const wrap = h('div', { className: 'kebab' })
  const menu = h('div', { className: 'menu', hidden: true },
    btn('Copy username', { onclick: () => copyField(it.id, 'username', 'Username', status) }, 'copy'),
    btn('Copy password', { onclick: () => copyField(it.id, 'password', 'Password', status) }, 'copy'),
    ...(it.totp ? [btn('Copy TOTP', { onclick: () => copyField(it.id, 'totp', 'TOTP', status) }, 'copy')] : []))
  const close = () => { menu.hidden = true; wrap.classList.remove('open') }
  const t = btn('', { className: 'icon', title: 'More', 'aria-label': 'More', onclick: (ev) => {
    ev.stopPropagation()
    const was = !menu.hidden
    openMenu?.()
    openMenu = null
    if (was) return
    menu.hidden = false
    wrap.classList.add('open')
    const r = t.getBoundingClientRect()
    menu.classList.toggle('up', r.bottom + 110 > innerHeight - 56)
    openMenu = close
  } }, 'ellipsis-vertical')
  t.className = 'icon'
  wrap.append(t, menu)
  return wrap
}

function row(it, status, here) {
  const a = h('div', { className: here ? 'a on' : 'a' })
  if (it.type === 'login') {
    const now = here || !it.site // matches this page, or has no website to open
    a.append(h('button', { className: 'primary', textContent: now ? 'Fill' : 'Open & Fill', onclick: () => (now ? fillHere : openFill)(it.id, status) }), kebab(it, status))
  }
  return h('div', { className: 'item' },
    h('div', { className: 't' }, ic(TYPE_ICON[it.type] || 'key-round')),
    h('div', { className: 'n', textContent: it.name }),
    h('div', { className: 's', textContent: it.sub || '' }), a)
}

// ---- tabs ----
const NAV = [['fav', 'Favorites', 'star'], ['all', 'All items', 'layers'], ['gen', 'Generator', 'dices'], ['set', 'Settings', 'settings']]

function renderNav() {
  $('#nav').replaceChildren(...NAV.map(([k, label, icon]) =>
    h('button', { className: k === tab ? 'on' : '', title: label, onclick: () => go(k) }, ic(icon, 18), label)))
}

function go(k) {
  tab = k
  saveView()
  renderNav()
  return { fav: listView, all: listView, gen: genView, set: settingsView }[k]().catch(failed)
}

function failed(x) {
  if (x.status === 401) return endSession('/signout').then(() => authView({ err: 'Session ended. Unlock again.' }))
  show(h('p', { className: 'err', textContent: x.message }))
}

async function listView() {
  const status = h('p', { role: 'status' })
  const q = h('input', { placeholder: 'Search', type: 'search', style: 'flex:1', value: view.q })
  const type = h('select', {}, h('option', { value: '' }, 'All categories'), ...Object.entries(TYPE_LABEL).map(([v, l]) => h('option', { value: v }, l)))
  const tags = [...new Set(items.flatMap((i) => i.tags || []))].sort((a, b) => a.localeCompare(b))
  const tg = h('select', {}, h('option', { value: '' }, 'All tags'), ...tags.map((t) => h('option', { value: t }, t)))
  type.value = view.type
  tg.value = view.tag
  const hereBox = h('div', { className: 'list' })
  const list = h('div', { className: 'list' })
  let hereIds = new Set()
  try { // logins for any saved website of the open page
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
    const u = new URL(t.url)
    if (tab !== 'fav' && /^https?:$/.test(u.protocol)) hereIds = new Set((await call('GET', '/match?host=' + encodeURIComponent(u.hostname))).map((m) => m.id))
  } catch (x) { if (x.status === 401) throw x }
  const render = () => {
    const s = q.value.trim().toLowerCase()
    const here = !s && !type.value && !tg.value ? items.filter((i) => hereIds.has(i.id)) : []
    hereBox.replaceChildren(...(here.length ? [h('h2', {}, 'On this site'), ...here.map((i) => row(i, status, true))] : []))
    const rows = items.filter((i) =>
      !(here.length && hereIds.has(i.id)) && (tab !== 'fav' || i.favorite) && (!type.value || i.type === type.value) && (!tg.value || (i.tags || []).includes(tg.value)) &&
      (!s || `${i.name} ${i.sub || ''} ${(i.tags || []).join(' ')}`.toLowerCase().includes(s)))
    list.replaceChildren(...(rows.length ? rows.map((i) => row(i, status)) : here.length ? [] : [h('p', { className: 'muted', textContent: items.length ? 'Nothing found.' : 'No items yet. Use + to add a login.' })]))
  }
  ;[q, type, tg].forEach((e) => (e.oninput = () => { view.q = q.value; view.type = type.value; view.tag = tg.value; saveView(); render() }))
  show(h('div', { className: 'row' }, q), h('div', { className: 'row' }, type, tg), hereBox, h('h2', {}, tab === 'fav' ? 'Favorites' : 'All items'), list, status)
  render()
}

async function loadItems() { items = await call('GET', '/items') }

// ---- add ----
// Same types and fields as ui/src/lib/schema.ts. kind: text | secret | totp | area | urls | custom | link
const SCHEMA = {
  login: { label: 'Login', fields: [
    ['username', 'Username', 'text', 'Details'], ['password', 'Password', 'secret', '', 1], ['totp', '2FA key', 'totp'],
    ['urls', 'Websites', 'urls', 'Websites'], ['fields', 'Custom fields', 'custom', 'Custom fields'], ['notes', 'Notes', 'area', 'Notes']] },
  bank: { label: 'Bank account', fields: [
    ['bank_name', 'Bank name', 'text', 'Details'], ['holder', 'Full name', 'text'], ['account_number', 'Account number', 'text'], ['swift', 'Shift / SWIFT code', 'text'], ['pin', 'PIN code', 'secret'],
    ['branch_name', 'Branch name', 'text', 'Branch'], ['branch_phone', 'Contact number', 'text'], ['branch_address', 'Address', 'area'], ['fields', 'Custom fields', 'custom', 'Custom fields'], ['notes', 'Notes', 'area', 'Notes']] },
  card: { label: 'Payment card', fields: [
    ['holder', 'Card holder name', 'text', 'Details'], ['number', 'Card number', 'text'], ['expires', 'Expires', 'text', '', 0, 'MM/YY'], ['cvc', 'CVC', 'secret'], ['pin', 'PIN', 'secret'],
    ['bank_name', 'Bank name', 'text', 'Bank'], ['bank_url', 'Bank website', 'text'], ['fields', 'Custom fields', 'custom', 'Custom fields'], ['notes', 'Notes', 'area', 'Notes']] },
  wifi: { label: 'Wireless router', fields: [
    ['ssid', 'Network name (SSID)', 'text', 'Network'], ['password', 'Wi-Fi password', 'secret', '', 1],
    ['ip', 'IP address', 'text', 'Router admin', 0, '192.168.1.1'], ['admin_user', 'Admin username', 'text'], ['admin_password', 'Admin password', 'secret', '', 1], ['fields', 'Custom fields', 'custom', 'Custom fields'], ['notes', 'Notes', 'area', 'Notes']] },
}

function secretInput(get, set, withGen) {
  const i = h('input', { type: 'password', autocomplete: 'off', spellcheck: false, className: 'mono', value: get(), oninput: () => set(i.value) })
  const eye = btn('', { title: 'Show / hide', 'aria-label': 'Show or hide', onclick: () => (i.type = i.type === 'password' ? 'text' : 'password') }, 'eye')
  eye.className = 'icon'
  const kids = [i, eye]
  if (withGen) {
    const g = btn('', { title: 'Generate password', 'aria-label': 'Generate password', onclick: () => { i.value = generate(); set(i.value); i.type = 'text' } }, 'dices')
    g.className = 'icon'
    kids.push(g)
  }
  return h('div', { className: 'row' }, ...kids)
}

function tagsInput(tags, suggestions) {
  const chips = h('div', { className: 'chips' })
  const i = h('input', { placeholder: 'Add tag, press Enter', maxLength: 40 })
  i.setAttribute('list', 'tag-list') // .list is read-only
  const dl = h('datalist', { id: 'tag-list' }, ...suggestions.map((t) => h('option', { value: t })))
  const draw = () => chips.replaceChildren(...tags.map((t) => h('span', { className: 'chip' }, t,
    h('button', { type: 'button', 'aria-label': 'Remove ' + t, onclick: () => { tags.splice(tags.indexOf(t), 1); draw() } }, ic('x', 12)))))
  const commit = () => {
    const t = i.value.trim().replace(/,$/, '').trim()
    if (t && tags.length < 20 && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t)
    i.value = ''
    draw()
  }
  i.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); commit() } else if (ev.key === 'Backspace' && !i.value && tags.length) { tags.pop(); draw() } }
  i.onblur = commit
  draw()
  return h('div', { style: 'display:grid;gap:6px' }, i, dl, chips)
}

async function addView() {
  tab = ''
  renderNav()
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
  let u = ''
  try { const x = new URL(t.url); if (/^https?:$/.test(x.protocol)) u = x.origin } catch {}
  let type = 'login'
  let d = {}
  const tags = []
  const name = h('input', { maxLength: 200, value: u ? new URL(u).hostname : '' })
  const e = h('p', { className: 'err', role: 'alert' })
  const ne = h('p', { className: 'err' })
  const body = h('div', { style: 'display:grid;gap:10px' })
  const sel = h('select', {}, ...Object.entries(SCHEMA).map(([k, v]) => h('option', { value: k }, v.label)))

  const build = () => {
    d = {}
    const groups = []
    for (const [key, label, kind, section, gen, ph] of SCHEMA[type].fields) {
      if (section || !groups.length) groups.push({ title: section, nodes: [] })
      d[key] = kind === 'urls' ? (type === 'login' && u ? [u] : ['']) : kind === 'custom' ? [] : ''
      let input
      if (kind === 'secret') input = secretInput(() => d[key], (v) => (d[key] = v), gen)
      else if (kind === 'area') input = h('textarea', { rows: key === 'notes' ? 4 : 2, oninput: (ev) => (d[key] = ev.target.value) })
      else if (kind === 'urls') input = urlsInput(key)
      else if (kind === 'custom') input = customInput(key)
      else input = h('input', { autocomplete: 'off', placeholder: ph || (kind === 'totp' ? 'Base32 secret or otpauth:// URI' : ''), className: kind === 'totp' ? 'mono' : '', oninput: (ev) => (d[key] = ev.target.value) })
      const hide = kind === 'urls' || kind === 'custom' || label === section
      groups[groups.length - 1].nodes.push(h('label', {}, h('span', { className: hide ? 'sr' : '' }, label), input))
    }
    body.replaceChildren(...groups.map((g) => h('div', { className: 'sec' }, g.title ? h('h2', {}, g.title) : null, ...g.nodes)))
  }

  function urlsInput(key) {
    const box = h('div', { style: 'display:grid;gap:6px' })
    const draw = () => box.replaceChildren(...d[key].map((v, j) => {
      const i = h('input', { value: v, placeholder: 'https://example.com', spellcheck: false, oninput: () => (d[key][j] = i.value) })
      const rm = btn('', { title: 'Remove', 'aria-label': 'Remove website', onclick: () => { d[key] = d[key].length > 1 ? d[key].filter((_, y) => y !== j) : ['']; draw() } }, 'trash')
      rm.className = 'icon'
      return h('div', { className: 'row' }, i, rm)
    }), btn('Add website', { onclick: () => { d[key].push(''); draw() } }, 'plus'))
    draw()
    return box
  }

  function customInput(key) {
    const box = h('div', { style: 'display:grid;gap:6px' })
    const draw = () => box.replaceChildren(...d[key].map((c, j) => {
      const label = h('input', { value: c.label, placeholder: 'Field name', 'aria-label': 'Field name', oninput: () => (c.label = label.value) })
      const ty = h('select', { 'aria-label': 'Field type', onchange: () => { c.type = ty.value; draw() } },
        ...[['text', 'Text'], ['password', 'Password'], ['totp', '2FA key']].map(([v, l]) => h('option', { value: v, selected: c.type === v }, l)))
      const rm = btn('', { title: 'Remove', 'aria-label': 'Remove field', onclick: () => { d[key].splice(j, 1); draw() } }, 'trash')
      rm.className = 'icon'
      const val = c.type === 'password' ? secretInput(() => c.value, (v) => (c.value = v), true)
        : h('input', { value: c.value, 'aria-label': 'Value', placeholder: c.type === 'totp' ? 'Base32 secret' : 'Value', autocomplete: 'off', className: c.type === 'totp' ? 'mono' : '', oninput: (ev) => (c.value = ev.target.value) })
      return h('div', { className: 'box' }, h('div', { className: 'row' }, label, ty, rm), val)
    }), btn('Add field', { onclick: () => { d[key].push({ label: '', type: 'text', value: '' }); draw() } }, 'plus'))
    draw()
    return box
  }

  const host = name.value // prefilled from the tab; only meaningful for logins
  sel.onchange = () => {
    type = sel.value
    if (type !== 'login' && name.value === host) name.value = ''
    else if (type === 'login' && !name.value) name.value = host
    build()
  }
  build()
  const save = h('button', { className: 'primary', style: 'flex:1', textContent: 'Save' })
  const f = h('form', {},
    field('Type', sel, false),
    field('Name', name), ne,
    field('Tags', tagsInput(tags, [...new Set(items.flatMap((i) => i.tags || []))]), false),
    body, e,
    h('div', { className: 'row' }, btn('Cancel', { onclick: () => go('all') }), save))
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    e.textContent = ne.textContent = ''
    if (!name.value.trim()) { ne.textContent = 'Name is required.'; return name.focus() }
    const data = { ...d }
    if (Array.isArray(data.urls)) data.urls = data.urls.map((x) => x.trim()).filter(Boolean)
    if (Array.isArray(data.fields)) data.fields = data.fields.filter((x) => x.label || x.value)
    save.disabled = true
    try {
      await call('POST', '/items', { type, name: name.value.trim(), tags, favorite: false, data })
      await loadItems()
      go('all')
    } catch (x) { e.textContent = x.message; save.disabled = false }
  }
  show(h('h2', {}, 'New item'), f)
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
  const lv = h('b', { textContent: gopt.length })
  const len = h('input', { type: 'range', min: 8, max: 64, value: gopt.length, 'aria-label': 'Length' })
  len.oninput = () => { gopt.length = +len.value; lv.textContent = len.value; make() }
  const box = (k, l) => h('label', { className: 'chk' }, h('input', { type: 'checkbox', checked: gopt[k], onchange: (ev) => { gopt[k] = ev.target.checked; make() } }), l)
  show(h('h2', {}, 'Password generator'), out,
    h('div', { className: 'row' },
      btn('Regenerate', { style: 'flex:1', onclick: make }, 'dices'),
      btn('Copy', { className: 'primary', style: 'flex:1', onclick: async () => { await navigator.clipboard.writeText(out.textContent); say(status, true, 'Copied.') } }, 'copy')),
    hr(), h('label', {}, h('span', {}, 'Length: ', lv), len), box('upper', 'Uppercase A-Z'), box('lower', 'Lowercase a-z'), box('digits', 'Digits 0-9'), box('symbols', 'Symbols !@#$'), status)
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
    if (status) await fillHere(m[0].id, status)
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
    Object.assign(view, (await chrome.storage.session.get('view')).view)
    tab = view.tab || 'all'
    renderNav()
    await go(tab)
    await maybeAutofill()
  } catch (x) {
    if (x.status === 401) return authView()
    authView({ editServer: true, err: `Cannot reach ${base}. Is saku running? (${x.message})` })
  }
}

start()
