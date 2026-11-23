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
async function tryFill(tabId, u, p, n) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: fill, args: [u || '', p || ''] })
    if (r?.result) return
  } catch {}
  if (n > 0) setTimeout(() => tryFill(tabId, u, p, n - 1), 500)
}
