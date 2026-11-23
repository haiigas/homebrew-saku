import { Copy as CopyIcon, ExternalLink, Pencil, Star, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Item } from '@/lib/api'
import { TYPES, toHref } from '@/lib/schema'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { chipClass, type TagColors } from '@/lib/tags'
import { ItemIcon } from './item-icon'
import { CopyBtn, Row, SecretRow, TotpRow } from './secret'

export function ItemView({ id, onEdit, onChanged, onDeleted, onOpen, onTag, colors }: { id: string; onEdit: (it: Item) => void; onChanged: () => void; onDeleted: () => void; onOpen: (id: string) => void; onTag: (t: string) => void; colors: TagColors }) {
  const [it, setIt] = useState<Item | null>(null)
  const [del, setDel] = useState(false)

  useEffect(() => {
    setIt(null)
    api<Item>('GET', `/items/${id}`).then(setIt).catch((e) => toast.error('Could not load item', { description: e.message }))
  }, [id])

  if (!it) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  const T = TYPES[it.type]
  const d = it.data ?? {}
  const sections: { title?: string; rows: React.ReactNode[] }[] = []
  const row = (s: string | undefined, n: React.ReactNode) => {
    if (!sections.length || (s && s !== sections[sections.length - 1].title)) sections.push({ title: s, rows: [] })
    sections[sections.length - 1].rows.push(n)
  }

  let cur = ''
  for (const f of T.fields) {
    const v = d[f.key]
    const k = f.key
    if (f.section) cur = f.section
    const lab = f.label === cur ? '' : f.label
    if (f.kind === 'urls') {
      const urls: string[] = (v ?? []).filter((u: string) => u.trim())
      urls.forEach((u, i) => {
        const href = toHref(u)
        row(f.section, (
          <Row key={k + i} label="" actions={<>{href && <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Open" title="Open"><Button variant="ghost" size="icon-sm" tabIndex={-1} render={<span />}><ExternalLink /></Button></a>}<CopyBtn value={u} label="URL" /></>}>
            {u}
          </Row>
        ))
      })
    } else if (f.kind === 'custom') {
      for (const [i, c] of ((v ?? []) as { label: string; type: string; value: string }[]).entries()) {
        if (!c.label && !c.value) continue
        row(f.section ?? 'Custom fields', c.type === 'password' ? <SecretRow key={k + i} label={c.label || 'Field'} value={c.value} /> : c.type === 'totp' ? <TotpRow key={k + i} label={c.label || '2FA Authentication'} secret={c.value} /> : <Row key={k + i} label={c.label || 'Field'} actions={<CopyBtn value={c.value} label={c.label || 'Field'} />}>{c.value}</Row>)
      }
    } else if (typeof v === 'string' && v) {
      if (f.kind === 'secret') row(f.section, <SecretRow key={k} label={f.label} value={v} />)
      else if (f.kind === 'totp') row(f.section, <TotpRow key={k} label="2FA Authentication" secret={v} />)
      else if (f.kind === 'area') row(f.section, <Row key={k} label={lab}><span className="whitespace-pre-wrap">{v}</span></Row>)
      else {
        const href = f.kind === 'link' ? toHref(v) : null
        row(f.section, (
          <Row key={k} label={f.label} actions={<>{href && <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Open" title="Open"><Button variant="ghost" size="icon-sm" tabIndex={-1} render={<span />}><ExternalLink /></Button></a>}<CopyBtn value={v} label={f.label} /></>}>
            <span className={f.key === 'number' || f.key === 'account_number' ? 'font-mono' : ''}>{v}</span>
          </Row>
        ))
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-8">
      <div className="flex items-start gap-3">
        <ItemIcon item={it} box="size-11 rounded-lg" icon="size-5" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold leading-tight">{it.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm text-muted-foreground">{T.label}</span>
            {it.tags.map((t) => (
              <button key={t} onClick={() => onTag(t)} className={`h-5 border px-1.5 text-xs font-medium ${chipClass(colors, t)}`}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onEdit(it)}><Pencil /> Edit</Button>
        <Button variant="outline" size="sm" onClick={async () => {
          await api('POST', `/items/${id}/favorite`, { favorite: !it.favorite })
          setIt({ ...it, favorite: !it.favorite })
          onChanged()
        }}>
          <Star className={it.favorite ? 'fill-amber-400 text-amber-500' : ''} /> {it.favorite ? 'Unfavorite' : 'Favorite'}
        </Button>
        <Button variant="outline" size="sm" onClick={async () => {
          try {
            const c = await api<Item>('POST', `/items/${id}/duplicate`)
            toast.success('Item duplicated', { description: `“${c.name}” was created.` })
            onChanged()
            onOpen(c.id)
          } catch (e: any) { toast.error('Could not duplicate item', { description: e.message }) }
        }}><CopyIcon /> Duplicate</Button>
        <Button variant="destructive" size="sm" onClick={() => setDel(true)}><Trash2 /> Delete</Button>
      </div>
      {sections.map((s, i) => (
        <section key={i} className="space-y-2">
          {s.title && <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.title}</h3>}
          <div className="divide-y rounded-lg border">{s.rows}</div>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Updated {new Date(it.updated * 1000).toLocaleString()}</p>
      <AlertDialog open={del} onOpenChange={setDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{it.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => {
              try { await api('DELETE', `/items/${id}`); toast.success('Item deleted', { description: `“${it.name}” was removed.` }); onDeleted() } catch (e: any) { toast.error('Could not delete item', { description: e.message }) }
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
