import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { defaultGen, entropy, generate, type GenOpts } from '@/lib/gen'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { CopyBtn } from './secret'

const OPTS: [keyof GenOpts, string][] = [
  ['upper', 'Uppercase letters (A-Z)'],
  ['lower', 'Lowercase letters (a-z)'],
  ['digits', 'Numbers (0-9)'],
  ['symbols', 'Symbols (!@#$%)'],
  ['ambiguous', 'Ambiguous characters (O, 0, I, l, 1)'],
]

export function Generator({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse?: (v: string) => void }) {
  const [o, setO] = useState<GenOpts>(() => {
    try {
      return { ...defaultGen, ...JSON.parse(localStorage.getItem('saku:gen') ?? '{}') }
    } catch {
      return defaultGen
    }
  })
  const [pw, setPw] = useState('')
  const regen = (x = o) => setPw(generate(x))
  const set = (p: Partial<GenOpts>) => {
    const n = { ...o, ...p }
    if (!n.upper && !n.lower && !n.digits && !n.symbols) return
    setO(n)
    localStorage.setItem('saku:gen', JSON.stringify(n))
    regen(n)
  }
  useEffect(() => {
    if (open) setPw(generate(o))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const bits = entropy(o)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Password generator</DialogTitle>
          <DialogDescription>Generated in your browser with a secure random source.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1 rounded-lg border bg-muted/40 px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-sm">{pw}</code>
          <Button variant="ghost" size="icon-sm" aria-label="Regenerate" title="Regenerate" onClick={() => regen()}>
            <RefreshCw />
          </Button>
          <CopyBtn value={pw} label="Password" />
        </div>
        <div className="text-xs text-muted-foreground">
          ~{bits} bits of entropy — {bits < 60 ? 'weak' : bits < 80 ? 'fair' : bits < 110 ? 'strong' : 'very strong'}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="gen-len">Length</Label>
            <span className="text-sm tabular-nums">{o.length}</span>
          </div>
          <input id="gen-len" type="range" min={8} max={64} value={o.length} onChange={(e) => set({ length: +e.target.value })} className="w-full accent-neutral-900" />
        </div>
        <div className="space-y-2.5">
          {OPTS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!o[k]} onCheckedChange={(v) => set({ [k]: !!v } as Partial<GenOpts>)} />
              {label}
            </label>
          ))}
        </div>
        {onUse && (
          <DialogFooter>
            <Button
              onClick={() => {
                onUse(pw)
                onClose()
              }}
            >
              Use password
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
