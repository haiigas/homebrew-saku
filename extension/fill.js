// Injected into the page (self-contained: no outside references). Also loaded by popup and background.
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
