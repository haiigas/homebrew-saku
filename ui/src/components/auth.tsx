import { Copy, Lock, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { copy } from '@/lib/clip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function Shell({ children, title, sub }: { children: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-5 rounded-xl border bg-background p-6 shadow-sm">
        <div className="space-y-1">
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Lock className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{sub}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Auth({ initialized, onDone }: { initialized: boolean; onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [rk, setRk] = useState('')
  const [mode, setMode] = useState<'unlock' | 'recover'>('unlock')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [recovery, setRecovery] = useState('')
  const [saved, setSaved] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!initialized || mode === 'recover') {
      if (pw.length < 8) return setErr('Use at least 8 characters.')
      if (pw !== pw2) return setErr('Passwords do not match.')
    }
    setBusy(true)
    try {
      if (!initialized) {
        const r = await api<{ recovery: string }>('POST', '/setup', { password: pw })
        setRecovery(r.recovery)
      } else if (mode === 'recover') {
        await api('POST', '/recover', { recovery: rk, password: pw })
        onDone()
      } else {
        await api('POST', '/unlock', { password: pw })
        onDone()
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (recovery)
    return (
      <Shell title="Save your recovery key" sub="This is the only way back in if you forget your master password. It is shown once.">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <code className="flex-1 break-all text-center font-mono text-base tracking-wide">{recovery}</code>
          <Button variant="ghost" size="icon-sm" aria-label="Copy recovery key" onClick={() => copy(recovery, 'Recovery key copied')}>
            <Copy />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Write it down or store it somewhere offline. Anyone with this key can open your vault.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4" />
          I saved my recovery key
        </label>
        <Button className="w-full" disabled={!saved} onClick={onDone}>
          Continue
        </Button>
      </Shell>
    )

  const recovering = initialized && mode === 'recover'
  return (
    <Shell
      title={!initialized ? 'Create your vault' : recovering ? 'Recover vault' : 'Unlock saku'}
      sub={!initialized ? 'Choose a master password. Everything is encrypted with it.' : recovering ? 'Enter your recovery key and choose a new master password.' : 'Enter your master password.'}
    >
      <form onSubmit={submit} className="space-y-4">
        {recovering && (
          <div className="space-y-1.5">
            <Label htmlFor="rk">Recovery key</Label>
            <Input id="rk" value={rk} onChange={(e) => setRk(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" placeholder="XXXX-XXXX-XXXX-…" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="pw">{recovering ? 'New master password' : 'Master password'}</Label>
          <Input id="pw" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={initialized && !recovering ? 'current-password' : 'new-password'} />
        </div>
        {(!initialized || recovering) && (
          <div className="space-y-1.5">
            <Label htmlFor="pw2">Confirm password</Label>
            <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          </div>
        )}
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !pw}>
          {!initialized ? 'Create vault' : recovering ? 'Recover' : 'Unlock'}
        </Button>
        {initialized && (
          <button type="button" className="block w-full text-center text-xs text-muted-foreground hover:underline" onClick={() => { setMode(recovering ? 'unlock' : 'recover'); setErr('') }}>
            {recovering ? 'Back to unlock' : 'Forgot password? Use recovery key'}
          </button>
        )}
      </form>
      {!initialized && (
        <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0" />
          <span>No cloud, no account. If you lose both the password and the recovery key, your data cannot be recovered.</span>
        </div>
      )}
    </Shell>
  )
}
