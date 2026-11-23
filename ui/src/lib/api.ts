export type Data = Record<string, any>
export type ItemType = 'login' | 'bank' | 'card' | 'wifi'
export type Item = {
  id: string
  type: ItemType
  name: string
  tags: string[]
  favorite: boolean
  created: number
  updated: number
  sub?: string
  site?: string
  data?: Data
}
export type Status = { initialized: boolean; unlocked: boolean; autolock: number }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function raw(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch('/api' + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error ?? res.statusText
    if (res.status === 401 && msg === 'locked') window.dispatchEvent(new Event('saku:locked'))
    throw new ApiError(res.status, msg)
  }
  return res
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return (await raw(method, path, body)).json()
}

export async function apiBlob(path: string, body: unknown): Promise<Blob> {
  return (await raw('POST', path, body)).blob()
}

