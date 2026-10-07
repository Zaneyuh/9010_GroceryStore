import { useState } from 'react'
import { categories, colorForCategory } from '../../data/defaults'
import type { Product } from '../../data/types'
import { compactPeso, dateKey, downloadCsv, num, peso, shortDate } from '../../lib/format'
import { useAnalytics, useStore, type UiState } from '../../store/StoreContext'
import { Empty, Field, Metric, Modal, Segmented, StatusPill } from '../ui'
import { Pager } from './Transactions'

export function InventoryMetrics() {
  const { state } = useStore()
  const { analyses } = useAnalytics()
  const value = state.products.reduce((s, p) => s + p.stock * p.cost, 0)
  const retail = state.products.reduce((s, p) => s + p.stock * p.price, 0)
  const low = analyses.filter((a) => a.urgency !== 'OK')
  const expiring = analyses.filter((a) => a.expiryDays !== null && a.expiryDays <= state.settings.expiryWarningDays)
  const out = state.products.filter((p) => p.stock <= 0).length
  return <div className="inventory-metrics"><div className="inventory-heading"><div><span className="eyebrow">STOCK OVERVIEW</span><h2>Inventory at a glance</h2></div>
    <button className="outline-button" onClick={() => downloadCsv('inventory.csv', ['SKU', 'Product', 'Category', 'On hand', 'Unit cost', 'Price', 'Value at cost', 'Expiry'], state.products.map((p) => [p.sku, p.name, p.category, p.stock, p.cost, p.price, (p.cost * p.stock).toFixed(2), p.expiry ? shortDate(p.expiry) : '']))}>↓ EXPORT</button></div>
    <div className="inventory-metric-grid">
      <Metric label="Active products" value={num(state.products.filter((p) => p.active).length)} change={`${out} out`} note="of stock" accent="green" />
      <Metric label="Inventory value" value={compactPeso(value)} change={compactPeso(retail)} note="at retail" accent="blue" />
      <Metric label="Below AI reorder level" value={String(low.length).padStart(2, '0')} change={`${low.filter((l) => l.urgency === 'Urgent').length} urgent`} note="forecast-driven" accent="red" />
      <Metric label="Near expiry" value={String(expiring.length).padStart(2, '0')} change={`next ${state.settings.expiryWarningDays} days`} note={`${analyses.filter((a) => a.atRiskUnits > 0).length} at risk`} accent="orange" />
    </div></div>
}

type SortKey = 'name' | 'stock' | 'cover' | 'expiry' | 'value'
const PAGE = 10

