export type GenOpts = { length: number; upper: boolean; lower: boolean; digits: boolean; symbols: boolean; ambiguous: boolean }

export const defaultGen: GenOpts = { length: 20, upper: true, lower: true, digits: true, symbols: true, ambiguous: false }

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
}

// uniform random int via rejection sampling (no modulo bias)
function rnd(n: number) {
  const max = Math.floor(0x100000000 / n) * n
  const b = new Uint32Array(1)
  do crypto.getRandomValues(b)
  while (b[0] >= max)
  return b[0] % n
}

const strip = (s: string, amb: boolean) => (amb ? s : s.replace(/[O0Il1|]/g, ''))

export function pools(o: GenOpts) {
  return (['upper', 'lower', 'digits', 'symbols'] as const).filter((k) => o[k]).map((k) => strip(SETS[k], o.ambiguous))
}

export function generate(o: GenOpts): string {
  const p = pools(o)
  if (!p.length) return ''
  const all = p.join('')
  const out = p.map((s) => s[rnd(s.length)]) // at least one from each class
  while (out.length < o.length) out.push(all[rnd(all.length)])
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, Math.max(o.length, p.length)).join('')
}

export const entropy = (o: GenOpts) => {
  const n = pools(o).join('').length
  return n ? Math.round(o.length * Math.log2(n)) : 0
}
