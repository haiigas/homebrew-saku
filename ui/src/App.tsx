import { Dices, Lock, Layers, Plus, Search, Settings as Cog, Star, Tag, ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, type Item, type ItemType, type Status } from '@/lib/api'
import { TYPE_KEYS, TYPES } from '@/lib/schema'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Auth } from '@/components/auth'
import { Generator } from '@/components/generator'
import { ItemForm } from '@/components/item-form'
import { ItemView } from '@/components/item-view'
import { Settings } from '@/components/settings'

type Filter = { kind: 'all' } | { kind: 'fav' } | { kind: 'type'; t: ItemType } | { kind: 'tag'; tag: string }
type Pane = { mode: 'none' } | { mode: 'view'; id: string } | { mode: 'new'; t: ItemType } | { mode: 'edit'; item: Item }

const same = (a: Filter, b: Filter) => JSON.stringify(a) === JSON.stringify(b)

export default function App() {
  const [st, setSt] = useState<Status | null>(null)
  const refresh = useCallback(() => api<Status>('GET', '/status').then(setSt), [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const f = () => refresh()
    window.addEventListener('saku:locked', f)
    return () => window.removeEventListener('saku:locked', f)
  }, [refresh])

  // poll so server-side auto-lock is reflected while the tab sits idle
  useEffect(() => {
    if (!st?.unlocked) return
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [st?.unlocked, refresh])

  if (!st) return null
  return (
    <TooltipProvider>
      {st.unlocked ? <Vault st={st} setSt={setSt} refresh={refresh} /> : <Auth initialized={st.initialized} onDone={refresh} />}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

function Vault({ st, setSt, refresh }: { st: Status; setSt: (s: Status) => void; refresh: () => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [pane, setPane] = useState<Pane>({ mode: 'none' })
  const [gen, setGen] = useState(false)
  const [cfg, setCfg] = useState(false)

  const load = useCallback(() => api<Item[]>('GET', '/items').then(setItems).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])

  // user activity keeps the vault awake (server only sees API calls)
  const lastPing = useRef(0)
  useEffect(() => {
    const f = () => {
      if (Date.now() - lastPing.current < 30000) return
      lastPing.current = Date.now()
      api('POST', '/ping').catch(() => {})
    }
    const ev = ['keydown', 'pointerdown', 'scroll'] as const
    ev.forEach((e) => window.addEventListener(e, f, { passive: true }))
    return () => ev.forEach((e) => window.removeEventListener(e, f))
  }, [])

  const allTags = useMemo(() => {
    const m = new Map<string, string>()
    items.forEach((i) => i.tags.forEach((t) => m.has(t.toLowerCase()) || m.set(t.toLowerCase(), t)))
    return [...m.values()].sort((a, b) => a.localeCompare(b))
  }, [items])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items
      .filter((i) => {
        if (filter.kind === 'fav') return i.favorite
        if (filter.kind === 'type') return i.type === filter.t
        if (filter.kind === 'tag') return i.tags.some((t) => t.toLowerCase() === filter.tag.toLowerCase())
        return true
      })
      .filter((i) => !s || i.name.toLowerCase().includes(s) || (i.sub ?? '').toLowerCase().includes(s) || i.tags.some((t) => t.toLowerCase().includes(s)))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite))
  }, [items, q, filter])

  const lock = async () => { await api('POST', '/lock').catch(() => {}); refresh() }
  const counts = (t: ItemType) => items.filter((i) => i.type === t).length
  const favCount = items.filter((i) => i.favorite).length
  const detail = pane.mode !== 'none'

  const nav = (label: string, f: Filter, icon: React.ReactNode, n?: number) => (
    <button key={label} onClick={() => { setFilter(f); setPane({ mode: 'none' }) }} className={`flex w-full items-center gap-2 h-9 rounded-lg px-2.5 text-left text-sm hover:bg-muted ${same(filter, f) ? 'bg-muted font-medium' : ''}`}>
      {icon}<span className="flex-1 truncate">{label}</span>{n !== undefined && <span className="text-xs text-muted-foreground">{n}</span>}
    </button>
  )

  return (
    <div className="flex h-svh bg-background">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/20 p-3 md:flex">
        <div className="mb-4 flex items-center gap-2 px-1.5 text-base font-semibold"><Lock className="size-4" /> saku</div>
        <nav className="space-y-0.5">
          {nav('All items', { kind: 'all' }, <Layers className="size-4" />, items.length)}
          {nav('Favorites', { kind: 'fav' }, <Star className="size-4" />, favCount)}
        </nav>
        <div className="mt-4 mb-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Types</div>
        <nav className="space-y-0.5">{TYPE_KEYS.map((t) => nav(TYPES[t].plural, { kind: 'type', t }, (() => { const I = TYPES[t].icon; return <I className="size-4" /> })(), counts(t)))}</nav>
        {allTags.length > 0 && <div className="mt-4 mb-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</div>}
        <nav className="-mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">{allTags.map((t) => nav(t, { kind: 'tag', tag: t }, <Tag className="size-4" />))}</nav>
        <div className="mt-2 space-y-0.5 border-t pt-2">
          <Button variant="ghost" className="w-full justify-start" onClick={() => setGen(true)}><Dices /> Generator</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => setCfg(true)}><Cog /> Settings</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={lock}><Lock /> Lock</Button>
        </div>
      </aside>

      <section className={`${detail ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r md:w-80`}>
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search" className="pl-8" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon" aria-label="New item" />}><Plus /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44 max-w-[calc(100vw-1.5rem)] whitespace-nowrap">
                {TYPE_KEYS.map((t) => { const I = TYPES[t].icon; return <DropdownMenuItem key={t} onClick={() => setPane({ mode: 'new', t })}><I /> {TYPES[t].label}</DropdownMenuItem> })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex gap-1 md:hidden">
            <Button variant="outline" size="sm" onClick={() => setGen(true)}><Dices /></Button>
            <Button variant="outline" size="sm" onClick={() => setCfg(true)}><Cog /></Button>
            <Button variant="outline" size="sm" onClick={lock}><Lock /></Button>
            <NativeSelect aria-label="Filter" className="min-w-0 flex-1" value={JSON.stringify(filter)} onChange={(e) => setFilter(JSON.parse(e.target.value))}>
              <option value={JSON.stringify({ kind: 'all' })}>All items</option>
              <option value={JSON.stringify({ kind: 'fav' })}>Favorites</option>
              {TYPE_KEYS.map((t) => <option key={t} value={JSON.stringify({ kind: 'type', t })}>{TYPES[t].plural}</option>)}
              {allTags.map((t) => <option key={t} value={JSON.stringify({ kind: 'tag', tag: t })}>#{t}</option>)}
            </NativeSelect>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{items.length ? 'No matches.' : 'Nothing here yet. Press + to add your first item.'}</div>
          ) : shown.map((i) => {
            const I = TYPES[i.type].icon
            const active = pane.mode === 'view' && pane.id === i.id
            return (
              <button key={i.id} onClick={() => setPane({ mode: 'view', id: i.id })} className={`flex w-full items-center gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/50 ${active ? 'bg-muted' : ''}`}>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><I className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{i.sub || TYPES[i.type].label}</div>
                </div>
                {i.favorite && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />}
              </button>
            )
          })}
        </div>
      </section>

      <main className={`${detail ? 'block' : 'hidden md:block'} min-w-0 flex-1 overflow-y-auto`}>
        {detail && (
          <button onClick={() => setPane({ mode: 'none' })} className="flex items-center gap-1 px-4 pt-3 text-sm text-muted-foreground md:hidden"><ArrowLeft className="size-4" /> Back</button>
        )}
        {pane.mode === 'none' && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select an item</div>}
        {pane.mode === 'view' && <ItemView key={pane.id} id={pane.id} onChanged={load} onOpen={(id) => setPane({ mode: 'view', id })} onDeleted={() => { setPane({ mode: 'none' }); load() }} onEdit={(it) => setPane({ mode: 'edit', item: it })} onTag={(t) => { setFilter({ kind: 'tag', tag: t }); setPane({ mode: 'none' }) }} />}
        {pane.mode === 'new' && <ItemForm key={'n' + pane.t} startType={pane.t} tags={allTags} onCancel={() => setPane({ mode: 'none' })} onSaved={(it) => { load(); setPane({ mode: 'view', id: it.id }) }} />}
        {pane.mode === 'edit' && <ItemForm key={pane.item.id} item={pane.item} startType={pane.item.type} tags={allTags} onCancel={() => setPane({ mode: 'view', id: pane.item.id })} onSaved={(it) => { load(); setPane({ mode: 'view', id: it.id }) }} />}
      </main>

      <Generator open={gen} onClose={() => setGen(false)} />
      <Settings open={cfg} onClose={() => setCfg(false)} autolock={st.autolock} onAutolock={(n) => setSt({ ...st, autolock: n })} onImported={load} />
    </div>
  )
}