export function InventoryTable() {
  const { state, actions } = useStore()
  const { byId, abc } = useAnalytics()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'cover', dir: 1 })
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const filter = state.ui.inventoryFilter
  const q = query.trim().toLowerCase()

  const statusOf = (p: Product) => {
    const a = byId.get(p.id)
    if (p.stock <= 0) return 'Out of stock'
    if (a && a.expiryDays !== null && a.expiryDays <= state.settings.expiryWarningDays) return 'Near expiry'
    if (a && a.urgency !== 'OK') return 'Low stock'
    return 'In stock'
  }
  const rows = state.products
    .filter((p) => (category === 'All' || p.category === category) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q)))
    .filter((p) => filter === 'All' || statusOf(p) === filter)
    .sort((a, b) => {
      const ax = byId.get(a.id)
      const bx = byId.get(b.id)
      const value = (p: Product, x = byId.get(p.id)) => ({ name: p.name, stock: p.stock, cover: x?.daysOfCover ?? Infinity, expiry: p.expiry ? new Date(p.expiry).getTime() : Infinity, value: p.stock * p.cost })[sort.key]
      const va = value(a, ax)
      const vb = value(b, bx)
      return (typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir
    })
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const visible = rows.slice(page * PAGE, page * PAGE + PAGE)
  const header = (label: string, key?: SortKey) => <th key={label}>{key ? <button className="th-sort" onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 })}>{label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button> : label}</th>

  return <div className="table-panel">
    <div className="table-toolbar">
      <label className="search-field compact"><span>⌕</span><input placeholder="Filter by name, SKU or barcode" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} /></label>
      <div>
        <select className="select" aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0) }}><option>All</option>{[...new Set(state.products.map((p) => p.category))].map((c) => <option key={c}>{c}</option>)}</select>
        <button className="primary-button" onClick={() => setEditing('new')}>＋ ADD PRODUCT</button>
      </div>
    </div>
    <Segmented label="Stock status" options={['All', 'Low stock', 'Near expiry', 'Out of stock'] as const} value={filter} onChange={(v: UiState['inventoryFilter']) => { actions.setUi({ inventoryFilter: v }); setPage(0) }} />
    <div className="data-table-wrap"><table className="data-table"><thead><tr>{[header('PRODUCT', 'name'), header('CATEGORY'), header('ON HAND', 'stock'), header('AI REORDER AT'), header('DAYS OF COVER', 'cover'), header('STATUS'), header('EXPIRY', 'expiry'), header('VALUE', 'value'), header('')]}</tr></thead>
      <tbody>{visible.map((p) => {
        const a = byId.get(p.id)
        return <tr key={p.id}>
          <td><b>{p.name}</b><small>{p.sku} · CLASS {abc.get(p.id) ?? '–'}</small></td>
          <td>{p.category}</td>
          <td>{p.stock} {p.unit}s</td>
          <td>{a ? Math.ceil(a.reorderLevel) : p.reorderPoint}</td>
          <td className={a && a.daysOfCover <= p.leadTimeDays ? 'text-red' : ''}>{a && Number.isFinite(a.daysOfCover) ? `${a.daysOfCover.toFixed(1)} d` : '—'}</td>
          <td><StatusPill value={statusOf(p)} /></td>
          <td>{p.expiry ? shortDate(p.expiry) : '—'}</td>
          <td>{peso(p.stock * p.cost, 0)}</td>
          <td className="row-actions"><button onClick={() => setAdjusting(p)} title="Adjust stock">±</button><button onClick={() => setEditing(p)} title="Edit product">✎</button><button onClick={() => actions.navigate('AI Insights', { forecastProductId: p.id })} title="Open forecast">⌁</button></td>
        </tr>
      })}</tbody></table>
      {rows.length === 0 && <Empty>No products match.</Empty>}
    </div>
    <div className="table-foot"><span>SHOWING {visible.length} OF {rows.length} PRODUCTS</span><Pager page={page} pages={pages} onPage={setPage} /></div>
    {editing && <ProductModal product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    {adjusting && <AdjustModal product={adjusting} onClose={() => setAdjusting(null)} />}
  </div>
}

function ProductModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { state, actions } = useStore()
  const [draft, setDraft] = useState<Product>(() => product ?? {
    id: `p${Date.now().toString(36)}`, sku: `SKU-${String(state.products.length + 1).padStart(4, '0')}`, barcode: '', name: '', category: '', unit: 'pc', price: 0, cost: 0, stock: 0,
    reorderPoint: 5, leadTimeDays: 3, supplierId: '', expiry: null, color: colorForCategory(''), symbol: '', active: true,
  })
  const set = <K extends keyof Product>(key: K, value: Product[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const margin = draft.price ? (draft.price / (1 + state.settings.vatRate) - draft.cost) / (draft.price / (1 + state.settings.vatRate)) : 0
  const valid = draft.name.trim() && draft.price > 0
  // Suggestions: what other products already use, plus the usual grocery categories. Anything can be typed.
  const knownCategories = [...new Set([...state.products.map((p) => p.category), ...categories])].filter(Boolean).sort()
  const knownSuppliers = [...new Set(state.products.map((p) => p.supplierId))].filter(Boolean).sort()

  function save() {
    if (!valid) return
    const category = draft.category.trim() || 'Uncategorized'
    actions.saveProduct({ ...draft, name: draft.name.trim(), category, supplierId: draft.supplierId.trim(), symbol: draft.name.trim()[0].toUpperCase(), color: colorForCategory(category) })
    actions.toast(product ? 'Product updated' : 'Product added to catalog')
    onClose()
  }

  return <Modal title={product ? `Edit ${product.name}` : 'Add product'} eyebrow="CATALOG" wide onClose={onClose} footer={<>{product && <button className="outline-button" onClick={() => { actions.saveProduct({ ...draft, active: !draft.active }); onClose() }}>{draft.active ? 'ARCHIVE' : 'RESTORE'}</button>}<span className="spacer" /><button className="outline-button" onClick={onClose}>CANCEL</button><button className="primary-button" disabled={!valid} onClick={save}>SAVE PRODUCT</button></>}>
    <div className="form-grid">
      <Field label="PRODUCT NAME"><input autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="CATEGORY"><input list="product-categories" value={draft.category} placeholder="e.g. Canned Goods" onChange={(e) => set('category', e.target.value)} /><datalist id="product-categories">{knownCategories.map((c) => <option key={c} value={c} />)}</datalist></Field>
      <Field label="SKU"><input value={draft.sku} onChange={(e) => set('sku', e.target.value)} /></Field>
      <Field label="BARCODE"><input value={draft.barcode} inputMode="numeric" onChange={(e) => set('barcode', e.target.value.replace(/\D/g, ''))} /></Field>
      <Field label="SELLING PRICE (VAT INCL.)"><input type="number" min={0} step={0.25} value={draft.price} onChange={(e) => set('price', Number(e.target.value))} /></Field>
      <Field label="UNIT COST" hint={`Gross margin ${(margin * 100).toFixed(1)}% (ex-VAT)`}><input type="number" min={0} step={0.25} value={draft.cost} onChange={(e) => set('cost', Number(e.target.value))} /></Field>
      <Field label="UNIT"><input value={draft.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
      <Field label="ON HAND"><input type="number" min={0} value={draft.stock} onChange={(e) => set('stock', Number(e.target.value))} /></Field>
      <Field label="MIN. REORDER POINT" hint="AI raises this when forecast demand is higher."><input type="number" min={0} value={draft.reorderPoint} onChange={(e) => set('reorderPoint', Number(e.target.value))} /></Field>
      <Field label="SUPPLIER"><input list="product-suppliers" value={draft.supplierId} placeholder="Supplier name" onChange={(e) => set('supplierId', e.target.value)} /><datalist id="product-suppliers">{knownSuppliers.map((name) => <option key={name} value={name} />)}</datalist></Field>
      <Field label="LEAD TIME (DAYS)"><input type="number" min={0} value={draft.leadTimeDays} onChange={(e) => set('leadTimeDays', Number(e.target.value))} /></Field>
      <Field label="NEAREST EXPIRY"><input type="date" value={draft.expiry ? dateKey(draft.expiry) : ''} onChange={(e) => set('expiry', e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null)} /></Field>
    </div>
  </Modal>
}

function AdjustModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { actions } = useStore()
  const [mode, setMode] = useState<'Receive' | 'Count' | 'Remove'>('Receive')
  const [qty, setQty] = useState(0)
  const [note, setNote] = useState('')
  const delta = mode === 'Receive' ? qty : mode === 'Remove' ? -qty : qty - product.stock
  return <Modal title={`Adjust stock · ${product.name}`} eyebrow="STOCK MOVEMENT" onClose={onClose} footer={<><button className="outline-button" onClick={onClose}>CANCEL</button><button className="primary-button" disabled={delta === 0} onClick={() => { actions.adjustStock(product.id, delta, [mode, note.trim()].filter(Boolean).join(': ')); actions.toast(`${product.name}: ${delta > 0 ? '+' : ''}${delta} ${product.unit}s`); onClose() }}>APPLY {delta > 0 ? '+' : ''}{delta}</button></>}>
    <Segmented label="Adjustment type" options={['Receive', 'Count', 'Remove'] as const} value={mode} onChange={(m) => { setMode(m); setQty(m === 'Count' ? product.stock : 0) }} />
    <div className="form-grid">
      <Field label={mode === 'Count' ? 'COUNTED ON SHELF' : 'QUANTITY'}><input autoFocus type="number" min={0} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value)))} /></Field>
      <Field label="NOTE"><input value={note} placeholder={mode === 'Remove' ? 'Use the Waste log for spoilage' : 'Delivery receipt #, count sheet…'} onChange={(e) => setNote(e.target.value)} /></Field>
    </div>
    <p className="muted-text">Current: <b>{product.stock}</b> → New: <b>{Math.max(0, product.stock + delta)}</b> {product.unit}s</p>
  </Modal>
}
