import { X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

export function TagsInput({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [txt, setTxt] = useState('')
  const add = (raw: string) => {
    const t = raw.trim().replace(/,$/, '').trim()
    if (t && !value.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...value, t])
    setTxt('')
  }
  const rest = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()) && s.toLowerCase().includes(txt.toLowerCase())).slice(0, 8)
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={txt}
        placeholder="Add tag and press Enter"
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setTxt(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(txt)
          } else if (e.key === 'Backspace' && !txt && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => txt && add(txt)}
      />
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rest.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}>
              <Badge variant="outline">+ {s}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
