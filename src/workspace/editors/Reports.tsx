import { useState } from 'react'
import type { Transaction } from '../../data/types'
import { netTotal } from '../../lib/ai'
import { dateKey, daysBetween, downloadCsv, num, peso, shortDate, time } from '../../lib/format'
import { useStore } from '../../store/StoreContext'
import { Modal, Segmented } from '../ui'

type Range = 'Today' | 'Yesterday' | '7 days'
type ReportName = 'X-Reading' | 'Z-Reading' | 'e-Journal' | 'VAT Summary' | 'Sales by Item' | 'Inventory Valuation' | 'Waste Report' | 'Cashier Performance'

interface ReportData { summary: [string, string][]; headers: string[]; rows: (string | number)[][] }

const catalog: [ReportName, string, string, string][] = [
  ['X-Reading', 'Mid-shift sales summary', 'SHIFT REPORT', '↗'], ['Z-Reading', 'End-of-day register close', 'DAILY CLOSE', '▥'],
  ['e-Journal', 'Electronic sales journal', 'BIR COMPLIANT', '≡'], ['VAT Summary', 'Output tax by day', 'TAX SUMMARY', '₱'],
  ['Sales by Item', 'Units, revenue & margin', 'OPERATIONS', '▤'], ['Inventory Valuation', 'Stock value at cost & retail', 'INVENTORY', '◫'],
  ['Waste Report', 'Write-offs by reason & item', 'LOSS PREVENTION', '⌁'], ['Cashier Performance', 'Sales & refunds by cashier', 'PEOPLE', '♙'],
]

