import { Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, apiBlob } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { FieldError, Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'

const LOCKS = [[300, '5 minutes'], [900, '15 minutes'], [1800, '30 minutes'], [0, 'Never']] as const

export function Settings({ open, onClose, autolock, onAutolock, onImported }: { open: boolean; onClose: () => void; autolock: number; onAutolock: (n: number) => void; onImported: () => void }) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [expPw, setExpPw] = useState('')
  const [expPass, setExpPass] = useState('')
  const [impPass, setImpPass] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const run = async (sec: string, f: () => Promise<void>) => {
    setErrs((e) => ({ ...e, [sec]: '' }))
    try { await f() } catch (e: any) { setErrs((x) => ({ ...x, [sec]: e.message })) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Security, backup and import.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Auto-lock</h3>
          <Label htmlFor="al">Lock after inactivity</Label>
          <NativeSelect id="al" value={autolock} className="w-full" onChange={(e) => run('lock', async () => { await api('POST', '/autolock', { seconds: +e.target.value }); onAutolock(+e.target.value); toast.success('Saved') })}>
            {LOCKS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
          </NativeSelect>
          <FieldError>{errs.lock}</FieldError>
        </div>
        <hr className="border-t border-dashed" />

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run('pw', async () => { await api('POST', '/password', { old: oldPw, new: newPw }); setOldPw(''); setNewPw(''); toast.success('Master password changed') }) }}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Change master password</h3>
          <Label htmlFor="s-old" required>Current password</Label>
          <Input id="s-old" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          <Label htmlFor="s-new" required>New password (8+ characters)</Label>
          <Input id="s-new" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <FieldError>{errs.pw}</FieldError>
          <Button type="submit" variant="outline" size="sm" disabled={!oldPw || !newPw}>Change</Button>
        </form>
        <hr className="border-t border-dashed" />

        <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Export</h3>
          <Label htmlFor="s-exp" required>Master password</Label>
          <Input id="s-exp" type="password" autoComplete="current-password" value={expPw} onChange={(e) => setExpPw(e.target.value)} />
          <Label htmlFor="s-pass">Passphrase to encrypt the file (recommended)</Label>
          <Input id="s-pass" type="password" autoComplete="new-password" value={expPass} onChange={(e) => setExpPass(e.target.value)} />
          {!expPass && <p className="text-xs text-muted-foreground">Without a passphrase the file contains all passwords in plain text.</p>}
          <FieldError>{errs.exp}</FieldError>
          <Button type="submit" variant="outline" size="sm" disabled={!expPw} onClick={() => run('exp', async () => {
            const b = await apiBlob('/export', { password: expPw, passphrase: expPass })
            const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: 'saku-export.json' })
            a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
            setExpPw(''); setExpPass('')
          })}><Download /> Export JSON</Button>
        </form>
        <hr className="border-t border-dashed" />

        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Import</h3>
          <p className="text-xs text-muted-foreground">saku export (plain or encrypted), Bitwarden JSON, or CSV (name, login_uri, login_username, login_password, login_totp, notes, folder).</p>
          <Label htmlFor="s-imp">Passphrase (only for an encrypted saku export)</Label>
          <Input id="s-imp" type="password" value={impPass} onChange={(e) => setImpPass(e.target.value)} />
          <input ref={file} type="file" accept=".json,.csv,text/csv,application/json" hidden onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) run('imp', async () => {
              const r = await api<{ imported: number; skipped: number }>('POST', '/import', { data: await f.text(), passphrase: impPass })
              toast.success(`Imported ${r.imported}${r.skipped ? `, skipped ${r.skipped}` : ''}`)
              setImpPass(''); onImported()
            })
          }} />
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}><Upload /> Choose file</Button>
          <FieldError>{errs.imp}</FieldError>
        </div>
      </DialogContent>
    </Dialog>
  )
}
