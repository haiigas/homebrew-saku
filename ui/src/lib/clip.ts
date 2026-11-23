import { toast } from 'sonner'

const CLEAR_MS = 30_000
let timer: number | undefined

async function write(s: string) {
  try {
    await navigator.clipboard.writeText(s)
  } catch {
    // clipboard API needs a secure context; fall back for plain-http LAN use
    const t = document.createElement('textarea')
    t.value = s
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    document.execCommand('copy')
    t.remove()
  }
}

export async function copy(s: string, label = 'Copied') {
  if (!s) return
  await write(s)
  toast.success(`${label} — clears in 30s`)
  window.clearTimeout(timer)
  timer = window.setTimeout(async () => {
    try {
      // only wipe if clipboard still holds what we put there
      if ((await navigator.clipboard.readText()) !== s) return
    } catch {
      /* permission denied: wipe anyway */
    }
    await write(' ')
  }, CLEAR_MS)
}