export function ReportsPanel() {
  const { state } = useStore()
  const [range, setRange] = useState<Range>('Today')
  const [open, setOpen] = useState<ReportName | null>(null)
  const now = new Date()
  const inRange = (date: string) => { const d = daysBetween(date, now); return range === 'Today' ? d === 0 : range === 'Yesterday' ? d === 1 : d >= 0 && d < 7 }
  const txns = state.transactions.filter((t) => inRange(t.date))
  const valid = txns.filter((t) => t.status !== 'Voided')
  const s = state.settings
  const sum = (list: Transaction[], f: (t: Transaction) => number) => list.reduce((acc, t) => acc + f(t), 0)
  const refunds = valid.reduce((acc, t) => acc + t.refunds.reduce((x, r) => x + r.amount, 0), 0)
  const productName = (id: string) => state.products.find((p) => p.id === id)?.name ?? id

  function build(name: ReportName): ReportData {
    const gross = sum(valid, (t) => t.gross)
    const reading = (): ReportData => ({
      summary: [['Beginning OR', txns[0]?.number ?? '—'], ['Ending OR', txns[txns.length - 1]?.number ?? '—'], ['Transactions', num(valid.length)], ['Gross sales', peso(gross)], ['Less VAT (SC/PWD)', peso(sum(valid, (t) => t.lessVat))], ['SC/PWD discounts', peso(sum(valid, (t) => t.discount))], ['Refunds', peso(refunds)], ['Voids', `${txns.length - valid.length} · ${peso(sum(txns.filter((t) => t.status === 'Voided'), (t) => t.total))}`], ['Net sales', peso(sum(valid, netTotal))], ['VATable sales', peso(sum(valid.filter((t) => t.customerType === 'Regular'), (t) => t.total - t.vat))], ['VAT amount', peso(sum(valid, (t) => t.vat))], ['VAT-exempt sales', peso(sum(valid, (t) => t.vatExempt))], ...(name === 'Z-Reading' ? [['Accumulated grand total', peso(sum(state.transactions.filter((t) => t.status !== 'Voided'), netTotal))] as [string, string]] : [])],
      headers: ['Payment method', 'Transactions', 'Amount'],
      rows: (['Cash', 'GCash', 'Card', 'Maya'] as const).map((m) => [m, valid.filter((t) => t.payment.method === m).length, sum(valid.filter((t) => t.payment.method === m), netTotal).toFixed(2)]),
    })
    switch (name) {
      case 'X-Reading':
      case 'Z-Reading': return reading()
      case 'e-Journal': return { summary: [['Receipts', num(txns.length)], ['Net', peso(sum(valid, netTotal))]], headers: ['Receipt', 'Date', 'Time', 'Customer', 'Method', 'Gross', 'Discount', 'VAT', 'Total', 'Status'], rows: txns.map((t) => [t.number, shortDate(t.date), time(t.date), t.customerType, t.payment.method, t.gross.toFixed(2), (t.discount + t.lessVat).toFixed(2), t.vat.toFixed(2), t.total.toFixed(2), t.status]) }
      case 'VAT Summary': {
        const days = [...new Set(valid.map((t) => dateKey(t.date)))].sort()
        return { summary: [['VATable sales', peso(sum(valid.filter((t) => t.customerType === 'Regular'), (t) => t.total - t.vat))], ['Output VAT', peso(sum(valid, (t) => t.vat))], ['VAT-exempt sales', peso(sum(valid, (t) => t.vatExempt))], ['VAT rate', `${Math.round(s.vatRate * 100)}%`]],
          headers: ['Date', 'VATable sales', 'VAT', 'VAT-exempt', 'SC/PWD discount'],
          rows: days.map((d) => { const list = valid.filter((t) => dateKey(t.date) === d); return [d, sum(list.filter((t) => t.customerType === 'Regular'), (t) => t.total - t.vat).toFixed(2), sum(list, (t) => t.vat).toFixed(2), sum(list, (t) => t.vatExempt).toFixed(2), sum(list, (t) => t.discount).toFixed(2)] }) }
      }
      case 'Sales by Item': {
        const items = new Map<string, { qty: number; revenue: number }>()
        valid.forEach((t) => t.lines.forEach((l) => { const x = items.get(l.productId) ?? { qty: 0, revenue: 0 }; x.qty += l.qty; x.revenue += l.qty * l.price * (t.total / (t.gross || 1)); items.set(l.productId, x) }))
        const rows = [...items].sort((a, b) => b[1].revenue - a[1].revenue).map(([id, x]) => { const cost = (state.products.find((p) => p.id === id)?.cost ?? 0) * x.qty; const exVat = x.revenue / (1 + s.vatRate); return [productName(id), x.qty, x.revenue.toFixed(2), cost.toFixed(2), `${exVat ? (((exVat - cost) / exVat) * 100).toFixed(1) : '0.0'}%`] })
        return { summary: [['Items sold', num([...items.values()].reduce((a, x) => a + x.qty, 0))], ['Distinct products', num(items.size)]], headers: ['Product', 'Units', 'Revenue', 'Cost', 'Margin (ex-VAT)'], rows }
      }
      case 'Inventory Valuation': {
        const cats = [...new Set(state.products.map((p) => p.category))]
        const rows = cats.map((c) => { const ps = state.products.filter((p) => p.category === c); return [c, ps.length, ps.reduce((a, p) => a + p.stock, 0), ps.reduce((a, p) => a + p.stock * p.cost, 0).toFixed(2), ps.reduce((a, p) => a + p.stock * p.price, 0).toFixed(2)] })
        return { summary: [['Value at cost', peso(state.products.reduce((a, p) => a + p.stock * p.cost, 0))], ['Value at retail', peso(state.products.reduce((a, p) => a + p.stock * p.price, 0))], ['As of', `${shortDate(now)} ${time(now)}`]], headers: ['Category', 'Products', 'Units', 'At cost', 'At retail'], rows }
      }
      case 'Waste Report': {
        const entries = state.waste.filter((w) => inRange(w.date))
        return { summary: [['Entries', num(entries.length)], ['Total at cost', peso(entries.reduce((a, w) => a + w.value, 0))]], headers: ['Date', 'Product', 'Qty', 'Reason', 'Value', 'Notes'], rows: entries.map((w) => [shortDate(w.date), productName(w.productId), w.qty, w.reason, w.value.toFixed(2), w.notes]) }
      }
      case 'Cashier Performance': {
        const rows = state.employees.map((e) => { const list = valid.filter((t) => t.cashierId === e.id); const net = sum(list, netTotal); return [e.name, list.length, net.toFixed(2), list.length ? (net / list.length).toFixed(2) : '0.00', sum(list, (t) => t.refunds.length)] }).filter((r) => Number(r[1]) > 0)
        return { summary: [['Cashiers active', num(rows.length)]], headers: ['Cashier', 'Receipts', 'Net sales', 'Avg basket', 'Refunds'], rows }
      }
    }
  }

  const data = open ? build(open) : null
  const rangeLabel = range === '7 days' ? `${shortDate(new Date(now.getTime() - 6 * 86_400_000))} – ${shortDate(now)}` : shortDate(range === 'Today' ? now : new Date(now.getTime() - 86_400_000))

  return <div className="module-panel reports-panel">
    <div className="module-intro"><div><span className="eyebrow">REPORT CENTER</span><h2>Reports &amp; compliance</h2><p>Operational summaries and BIR-aligned records for {s.storeName}. {rangeLabel}.</p></div><Segmented label="Date range" options={['Today', 'Yesterday', '7 days'] as const} value={range} onChange={setRange} /></div>
    <div className="report-grid">{catalog.map(([name, description, tag, icon]) => <button className="report-card" key={name} onClick={() => setOpen(name)}><span className="report-icon">{icon}</span><span className="report-tag">{tag}</span><b>{name}</b><small>{description}</small><i>OPEN REPORT ↗</i></button>)}</div>
    {open && data && <Modal wide title={open} eyebrow={`${s.businessName.toUpperCase()} · ${rangeLabel.toUpperCase()}`} onClose={() => setOpen(null)} footer={<><button className="outline-button" onClick={() => downloadCsv(`${open.toLowerCase().replace(/\s+/g, '-')}-${dateKey(now)}.csv`, data.headers, data.rows)}>↓ CSV</button><button className="primary-button" onClick={() => window.print()}>PRINT ⎙</button></>}>
      <div className="print-area report-print">
        <div className="report-summary">{data.summary.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr>{data.headers.map((h) => <th key={h}>{h.toUpperCase()}</th>)}</tr></thead><tbody>{data.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{j === 0 ? <b>{cell}</b> : cell}</td>)}</tr>)}</tbody></table>{data.rows.length === 0 && <p className="muted-text">No records in this range.</p>}</div>
        <p className="muted-text">TIN {s.tin} · MIN {s.machineSerial} · Generated {shortDate(now)} {time(now)}</p>
      </div>
    </Modal>}
  </div>
}
