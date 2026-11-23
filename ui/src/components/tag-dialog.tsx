import { useState } from 'react'
import { api } from '@/lib/api'
import { TAG_COLORS, type TagColor, type TagColors } from '@/lib/tags'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { FieldError, Label } from '@/components/ui/label'

export function TagDialog({ tag, colors, onClose, onSaved }: { tag: string | null; colors: TagColors; onClose: () => void; onSaved: (oldName: string, name: string) => void }) {
  return (
    <Dialog open={!!tag} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">{tag && <Body key={tag} tag={tag} colors={colors} onClose={onClose} onSaved={onSaved} />}</DialogContent>
    </Dialog>
  )
}

function Body({ tag, colors, onClose, onSaved }: { tag: string; colors: TagColors; onClose: () => void; onSaved: (o: string, n: string) => void }) {
  const [name, setName] = useState(tag)
  const [color, setColor] = useState(colors[tag.toLowerCase()] ?? '')
  const [err, setErr] = useState('')
  const [nameErr, setNameErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!name.trim()) return setNameErr('Name is required.')
    setNameErr('')
    setBusy(true)
    try {
      await api('POST', '/tags', { old: tag, name: name.trim(), color })
      onSaved(tag, name.trim())
      onClose()
    } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Edit tag</DialogTitle>
        <DialogDescription>Renaming updates every item that uses this tag. Using an existing name merges them.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="tag-name" required>Name</Label>
        <Input id="tag-name" autoFocus value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setNameErr('') }} aria-invalid={!!nameErr} />
        <FieldError>{nameErr}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
          <button type="button" role="radio" aria-checked={color === ''} aria-label="None" title="None" onClick={() => setColor('')}
            className={`size-7 border bg-background ${color === '' ? 'border-foreground ring-1 ring-foreground' : ''}`}>
            <span className="block h-px w-full -rotate-45 bg-muted-foreground" />
          </button>
          {(Object.keys(TAG_COLORS) as TagColor[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} title={c} onClick={() => setColor(c)}
              className={`size-7 border border-transparent ${TAG_COLORS[c].dot} ${color === c ? 'border-foreground ring-1 ring-foreground ring-offset-2' : ''}`} />
          ))}
        </div>
      </div>
      <FieldError>{err}</FieldError>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy}>Save</Button>
      </DialogFooter>
    </form>
  )
}
