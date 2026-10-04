import type { CustomerType } from '../data/types'

const round2 = (value: number) => Math.round(value * 100) / 100

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

export function quickCashOptions(total: number) {
  const options = new Set<number>([Math.ceil(total)])
  for (const bill of [50, 100, 200, 500, 1000]) {
    const rounded = Math.ceil(total / bill) * bill
    if (rounded >= total) options.add(rounded)
  }
  return [...options].sort((a, b) => a - b).slice(0, 5)
}
