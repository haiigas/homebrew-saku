import { Dices, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, type Data, type Item, type ItemType } from '@/lib/api'
import { blank, TYPE_KEYS, TYPES, type Field } from '@/lib/schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldError, Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Generator } from './generator'
import { spaced, useTotp } from './secret'
import { TagsInput } from './tags-input'

function SecretInput({ value, onChange, onGen, id }: { value: string; onChange: (v: string) => void; onGen: () => void; id?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex gap-1">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
      <Button type="button" variant="outline" size="icon" aria-label={show ? 'Hide' : 'Reveal'} onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</Button>
      <Button type="button" variant="outline" size="icon" aria-label="Generate password" title="Generate password" onClick={onGen}><Dices /></Button>
    </div>
  )
}

function TotpPreview({ secret }: { secret: string }) {
  const { state, err } = useTotp(secret)
  if (!secret.trim()) return null
  if (err) return <p className="text-xs text-destructive">Invalid 2FA key</p>
  return state ? <p className="text-xs text-muted-foreground">Current code: <span className="font-mono">{spaced(state.code)}</span> ({state.left}s)</p> : null
}

export function ItemForm({ item, startType, tags, onSaved, onCancel }: { item?: Item; startType: ItemType; tags: string[]; onSaved: (it: Item) => void; onCancel: () => void }) {
  const [type, setType] = useState<ItemType>(item?.type ?? startType)
  const [name, setName] = useState(item?.name ?? '')
  const [tgs, setTgs] = useState<string[]>(item?.tags ?? [])
  const [d, setD] = useState<Data>(() => ({ ...blank(item?.type ?? startType), ...(item?.data ?? {}) }))
  const [gen, setGen] = useState<((v: string) => void) | null>(null)
  const [busy, setBusy] = useState(false)
  const [nameErr, setNameErr] = useState('')
  const [err, setErr] = useState('')
  const T = TYPES[type]

  const set = (k: string, v: any) => setD((x) => ({ ...x, [k]: v }))
  const changeType = (t: ItemType) => { setType(t); setD(blank(t)) }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!name.trim()) {
      setNameErr('Name is required.')
      document.getElementById('f-name')?.focus()
      return
    }
    setNameErr('')
    const data: Data = { ...d }
    if (Array.isArray(data.urls)) data.urls = data.urls.map((u: string) => u.trim()).filter(Boolean)
    if (Array.isArray(data.fields)) data.fields = data.fields.filter((f: any) => f.label || f.value)
    setBusy(true)
    try {
      const body = { type, name, tags: tgs, favorite: item?.favorite ?? false, data }
      onSaved(item ? await api<Item>('PUT', `/items/${item.id}`, { ...body, created: item.created }) : await api<Item>('POST', '/items', body))
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const input = (f: Field, i: number) => {
    const id = `f-${f.key}`
    const v = d[f.key]
    return (
      <div key={f.key} className="space-y-1.5">
        {f.section && i > 0 && <h3 className="pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.section}</h3>}
        <Label htmlFor={id}>{f.label}</Label>
        {f.kind === 'secret' ? <SecretInput id={id} value={v} onChange={(x) => set(f.key, x)} onGen={() => setGen(() => (x: string) => set(f.key, x))} />
        : f.kind === 'totp' ? <><Input id={id} value={v} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} autoComplete="off" spellCheck={false} className="font-mono" /><TotpPreview secret={v} /></>
        : f.kind === 'area' ? <Textarea id={id} rows={f.key === 'notes' ? 4 : 2} value={v} onChange={(e) => set(f.key, e.target.value)} />
        : f.kind === 'urls' ? (
          <div className="space-y-1.5">
            {(v as string[]).map((u, j) => (
              <div key={j} className="flex gap-1">
                <Input id={j === 0 ? id : undefined} value={u} placeholder="https://example.com" onChange={(e) => set('urls', v.map((x: string, y: number) => (y === j ? e.target.value : x)))} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove URL" onClick={() => set('urls', v.length > 1 ? v.filter((_: string, y: number) => y !== j) : [''])}><Trash2 /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set('urls', [...v, ''])}><Plus /> Add website</Button>
          </div>
        )
        : f.kind === 'custom' ? (
          <div className="space-y-2">
            {(v as { label: string; type: string; value: string }[]).map((c, j) => {
              const up = (p: object) => set('fields', v.map((x: any, y: number) => (y === j ? { ...x, ...p } : x)))
              return (
                <div key={j} className="space-y-1.5 rounded-lg border p-2">
                  <div className="flex gap-1">
                    <Input value={c.label} placeholder="Field name" aria-label="Field name" onChange={(e) => up({ label: e.target.value })} />
                    <NativeSelect value={c.type} aria-label="Field type" onChange={(e) => up({ type: e.target.value })}>
                      <option value="text">Text</option><option value="password">Password</option><option value="totp">2FA key</option>
                    </NativeSelect>
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove field" onClick={() => set('fields', v.filter((_: unknown, y: number) => y !== j))}><Trash2 /></Button>
                  </div>
                  {c.type === 'password' ? <SecretInput value={c.value} onChange={(x) => up({ value: x })} onGen={() => setGen(() => (x: string) => up({ value: x }))} />
                  : <Input value={c.value} placeholder={c.type === 'totp' ? 'Base32 secret' : 'Value'} aria-label="Value" autoComplete="off" onChange={(e) => up({ value: e.target.value })} className={c.type === 'totp' ? 'font-mono' : ''} />}
                  {c.type === 'totp' && <TotpPreview secret={c.value} />}
                </div>
              )
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => set('fields', [...v, { label: '', type: 'text', value: '' }])}><Plus /> Add field</Button>
          </div>
        )
        : <Input id={id} value={v} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} autoComplete="off" />}
      </div>
    )
  }

  return (
    <form onSubmit={save} className="mx-auto max-w-2xl space-y-4 p-4 sm:p-8">
      <h2 className="text-xl font-semibold">{item ? 'Edit' : 'New'} {T.label.toLowerCase()}</h2>
      {!item && (
        <div className="space-y-1.5">
          <Label htmlFor="f-type">Type</Label>
          <NativeSelect id="f-type" value={type} onChange={(e) => changeType(e.target.value as ItemType)} className="w-full">
            {TYPE_KEYS.map((k) => <option key={k} value={k}>{TYPES[k].label}</option>)}
          </NativeSelect>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="f-name" required>Name</Label>
        <Input id="f-name" autoFocus value={name} onChange={(e) => { setName(e.target.value); setNameErr('') }} maxLength={200} aria-invalid={!!nameErr} aria-describedby={nameErr ? 'f-name-err' : undefined} />
        <FieldError id="f-name-err">{nameErr}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label>Tags</Label>
        <TagsInput value={tgs} onChange={setTgs} suggestions={tags} />
      </div>
      {T.fields.map(input)}
      <FieldError>{err}</FieldError>
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={busy}>Save</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
      <Generator open={!!gen} onClose={() => setGen(null)} onUse={(v) => gen?.(v)} />
    </form>
  )
}
