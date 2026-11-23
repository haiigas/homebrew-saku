import { useState } from 'react'
import { TYPES } from '@/lib/schema'
import type { Item } from '@/lib/api'

// Site favicon (fetched by the local server) with the type icon as fallback.
export function ItemIcon({ item, box, icon }: { item: Pick<Item, 'type' | 'site'>; box: string; icon: string }) {
  const [failed, setFailed] = useState('')
  const T = TYPES[item.type]
  const ok = item.site && failed !== item.site
  return (
    <div className={`flex shrink-0 items-center justify-center bg-muted ${box}`}>
      {ok ? (
        <img src={`/api/icon?host=${encodeURIComponent(item.site!)}`} alt="" loading="lazy" decoding="async" onError={() => setFailed(item.site!)} className={`object-contain ${icon}`} />
      ) : (
        <T.icon className={icon} />
      )}
    </div>
  )
}
