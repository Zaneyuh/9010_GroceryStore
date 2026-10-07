import { useMemo, useRef, useState } from 'react'
import type { PaymentMethod, Transaction } from '../../data/types'
import { basketRules } from '../../lib/ai'
import { peso, shortDate, time } from '../../lib/format'
import { computeTotals, quickCashOptions } from '../../lib/pos'
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll'
import { apiErrorMessage } from '../../services/api'
import { useCurrentUser, useStore } from '../../store/StoreContext'
import { Field, Modal, Segmented } from '../ui'

export function ProductGrid() {
  const { state, actions } = useStore()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All items')
  const inputRef = useRef<HTMLInputElement>(null)
  const pills = useHorizontalScroll<HTMLDivElement>()
  const products = state.products.filter((p) => p.active)
  const categories = ['All items', ...new Set(products.map((p) => p.category))]
  const q = query.trim().toLowerCase()
  const filtered = products.filter((p) => (category === 'All items' || p.category === category) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase() === q || p.barcode.includes(q)))
  const inCart = new Map(state.cart.map((l) => [l.productId, l.qty]))

  function add(productId: string) {
    const product = state.products.find((p) => p.id === productId)
    if (!product) return
    if ((inCart.get(productId) ?? 0) >= product.stock) {
      actions.toast(`Only ${product.stock} ${product.name} in stock`, 'error')
      return
    }
    actions.addToCart(productId)
  }

  function onScan() {
    const exact = products.find((p) => p.barcode === q || p.sku.toLowerCase() === q)
    const target = exact ?? (filtered.length === 1 ? filtered[0] : null)
    if (target) {
      add(target.id)
      setQuery('')
    } else if (q) actions.toast(`No single product matches “${query}”`, 'error')
  }

  return <div className="pos-products">
    <div className="panel-toolbar">
      <label className="search-field"><span>⌕</span><input ref={inputRef} autoFocus placeholder="Search products, type SKU or scan barcode, then Enter" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onScan(); if (e.key === 'Escape') setQuery('') }} /><kbd>ENTER</kbd></label>
      <button className="scan-button" title="Simulate barcode scan" aria-label="Simulate barcode scan" onClick={() => { const p = products[Math.floor(Math.random() * products.length)]; setQuery(p.barcode); inputRef.current?.focus() }}>▥</button>
    </div>
    <div className="category-pills" ref={pills.attach}>{categories.map((item) => <button key={item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className="product-grid">{filtered.map((product) => <button className={product.stock <= 0 ? 'product-card sold-out' : 'product-card'} disabled={product.stock <= 0} key={product.id} onClick={() => add(product.id)}>
      <span className={`product-image ${product.color}`}><i>{product.symbol}</i><small>{product.category.toUpperCase()}</small></span>
      <span className="product-info"><b>{product.name}</b><span>{peso(product.price)}</span><small className={product.stock <= product.reorderPoint ? 'stock-low' : ''}>{product.stock <= 0 ? 'Out of stock' : `${product.stock} in stock`}</small></span>
      {inCart.has(product.id) ? <span className="product-add in-cart">{inCart.get(product.id)}</span> : <span className="product-add">+</span>}
    </button>)}</div>
    <div className="results-count">SHOWING {filtered.length} OF {products.length} PRODUCTS <button onClick={() => actions.navigate('Inventory')}>MANAGE CATALOG ↗</button></div>
  </div>
}

export function CartPanel() {
  const { state, actions } = useStore()
  const user = useCurrentUser()
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState<Transaction | null>(null)
  const [showHeld, setShowHeld] = useState(false)
  const lines = state.cart.map((line) => ({ ...line, product: state.products.find((p) => p.id === line.productId)! })).filter((l) => l.product)
  const totals = computeTotals(lines.map((l) => ({ price: l.product.price, qty: l.qty })), state.customerType, state.settings.vatRate)
  const rules = useMemo(() => basketRules(state.transactions), [state.transactions])
  const cartIds = new Set(state.cart.map((l) => l.productId))
  const suggestion = rules.find((r) => cartIds.has(r.a) && !cartIds.has(r.b) && (state.products.find((p) => p.id === r.b)?.stock ?? 0) > 0)
  const suggested = suggestion ? state.products.find((p) => p.id === suggestion.b) : undefined

  return <div className="cart-panel">
    <div className="cart-meta"><span>RECEIPT <b>#OR-{String(state.nextReceipt).padStart(6, '0')}</b> · {user?.name ?? 'Cashier'}</span><div><button onClick={() => setShowHeld(true)}>HELD ({state.heldCarts.length})</button><button disabled={!lines.length} onClick={() => { actions.holdCart(`Sale ${state.heldCarts.length + 1} · ${time(new Date())}`); actions.toast('Sale put on hold', 'info') }}>HOLD</button><button disabled={!lines.length} onClick={actions.clearCart}>CLEAR</button></div></div>
    <div className="cart-customer"><span className="eyebrow">CUSTOMER</span><Segmented label="Customer type" options={['Regular', 'Senior', 'PWD'] as const} value={state.customerType} onChange={actions.setCustomerType} /></div>
    <div className="cart-lines">
      {lines.length > 0 ? lines.map(({ product, qty }, index) => <div className="cart-line" key={product.id}>
        <span className="cart-line-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="cart-item-name"><b>{product.name}</b><small>{peso(product.price)} / {product.unit}</small></div>
        <div className="quantity-control">
          <button aria-label={`Remove one ${product.name}`} onClick={() => actions.setCartQty(product.id, qty - 1)}>−</button>
          <input aria-label={`${product.name} quantity`} value={qty} inputMode="numeric" onChange={(e) => { const value = Number(e.target.value.replace(/\D/g, '')); actions.setCartQty(product.id, Math.max(1, Math.min(product.stock, value))) }} />
          <button aria-label={`Add one ${product.name}`} disabled={qty >= product.stock} onClick={() => actions.setCartQty(product.id, qty + 1)}>+</button>
        </div>
        <strong>{peso(product.price * qty)}</strong>
      </div>) : <div className="empty-cart">Scan or tap a product to begin.</div>}
    </div>
    {suggested && suggestion && <button className="upsell" onClick={() => actions.addToCart(suggested.id)}><span>AI</span><div><b>Suggest: {suggested.name}</b><small>{Math.round(suggestion.confidence * 100)}% of customers buying {state.products.find((p) => p.id === suggestion.a)?.name} also buy this</small></div><i>+ {peso(suggested.price)}</i></button>}
    <div className="cart-bottom">
      <div className="cart-totals">
        <div><span>Subtotal ({lines.reduce((s, l) => s + l.qty, 0)} items)</span><b>{peso(totals.gross)}</b></div>
        {state.customerType !== 'Regular' ? <>
          <div><span>Less VAT (exempt)</span><b>−{peso(totals.lessVat)}</b></div>
          <div><span>{state.customerType} discount 20%</span><b>−{peso(totals.discount)}</b></div>
        </> : <div><span>VAT included ({Math.round(state.settings.vatRate * 100)}%)</span><b>{peso(totals.vat)}</b></div>}
        <div className="total-due"><span>TOTAL DUE</span><strong>{peso(totals.total)}</strong></div>
      </div>
      <button className="complete-sale" disabled={lines.length === 0} onClick={() => setPaying(true)}>CHARGE {peso(totals.total)} <span>→</span></button>
      <div className="payment-hint">{Object.entries(state.settings.payments).filter(([, on]) => on).map(([m]) => m.toUpperCase()).join(' · ')}</div>
    </div>
    {paying && <PaymentModal total={totals.total} onClose={() => setPaying(false)} onPaid={(txn) => { setPaying(false); setReceipt(txn) }} />}
    {receipt && <ReceiptModal txn={receipt} onClose={() => setReceipt(null)} />}
    {showHeld && <Modal title="Held sales" eyebrow="PARKED TRANSACTIONS" onClose={() => setShowHeld(false)}>
      {state.heldCarts.length === 0 && <p className="muted-text">No sales on hold.</p>}
      <div className="held-list">{state.heldCarts.map((held) => <div className="held-row" key={held.id}><div><b>{held.label}</b><small>{held.lines.reduce((s, l) => s + l.qty, 0)} items · {held.customerType}</small></div><button className="outline-button" onClick={() => actions.discardHeld(held.id)}>DISCARD</button><button className="primary-button" onClick={() => { actions.resumeCart(held.id); setShowHeld(false) }}>RESUME</button></div>)}</div>
    </Modal>}
  </div>
}

function PaymentModal({ total, onClose, onPaid }: { total: number; onClose: () => void; onPaid: (txn: Transaction) => void }) {
  const { state, actions } = useStore()
  const methods = (Object.keys(state.settings.payments) as PaymentMethod[]).filter((m) => state.settings.payments[m])
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'Cash')
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')
  // Senior/PWD sales must record the ID number and name on the card (RA 9994 / RA 10754).
  const discounted = state.customerType !== 'Regular'
  const [seniorPwd, setSeniorPwd] = useState({ id: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cash = Number(tendered) || 0
  const valid = (method === 'Cash' ? cash >= total : reference.trim().length >= 4) && (!discounted || (seniorPwd.id.trim().length >= 3 && seniorPwd.name.trim().length >= 2))

  async function pay() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const txn = await actions.checkout({
        method,
        tendered: method === 'Cash' ? cash : total,
        reference: method === 'Cash' ? undefined : reference.trim(),
        seniorPwd: discounted ? { id: seniorPwd.id.trim(), name: seniorPwd.name.trim() } : undefined,
      })
      if (txn) onPaid(txn)
    } catch (err) {
      setError(`Sale not completed: ${apiErrorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={`Collect ${peso(total)}`} eyebrow="PAYMENT" onClose={onClose} footer={<><button className="outline-button" disabled={busy} onClick={onClose}>CANCEL</button><button className="primary-button" disabled={!valid || busy} onClick={() => void pay()}>{busy ? 'SAVING…' : 'COMPLETE SALE →'}</button></>}>
    {discounted && <div className="form-row">
      <Field label={`${state.customerType === 'PWD' ? 'PWD' : 'SENIOR CITIZEN'} ID NO.`}><input value={seniorPwd.id} maxLength={50} onChange={(e) => setSeniorPwd({ ...seniorPwd, id: e.target.value })} /></Field>
      <Field label="NAME ON ID"><input value={seniorPwd.name} maxLength={100} onChange={(e) => setSeniorPwd({ ...seniorPwd, name: e.target.value })} /></Field>
    </div>}
    <div className="pay-methods">{methods.map((m) => <button key={m} className={method === m ? 'selected' : ''} onClick={() => setMethod(m)}><b>{m === 'Cash' ? '₱' : m === 'Card' ? '▭' : '◉'}</b>{m}</button>)}</div>
    {method === 'Cash' ? <>
      <Field label="CASH RECEIVED"><input autoFocus inputMode="decimal" value={tendered} placeholder="0.00" onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void pay() }} /></Field>
      <div className="quick-cash">{quickCashOptions(total).map((amount) => <button key={amount} onClick={() => setTendered(String(amount))}>{peso(amount, amount % 1 ? 2 : 0)}</button>)}</div>
      <div className={cash >= total ? 'change-due ok' : 'change-due'}><span>{cash >= total ? 'CHANGE DUE' : 'REMAINING'}</span><strong>{peso(Math.abs(cash - total))}</strong></div>
    </> : <Field label={method === 'Card' ? 'APPROVAL CODE' : `${method.toUpperCase()} REFERENCE NO.`} hint="Enter the reference shown on the customer's confirmation (min. 4 characters)."><input autoFocus value={reference} onChange={(e) => setReference(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void pay() }} /></Field>}
    {error && <p className="pin-error" role="alert">{error}</p>}
  </Modal>
}

export function ReceiptModal({ txn, onClose }: { txn: Transaction; onClose: () => void }) {
  return <Modal title={`Receipt ${txn.number}`} eyebrow={txn.status === 'Completed' ? 'SALE COMPLETE' : txn.status.toUpperCase()} onClose={onClose} footer={<><button className="outline-button" onClick={() => window.print()}>PRINT ⎙</button><button className="primary-button" autoFocus onClick={onClose}>NEW SALE →</button></>}>
    <Receipt txn={txn} />
  </Modal>
}

export function Receipt({ txn }: { txn: Transaction }) {
  const { state } = useStore()
  const s = state.settings
  const cashier = state.employees.find((e) => e.id === txn.cashierId)?.name ?? '—'
  const refunded = txn.refunds.reduce((sum, r) => sum + r.amount, 0)
  return <div className="receipt print-area">
    <div className="receipt-head"><b>{s.businessName}</b><span>{s.storeName}</span><span>{s.address}</span><span>VAT REG TIN {s.tin}</span><span>MIN {s.machineSerial} · PTU {s.permitNumber}</span></div>
    <div className="receipt-meta"><span>{txn.number}</span><span>{shortDate(txn.date)} {time(txn.date)}</span><span>Cashier: {cashier}</span><span>{txn.customerType}</span></div>
    <div className="receipt-lines">{txn.lines.map((line) => <div key={line.productId}><span>{line.name}</span><span>{line.qty} × {line.price.toFixed(2)}</span><b>{(line.qty * line.price).toFixed(2)}</b></div>)}</div>
    <div className="receipt-totals">
      <div><span>Subtotal</span><b>{txn.gross.toFixed(2)}</b></div>
      {txn.customerType !== 'Regular' && <><div><span>Less VAT</span><b>-{txn.lessVat.toFixed(2)}</b></div><div><span>{txn.customerType} disc. 20%</span><b>-{txn.discount.toFixed(2)}</b></div></>}
      <div className="grand"><span>TOTAL</span><b>{peso(txn.total)}</b></div>
      <div><span>{txn.payment.method}{txn.payment.reference ? ` · ${txn.payment.reference}` : ''}</span><b>{txn.payment.tendered.toFixed(2)}</b></div>
      {txn.payment.method === 'Cash' && <div><span>Change</span><b>{txn.payment.change.toFixed(2)}</b></div>}
      <div className="sub"><span>VATable sales</span><b>{(txn.customerType === 'Regular' ? txn.total - txn.vat : 0).toFixed(2)}</b></div>
      <div className="sub"><span>VAT ({Math.round(s.vatRate * 100)}%)</span><b>{txn.vat.toFixed(2)}</b></div>
      <div className="sub"><span>VAT-exempt sales</span><b>{txn.vatExempt.toFixed(2)}</b></div>
      {refunded > 0 && <div className="refund"><span>Refunded</span><b>-{refunded.toFixed(2)}</b></div>}
      {txn.status === 'Voided' && <div className="refund"><span>VOIDED</span><b>{txn.total.toFixed(2)}</b></div>}
    </div>
    <div className="receipt-foot"><span>{s.receiptHeader}</span><span>{s.receiptFooter}</span></div>
  </div>
}
