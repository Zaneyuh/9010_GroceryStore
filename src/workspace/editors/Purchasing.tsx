import { useState } from 'react'
import { suppliers } from '../../data/mockData'
import type { PurchaseOrder } from '../../data/types'
import { peso, shortDate } from '../../lib/format'
import { useAnalytics, useStore } from '../../store/StoreContext'
import { Empty, Modal, Segmented, StatusPill } from '../ui'

const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? id

export function PurchasingPanel() {
  const { state, actions } = useStore()
  const { analyses } = useAnalytics()
  const suggestions = analyses.filter((a) => a.suggestedQty > 0).sort((a, b) => a.daysOfCover - b.daysOfCover)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const qtyFor = (id: string, fallback: number) => overrides[id] ?? fallback
  const chosen = suggestions.filter((a) => !excluded.has(a.product.id) && qtyFor(a.product.id, a.suggestedQty) > 0)
  const total = chosen.reduce((s, a) => s + qtyFor(a.product.id, a.suggestedQty) * a.product.cost, 0)
  const supplierCount = new Set(chosen.map((a) => a.product.supplierId)).size

  function create() {
    actions.createPurchaseOrders(chosen.map((a) => ({ productId: a.product.id, qty: qtyFor(a.product.id, a.suggestedQty) })), 'AI suggestion')
    actions.toast(`${supplierCount} draft purchase order${supplierCount === 1 ? '' : 's'} created`)
    setOverrides({}); setExcluded(new Set())
  }

  return <div className="module-panel">
    <div className="module-intro"><div><span className="eyebrow">AI-ASSISTED REPLENISHMENT</span><h2>Suggested purchase orders</h2><p>Quantities cover forecast demand over the supplier lead time plus {state.settings.coverDays} days, with safety stock for a {Math.round(state.settings.serviceLevel * 100)}% service level.</p></div>
      <button className="primary-button" disabled={!chosen.length} onClick={create}>＋ CREATE {supplierCount || ''} PO{supplierCount === 1 ? '' : 'S'} · {peso(total, 0)}</button></div>
    {suggestions.length === 0 ? <Empty>Every product is above its reorder level. Nice!</Empty> : <div className="data-table-wrap"><table className="data-table"><thead><tr>{['', 'PRODUCT', 'ON HAND', 'ON ORDER', 'FORECAST / WK', 'COVER', 'SAFETY', 'ORDER QTY', 'SUPPLIER', 'COST'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{suggestions.map((a) => {
        const qty = qtyFor(a.product.id, a.suggestedQty)
        const on = !excluded.has(a.product.id)
        return <tr key={a.product.id} className={on ? '' : 'muted-row'}>
          <td><input type="checkbox" aria-label={`Include ${a.product.name}`} checked={on} onChange={() => setExcluded((s) => { const n = new Set(s); if (on) n.add(a.product.id); else n.delete(a.product.id); return n })} /></td>
          <td><b>{a.product.name}</b><small>{a.urgency === 'Urgent' ? '⚠ STOCK-OUT BEFORE DELIVERY' : 'BELOW REORDER LEVEL'}</small></td>
          <td>{a.product.stock}</td><td>{a.onOrder || '—'}</td><td>{a.weeklyDemand.toFixed(1)}</td>
          <td className={a.urgency === 'Urgent' ? 'text-red' : ''}>{Number.isFinite(a.daysOfCover) ? `${a.daysOfCover.toFixed(1)} d` : '—'}</td>
          <td>{Math.ceil(a.safetyStock)}</td>
          <td><input className="cell-input" type="number" min={0} value={qty} onChange={(e) => setOverrides({ ...overrides, [a.product.id]: Math.max(0, Number(e.target.value)) })} />{qty !== a.suggestedQty && <small>AI: {a.suggestedQty}</small>}</td>
          <td>{supplierName(a.product.supplierId)}<small>{a.product.leadTimeDays}D LEAD TIME</small></td>
          <td>{peso(qty * a.product.cost, 0)}</td>
        </tr>
      })}</tbody></table></div>}
    <div className="wma-evidence"><span className="evidence-icon">⌁</span><div><b>{state.settings.forecastMethod} forecast evidence</b><small>{suggestions.length} products matched reorder thresholds · model refreshed with every sale</small></div><button onClick={() => actions.navigate('AI Insights', suggestions[0] ? { forecastProductId: suggestions[0].product.id } : undefined)}>INSPECT FORECAST →</button></div>
  </div>
}

export function PurchaseOrdersPanel() {
  const { state, actions } = useStore()
  const [status, setStatus] = useState<'Open' | 'All'>('Open')
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null)
  const rows = state.purchaseOrders.filter((po) => status === 'All' || po.status === 'Draft' || po.status === 'Sent')
  const poTotal = (po: PurchaseOrder) => po.lines.reduce((s, l) => s + l.qty * l.cost, 0)
  const product = (id: string) => state.products.find((p) => p.id === id)

  function setPoStatus(po: PurchaseOrder, next: PurchaseOrder['status']) {
    actions.setPurchaseOrderStatus(po.id, next)
    actions.toast(next === 'Received' ? `${po.number} received; stock updated` : `${po.number} marked ${next.toLowerCase()}`)
    setViewing(null)
  }

  return <div className="module-panel">
    <div className="module-intro"><div><span className="eyebrow">SUPPLIERS</span><h2>Purchase orders</h2><p>Send drafts to suppliers, then receive deliveries to update stock on hand.</p></div><Segmented label="Status" options={['Open', 'All'] as const} value={status} onChange={setStatus} /></div>
    <div className="data-table-wrap"><table className="data-table clickable"><thead><tr>{['PO NUMBER', 'SUPPLIER', 'ITEMS', 'CREATED', 'EXPECTED', 'TOTAL', 'STATUS'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((po) => <tr key={po.id} onClick={() => setViewing(po)}><td><b>{po.number}</b><small>{po.source.toUpperCase()}</small></td><td>{supplierName(po.supplierId)}</td><td>{po.lines.length}</td><td>{shortDate(po.created)}</td><td>{shortDate(po.expected)}</td><td>{peso(poTotal(po), 0)}</td><td><StatusPill value={po.status} /></td></tr>)}</tbody></table>
      {rows.length === 0 && <Empty>No open purchase orders.</Empty>}</div>
    {viewing && <Modal wide title={viewing.number} eyebrow={supplierName(viewing.supplierId).toUpperCase()} onClose={() => setViewing(null)} footer={<>
      {(viewing.status === 'Draft' || viewing.status === 'Sent') && <button className="outline-button" onClick={() => setPoStatus(viewing, 'Cancelled')}>CANCEL PO</button>}
      <span className="spacer" />
      {viewing.status === 'Draft' && <button className="primary-button" onClick={() => setPoStatus(viewing, 'Sent')}>MARK AS SENT</button>}
      {viewing.status === 'Sent' && <button className="primary-button" onClick={() => setPoStatus(viewing, 'Received')}>RECEIVE DELIVERY</button>}
    </>}>
      <p className="muted-text">Created {shortDate(viewing.created)} · expected {shortDate(viewing.expected)} · <StatusPill value={viewing.status} /></p>
      <table className="data-table"><thead><tr><th>PRODUCT</th><th>QTY</th><th>UNIT COST</th><th>LINE TOTAL</th></tr></thead><tbody>
        {viewing.lines.map((l) => <tr key={l.productId}><td><b>{product(l.productId)?.name ?? l.productId}</b></td><td>{l.qty}</td><td>{peso(l.cost)}</td><td>{peso(l.qty * l.cost)}</td></tr>)}
      </tbody></table>
      <div className="form-actions"><span>TOTAL</span><b>{peso(poTotal(viewing))}</b></div>
    </Modal>}
  </div>
}
