import { CreditCard, KeyRound, Landmark, Wifi, type LucideIcon } from 'lucide-react'
import type { ItemType } from './api'

export type Kind = 'text' | 'secret' | 'totp' | 'area' | 'urls' | 'custom' | 'link'
export type Field = { key: string; label: string; kind: Kind; section?: string; placeholder?: string }

export const TYPES: Record<ItemType, { label: string; plural: string; icon: LucideIcon; fields: Field[] }> = {
  login: {
    label: 'Login',
    plural: 'Logins',
    icon: KeyRound,
    fields: [
      { key: 'username', label: 'Username', kind: 'text', section: 'Details' },
      { key: 'password', label: 'Password', kind: 'secret' },
      { key: 'totp', label: '2FA key', kind: 'totp', placeholder: 'Base32 secret or otpauth:// URI' },
      { key: 'urls', label: 'Websites', kind: 'urls' },
      { key: 'fields', label: 'Custom fields', kind: 'custom' },
      { key: 'notes', label: 'Notes', kind: 'area' },
    ],
  },
  bank: {
    label: 'Bank account',
    plural: 'Bank accounts',
    icon: Landmark,
    fields: [
      { key: 'bank_name', label: 'Bank name', kind: 'text', section: 'Details' },
      { key: 'holder', label: 'Full name', kind: 'text' },
      { key: 'account_number', label: 'Account number', kind: 'text' },
      { key: 'swift', label: 'Shift / SWIFT code', kind: 'text' },
      { key: 'pin', label: 'PIN code', kind: 'secret' },
      { key: 'branch_name', label: 'Branch name', kind: 'text', section: 'Branch' },
      { key: 'branch_phone', label: 'Contact number', kind: 'text' },
      { key: 'branch_address', label: 'Address', kind: 'area' },
      { key: 'notes', label: 'Notes', kind: 'area', section: 'Notes' },
    ],
  },
  card: {
    label: 'Payment card',
    plural: 'Payment cards',
    icon: CreditCard,
    fields: [
      { key: 'holder', label: 'Card holder name', kind: 'text', section: 'Details' },
      { key: 'number', label: 'Card number', kind: 'text' },
      { key: 'expires', label: 'Expires', kind: 'text', placeholder: 'MM/YY' },
      { key: 'cvc', label: 'CVC', kind: 'secret' },
      { key: 'pin', label: 'PIN', kind: 'secret' },
      { key: 'bank_name', label: 'Bank name', kind: 'text' },
      { key: 'bank_url', label: 'Bank website', kind: 'link' },
      { key: 'notes', label: 'Notes', kind: 'area' },
    ],
  },
  wifi: {
    label: 'Wireless router',
    plural: 'Wireless routers',
    icon: Wifi,
    fields: [
      { key: 'ssid', label: 'Network name (SSID)', kind: 'text', section: 'Network' },
      { key: 'password', label: 'Wi-Fi password', kind: 'secret' },
      { key: 'ip', label: 'IP address', kind: 'link', placeholder: '192.168.1.1' },
      { key: 'admin_user', label: 'Admin username', kind: 'text', section: 'Admin' },
      { key: 'admin_password', label: 'Admin password', kind: 'secret' },
      { key: 'notes', label: 'Notes', kind: 'area', section: 'Notes' },
    ],
  },
}

export const TYPE_KEYS = Object.keys(TYPES) as ItemType[]

export const blank = (t: ItemType) => {
  const d: Record<string, any> = {}
  for (const f of TYPES[t].fields) d[f.key] = f.kind === 'urls' ? [''] : f.kind === 'custom' ? [] : ''
  return d
}

export const toHref = (v: string) => {
  const s = v.trim()
  if (!s) return null
  const u = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'http://' + s
  return /^https?:\/\//i.test(u) ? u : null
}
