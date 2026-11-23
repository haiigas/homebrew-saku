export const TAG_COLORS = {
  red: { dot: 'bg-red-500', text: 'text-red-500', chip: 'border-red-300 bg-red-50 text-red-800' },
  orange: { dot: 'bg-orange-500', text: 'text-orange-500', chip: 'border-orange-300 bg-orange-50 text-orange-800' },
  amber: { dot: 'bg-amber-500', text: 'text-amber-500', chip: 'border-amber-300 bg-amber-50 text-amber-800' },
  green: { dot: 'bg-green-500', text: 'text-green-500', chip: 'border-green-300 bg-green-50 text-green-800' },
  teal: { dot: 'bg-teal-500', text: 'text-teal-500', chip: 'border-teal-300 bg-teal-50 text-teal-800' },
  blue: { dot: 'bg-blue-500', text: 'text-blue-500', chip: 'border-blue-300 bg-blue-50 text-blue-800' },
  violet: { dot: 'bg-violet-500', text: 'text-violet-500', chip: 'border-violet-300 bg-violet-50 text-violet-800' },
  pink: { dot: 'bg-pink-500', text: 'text-pink-500', chip: 'border-pink-300 bg-pink-50 text-pink-800' },
} as const

export type TagColor = keyof typeof TAG_COLORS
export type TagColors = Record<string, string>

export const chipClass = (colors: TagColors, tag: string) =>
  TAG_COLORS[colors[tag.toLowerCase()] as TagColor]?.chip ?? 'border-border bg-muted text-foreground'
