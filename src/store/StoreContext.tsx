import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildSeed, defaultSettings, employees as seedEmployees, type SeedData } from '../data/mockData'
import type {
  CartLine, CustomerRequest, CustomerType, Employee, HeldCart, PaymentMethod, Product, PurchaseOrder, RequestStatus, Settings, Transaction, WasteEntry, WasteReason, WorkspaceName,
} from '../data/types'
import { abcClasses, analyseProduct, buildInsights, type Insight, type ProductAnalysis } from '../lib/ai'
import { DAY_MS, isSameDay } from '../lib/format'
import { computeTotals } from '../lib/pos'

export interface UiState {
  forecastProductId: string
  settingsSection: SettingsSection
  selectedTxnId: string | null
  returnTxnId: string | null
  inventoryFilter: 'All' | 'Low stock' | 'Near expiry' | 'Out of stock'
}

export type SettingsSection = 'Business profile' | 'Tax & receipts' | 'Payment methods' | 'Inventory & AI' | 'Notifications' | 'Access & roles' | 'Data'

export interface Toast { id: number; message: string; tone: 'success' | 'error' | 'info' }

interface StoreState extends SeedData {
  employees: Employee[]
  settings: Settings
  cart: CartLine[]
  customerType: CustomerType
  heldCarts: HeldCart[]
  sessionId: string | null
  ui: UiState
}

const STORAGE_KEY = 'pos9010-state-v1'
const defaultUi: UiState = { forecastProductId: 'p01', settingsSection: 'Business profile', selectedTxnId: null, returnTxnId: null, inventoryFilter: 'All' }

function freshState(previous?: Partial<StoreState>): StoreState {
  return {
    ...buildSeed(),
    employees: previous?.employees ?? seedEmployees,
    settings: { ...defaultSettings, ...previous?.settings },
    cart: [],
    customerType: 'Regular',
    heldCarts: [],
    sessionId: previous?.sessionId ?? null,
    ui: defaultUi,
  }
}

function loadState(): StoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as StoreState
      // The demo dataset is anchored to "today"; reseed on a new day but keep people and settings.
      if (isSameDay(saved.seededOn, new Date())) return { ...saved, settings: { ...defaultSettings, ...saved.settings }, ui: { ...defaultUi, ...saved.ui } }
      return freshState(saved)
    }
  } catch { /* storage unavailable or corrupt: fall back to the seed */ }
  return freshState()
}

