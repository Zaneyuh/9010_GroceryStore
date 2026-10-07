export const DAY_MS = 86_400_000

export function peso(value: number, decimals = 2) {
  const sign = value < 0 ? '-' : ''
  return `${sign}₱${Math.abs(value).toLocaleString('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function compactPeso(value: number) {
  if (Math.abs(value) >= 1_000_000) return `₱${(value / 1_000_000).toFixed(2)}M`
  if (Math.abs(value) >= 10_000) return `₱${(value / 1000).toFixed(1)}k`
  return peso(value, 0)
}

export function num(value: number, decimals = 0) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function pct(value: number, decimals = 1, signed = true) {
  const text = `${(value * 100).toFixed(decimals)}%`
  return signed && value > 0 ? `+${text}` : text
}

export function startOfDay(date: Date | number | string) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function daysBetween(from: Date | number | string, to: Date | number | string) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
}

export function isSameDay(a: Date | number | string, b: Date | number | string) {
  return daysBetween(a, b) === 0
}

export function dateKey(date: Date | number | string) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function shortDate(date: Date | number | string) {
  return new Date(date).toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' })
}

export function time(date: Date | number | string) {
  return new Date(date).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

export function relativeDay(date: Date | number | string) {
  const diff = daysBetween(date, new Date())
  if (diff === 0) return `Today, ${time(date)}`
  if (diff === 1) return `Yesterday, ${time(date)}`
  return shortDate(date)
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
