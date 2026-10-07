// Server copy of src/lib/pos.ts computeTotals: the server recomputes every sale from its own prices,
// so a terminal can't send its own totals. Keep the two in step.

export type CustomerType = 'Regular' | 'Senior' | 'PWD'

export const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Shelf prices are VAT-inclusive. Senior citizens and PWDs get 20% off the
 * VAT-exclusive price and are VAT-exempt (RA 9994 / RA 10754).
 */
export function computeTotals(lines: { price: number; qty: number }[], customerType: CustomerType, vatRate: number) {
  const gross = round2(lines.reduce((sum, line) => sum + line.price * line.qty, 0))
  if (customerType === 'Regular') {
    return { gross, lessVat: 0, discount: 0, vat: round2(gross - gross / (1 + vatRate)), vatExempt: 0, total: gross }
  }
  const base = gross / (1 + vatRate)
  const discount = round2(base * 0.2)
  return { gross, lessVat: round2(gross - base), discount, vat: 0, vatExempt: round2(base), total: round2(base - discount) }
}

/** Store-local DATETIME string from MySQL ("2026-10-06 08:00:12", UTC+8) → ISO string for the UI. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(`${value.replace(' ', 'T')}${value.length <= 10 ? 'T00:00:00' : ''}+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