const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function useStoreValue() {
  const [state, setState] = useState<StoreState>(loadState)
  const [toasts, setToasts] = useState<Toast[]>([])
  const saveTimer = useRef<number | undefined>(undefined)
  const stateRef = useRef(state)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore quota / private mode */ }
    }, 300)
  }, [state])

  const toast = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200)
  }, [])

  const actions = useMemo(() => {
    const update = (fn: (s: StoreState) => Partial<StoreState>) => setState((s) => ({ ...s, ...fn(s) }))
    const changeStock = (products: Product[], productId: string, delta: number) => products.map((p) => (p.id === productId ? { ...p, stock: Math.max(0, p.stock + delta) } : p))

    return {
      navigate(workspace: WorkspaceName, ui?: Partial<UiState>) {
        if (ui) update((s) => ({ ui: { ...s.ui, ...ui } }))
        window.dispatchEvent(new CustomEvent('workspace-navigate', { detail: workspace }))
      },
      setUi: (ui: Partial<UiState>) => update((s) => ({ ui: { ...s.ui, ...ui } })),
      login: (employeeId: string) => update((s) => ({ sessionId: employeeId, employees: s.employees.map((e) => (e.id === employeeId ? { ...e, lastActive: new Date().toISOString() } : e)) })),
      logout: () => update(() => ({ sessionId: null })),

      // ----- Cart -----
      addToCart: (productId: string, qty = 1) => update((s) => {
        const existing = s.cart.find((line) => line.productId === productId)
        return { cart: existing ? s.cart.map((line) => (line.productId === productId ? { ...line, qty: line.qty + qty } : line)) : [...s.cart, { productId, qty }] }
      }),
      setCartQty: (productId: string, qty: number) => update((s) => ({ cart: qty <= 0 ? s.cart.filter((l) => l.productId !== productId) : s.cart.map((l) => (l.productId === productId ? { ...l, qty } : l)) })),
      clearCart: () => update(() => ({ cart: [], customerType: 'Regular' })),
      setCustomerType: (customerType: CustomerType) => update(() => ({ customerType })),
      holdCart: (label: string) => update((s) => (s.cart.length ? { heldCarts: [...s.heldCarts, { id: uid('h'), label, lines: s.cart, customerType: s.customerType, heldAt: new Date().toISOString() }], cart: [], customerType: 'Regular' } : {})),
      resumeCart: (id: string) => update((s) => {
        const held = s.heldCarts.find((h) => h.id === id)
        if (!held) return {}
        const parked = s.cart.length ? [{ id: uid('h'), label: 'Parked sale', lines: s.cart, customerType: s.customerType, heldAt: new Date().toISOString() }] : []
        return { cart: held.lines, customerType: held.customerType, heldCarts: [...s.heldCarts.filter((h) => h.id !== id), ...parked] }
      }),
      discardHeld: (id: string) => update((s) => ({ heldCarts: s.heldCarts.filter((h) => h.id !== id) })),

      checkout(payment: { method: PaymentMethod; tendered: number; reference?: string }): Transaction | null {
        const s = stateRef.current
        if (!s.cart.length) return null
        const lines = s.cart.map((line) => {
          const product = s.products.find((p) => p.id === line.productId)!
          return { productId: product.id, name: product.name, qty: line.qty, price: product.price }
        })
        const totals = computeTotals(lines, s.customerType, s.settings.vatRate)
        const txn: Transaction = {
          id: uid('t'), number: `OR-${String(s.nextReceipt).padStart(6, '0')}`, date: new Date().toISOString(), cashierId: s.sessionId ?? 'e1',
          customerType: s.customerType, lines, ...totals,
          payment: { ...payment, change: Math.max(0, Math.round((payment.tendered - totals.total) * 100) / 100) },
          status: 'Completed', refunds: [],
        }
        update((current) => {
          let products = current.products
          for (const line of lines) products = changeStock(products, line.productId, -line.qty)
          return { products, transactions: [...current.transactions, txn], nextReceipt: current.nextReceipt + 1, cart: [], customerType: 'Regular' }
        })
        return txn
      },

      refund(txnId: string, lines: { productId: string; qty: number }[], reason: string, restock: boolean) {
        update((s) => {
          const txn = s.transactions.find((t) => t.id === txnId)
          if (!txn) return {}
          const ratio = txn.gross ? txn.total / txn.gross : 1
          const refundLines = lines.filter((l) => l.qty > 0).map((l) => {
            const sale = txn.lines.find((x) => x.productId === l.productId)!
            return { productId: l.productId, qty: l.qty, amount: Math.round(sale.price * l.qty * ratio * 100) / 100 }
          })
          const amount = refundLines.reduce((sum, l) => sum + l.amount, 0)
          const refunds = [...txn.refunds, { id: uid('r'), date: new Date().toISOString(), lines: refundLines, reason, restocked: restock, amount, by: s.sessionId ?? 'e1' }]
          const returnedAll = txn.lines.every((line) => refunds.flatMap((r) => r.lines).filter((l) => l.productId === line.productId).reduce((sum, l) => sum + l.qty, 0) >= line.qty)
          let products = s.products
          let waste = s.waste
          for (const l of refundLines) {
            if (restock) products = changeStock(products, l.productId, l.qty)
            else {
              const product = s.products.find((p) => p.id === l.productId)
              if (product) waste = [...waste, { id: uid('w'), productId: l.productId, qty: l.qty, reason: 'Customer return', value: product.cost * l.qty, date: new Date().toISOString(), by: s.sessionId ?? 'e1', notes: `${txn.number}: ${reason}` }]
            }
          }
          return { products, waste, transactions: s.transactions.map((t) => (t.id === txnId ? { ...t, refunds, status: returnedAll ? 'Refunded' : 'Partially refunded' } : t)) }
        })
      },

      voidTransaction: (txnId: string) => update((s) => {
        const txn = s.transactions.find((t) => t.id === txnId)
        if (!txn || txn.status === 'Voided') return {}
        let products = s.products
        for (const line of txn.lines) products = changeStock(products, line.productId, line.qty)
        return { products, transactions: s.transactions.map((t) => (t.id === txnId ? { ...t, status: 'Voided' } : t)) }
      }),

      // ----- Inventory -----
      saveProduct: (product: Product) => update((s) => ({ products: s.products.some((p) => p.id === product.id) ? s.products.map((p) => (p.id === product.id ? product : p)) : [...s.products, product] })),
      adjustStock: (productId: string, delta: number) => update((s) => ({ products: changeStock(s.products, productId, delta) })),
      logWaste: (entry: { productId: string; qty: number; reason: WasteReason; notes: string }) => update((s) => {
        const product = s.products.find((p) => p.id === entry.productId)
        if (!product) return {}
        const record: WasteEntry = { ...entry, id: uid('w'), value: product.cost * entry.qty, date: new Date().toISOString(), by: s.sessionId ?? 'e1' }
        return { waste: [...s.waste, record], products: changeStock(s.products, entry.productId, -entry.qty) }
      }),
      markdown: (productId: string, percent: number) => update((s) => ({ products: s.products.map((p) => (p.id === productId ? { ...p, price: Math.round(p.price * (1 - percent) * 4) / 4 } : p)) })),

      // ----- Purchasing -----
      createPurchaseOrders(lines: { productId: string; qty: number }[], source: PurchaseOrder['source']) {
        update((s) => {
          const bySupplier = new Map<string, PurchaseOrder['lines']>()
          for (const line of lines) {
            const product = s.products.find((p) => p.id === line.productId)
            if (!product || line.qty <= 0) continue
            bySupplier.set(product.supplierId, [...(bySupplier.get(product.supplierId) ?? []), { productId: product.id, qty: line.qty, cost: product.cost }])
          }
          let sequence = 42 + s.purchaseOrders.length - 2
          const created: PurchaseOrder[] = [...bySupplier].map(([supplierId, poLines]) => {
            const lead = Math.max(...poLines.map((l) => s.products.find((p) => p.id === l.productId)?.leadTimeDays ?? 3))
            sequence++
            return { id: uid('po'), number: `PO-${new Date().getFullYear()}-${String(sequence).padStart(4, '0')}`, supplierId, created: new Date().toISOString(), expected: new Date(Date.now() + lead * DAY_MS).toISOString(), status: 'Draft', lines: poLines, source }
          })
          return { purchaseOrders: [...created, ...s.purchaseOrders] }
        })
      },
      setPurchaseOrderStatus: (id: string, status: PurchaseOrder['status']) => update((s) => {
        const po = s.purchaseOrders.find((p) => p.id === id)
        if (!po) return {}
        let products = s.products
        if (status === 'Received' && po.status !== 'Received') {
          for (const line of po.lines) {
            products = products.map((p) => (p.id === line.productId ? { ...p, stock: p.stock + line.qty, cost: line.cost } : p))
          }
        }
        return { products, purchaseOrders: s.purchaseOrders.map((p) => (p.id === id ? { ...p, status } : p)) }
      }),

      // ----- Requests -----
      addRequest: (request: Omit<CustomerRequest, 'id' | 'date' | 'status'>) => update((s) => ({ requests: [{ ...request, id: uid('q'), date: new Date().toISOString(), status: 'New' }, ...s.requests] })),
      setRequestStatus: (ids: string[], status: RequestStatus) => update((s) => ({ requests: s.requests.map((r) => (ids.includes(r.id) ? { ...r, status } : r)) })),

      // ----- People -----
      saveEmployee: (employee: Employee) => update((s) => ({ employees: s.employees.some((e) => e.id === employee.id) ? s.employees.map((e) => (e.id === employee.id ? employee : e)) : [...s.employees, employee] })),

      // ----- Shift / drawer -----
      cashMovement: (type: 'Cash in' | 'Cash out', amount: number, reason: string) => update((s) => ({ shift: { ...s.shift, movements: [...s.shift.movements, { id: uid('m'), date: new Date().toISOString(), type, amount, reason, by: s.sessionId ?? 'e1' }] } })),
      closeShift: (countedCash: number) => update((s) => ({ shift: { ...s.shift, closedAt: new Date().toISOString(), countedCash } })),
      openShift: (openingFloat: number) => update((s) => ({ shift: { id: uid('sh'), openedAt: new Date().toISOString(), openedBy: s.sessionId ?? 'e1', openingFloat, movements: [] } })),

      updateSettings: (settings: Partial<Settings>) => update((s) => ({ settings: { ...s.settings, ...settings } })),
      resetDemo: () => setState((s) => freshState({ sessionId: s.sessionId, employees: s.employees, settings: s.settings })),
      toast,
    }
  }, [toast])

  return { state, actions, toasts }
}

