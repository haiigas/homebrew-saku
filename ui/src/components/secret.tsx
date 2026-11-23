import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { copy } from '@/lib/clip'
import { Button } from '@/components/ui/button'

export function Row({ label, children, actions }: { label: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 break-words text-sm">{children}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  )
}

export function CopyBtn({ value, label }: { value: string; label: string }) {
  const [ok, setOk] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async () => {
        await copy(value, `${label} copied`)
        setOk(true)
        setTimeout(() => setOk(false), 1200)
      }}
    >
      {ok ? <Check /> : <Copy />}
    </Button>
  )
}

export function SecretRow({ label, value }: { label: string; value: string }) {
  const [show, setShow] = useState(false)
  return (
    <Row
      label={label}
      actions={
        <>
          <Button variant="ghost" size="icon-sm" aria-label={show ? 'Hide' : 'Reveal'} title={show ? 'Hide' : 'Reveal'} onClick={() => setShow(!show)}>
            {show ? <EyeOff /> : <Eye />}
          </Button>
          <CopyBtn value={value} label={label} />
        </>
      }
    >
      <span className="font-mono">{show ? value : '••••••••••••'}</span>
    </Row>
  )
}

export function useTotp(secret: string) {
  const [state, setState] = useState<{ code: string; left: number } | null>(null)
  const [err, setErr] = useState(false)
  const fetching = useRef(false)

  useEffect(() => {
    let dead = false
    setState(null)
    setErr(false)
    const load = async () => {
      if (fetching.current || !secret.trim()) return
      fetching.current = true
      try {
        const r = await api<{ code: string; remaining: number }>('POST', '/totp', { secret })
        if (!dead) {
          setState({ code: r.code, left: r.remaining })
          setErr(false)
        }
      } catch {
        if (!dead) setErr(true)
      } finally {
        fetching.current = false
      }
    }
    const t0 = setTimeout(load, secret.trim() ? 250 : 0)
    const tick = setInterval(() => {
      setState((s) => {
        if (!s) return s
        if (s.left <= 1) {
          load()
          return { ...s, left: 0 }
        }
        return { ...s, left: s.left - 1 }
      })
    }, 1000)
    return () => {
      dead = true
      clearTimeout(t0)
      clearInterval(tick)
    }
  }, [secret])

  return { state, err }
}

export const spaced = (c: string) => (c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c)

export function TotpRow({ label, secret }: { label: string; secret: string }) {
  const { state, err } = useTotp(secret)
  return (
    <Row label={label} actions={state && <CopyBtn value={state.code} label="2FA code" />}>
      {err ? (
        <span className="text-destructive">Invalid 2FA key</span>
      ) : state ? (
        <span className="flex items-center gap-3">
          <span className="font-mono text-lg tracking-wider">{spaced(state.code)}</span>
          <span className={`text-xs tabular-nums ${state.left <= 5 ? 'text-destructive' : 'text-muted-foreground'}`}>{state.left}s</span>
        </span>
      ) : (
        <span className="text-muted-foreground">…</span>
      )}
    </Row>
  )
}
