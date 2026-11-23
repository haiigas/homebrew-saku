import { Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, apiBlob } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'

const LOCKS = [[300, '5 minutes'], [900, '15 minutes'], [1800, '30 minutes'], [0, 'Never']] as const

export function Settings({ open, onClose, autolock, onAutolock, onImported }: { open: boolean; onClose: () => void; autolock: number; onAutolock: (n: number) => void; onImported: () => void }) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [expPw, setExpPw] = useState('')
  const [expPass, setExpPass] = useState('')
  const [impPass, setImpPass] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const run = async (f: () => Promise<void>) => { try { await f() } catch (e: any) { toast.error(e.message) } }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Security, backup and import.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="al">Auto-lock after inactivity</Label>
          <NativeSelect id="al" value={autolock} className="w-full" onChange={(e) => run(async () => { await api('POST', '/autolock', { seconds: +e.target.value }); onAutolock(+e.target.value); toast.success('Saved') })}>
            {LOCKS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
          </NativeSelect>
        </div>
        <Separator />

        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('POST', '/password', { old: oldPw, new: newPw }); setOldPw(''); setNewPw(''); toast.success('Master password changed') }) }}>
          <Label>Change master password</Label>
          <Input type="password" placeholder="Current password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          <Input type="password" placeholder="New password (8+ chars)" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <Button type="submit" variant="outline" size="sm" disabled={!oldPw || !newPw}>Change</Button>
        </form>
        <Separator />

        <form className="space-y-2" onSubmit={(e) => e.preventDefault()}>
          <Label>Export</Label>
          <Input type="password" placeholder="Master password (required)" autoComplete="current-password" value={expPw} onChange={(e) => setExpPw(e.target.value)} />
          <Input type="password" placeholder="Passphrase to encrypt file (recommended)" autoComplete="new-password" value={expPass} onChange={(e) => setExpPass(e.target.value)} />
          {!expPass && <p className="text-xs text-destructive">Without a passphrase the file contains all passwords in plain text.</p>}
          <Button type="submit" variant="outline" size="sm" disabled={!expPw} onClick={() => run(async () => {
            const b = await apiBlob('/export', { password: expPw, passphrase: expPass })
            const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: 'saku-export.json' })
            a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
            setExpPw(''); setExpPass('')
          })}><Download /> Export JSON</Button>
        </form>
        <Separator />

        <div className="space-y-2">
          <Label>Import</Label>
          <p className="text-xs text-muted-foreground">saku export (plain or encrypted), Bitwarden JSON, or CSV (name, login_uri, login_username, login_password, login_totp, notes, folder).</p>
          <Input type="password" placeholder="Passphrase (only for encrypted saku export)" value={impPass} onChange={(e) => setImpPass(e.target.value)} />
          <input ref={file} type="file" accept=".json,.csv,text/csv,application/json" hidden onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) run(async () => {
              const r = await api<{ imported: number; skipped: number }>('POST', '/import', { data: await f.text(), passphrase: impPass })
              toast.success(`Imported ${r.imported}${r.skipped ? `, skipped ${r.skipped}` : ''}`)
              setImpPass(''); onImported()
            })
          }} />
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}><Upload /> Choose file</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