type StoreValue = ReturnType<typeof useStoreValue>

export interface Analytics {
  analyses: ProductAnalysis[]
  byId: Map<string, ProductAnalysis>
  insights: Insight[]
  abc: Map<string, 'A' | 'B' | 'C'>
}

const StoreContext = createContext<StoreValue | null>(null)
const AnalyticsContext = createContext<Analytics | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue()
  const { products, history, transactions, purchaseOrders, settings, waste, requests } = value.state
  const analytics = useMemo<Analytics>(() => {
    const now = new Date()
    const analyses = products.filter((p) => p.active).map((product) => analyseProduct(product, history, transactions, purchaseOrders, settings, now))
    return { analyses, byId: new Map(analyses.map((a) => [a.product.id, a])), insights: buildInsights(analyses, transactions, waste, requests, now), abc: abcClasses(analyses) }
  }, [products, history, transactions, purchaseOrders, settings, waste, requests])

  return <StoreContext.Provider value={value}><AnalyticsContext.Provider value={analytics}>{children}</AnalyticsContext.Provider></StoreContext.Provider>
}

export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside <StoreProvider>')
  return value
}

export function useAnalytics() {
  const value = useContext(AnalyticsContext)
  if (!value) throw new Error('useAnalytics must be used inside <StoreProvider>')
  return value
}

export function useCurrentUser() {
  const { state } = useStore()
  return state.employees.find((e) => e.id === state.sessionId) ?? null
}

