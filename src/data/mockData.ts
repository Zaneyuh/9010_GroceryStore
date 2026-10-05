import { DAY_MS, daysBetween, startOfDay } from '../lib/format'
import { computeTotals } from '../lib/pos'
import type {
  CustomerRequest, CustomerType, Employee, PaymentMethod, Product, PurchaseOrder, Settings, Shift, Supplier, Transaction, WasteEntry, WasteReason,
} from './types'

// Deterministic PRNG so the demo dataset is identical on every load.
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const HISTORY_DAYS = 85 // 12 complete weeks of daily sales plus today
export const DETAIL_DAYS = 7 // the most recent days are kept as itemised receipts

export const suppliers: Supplier[] = [
  { id: 's1', name: 'NorthHarvest Rice Trading', contact: '0917 555 0101', leadTimeDays: 3 },
  { id: 's2', name: 'Valley Fresh Dairy', contact: '0918 555 0144', leadTimeDays: 2 },
  { id: 's3', name: 'Balintawak Produce Co.', contact: '0919 555 0190', leadTimeDays: 1 },
  { id: 's4', name: 'Metro Consumer Goods', contact: '(02) 8555 0123', leadTimeDays: 4 },
  { id: 's5', name: 'Pinoy Condiments Dist.', contact: '0920 555 0178', leadTimeDays: 5 },
  { id: 's6', name: 'Gardenia Route Sales', contact: '0921 555 0112', leadTimeDays: 1 },
  { id: 's7', name: 'Beverage Hub PH', contact: '0922 555 0165', leadTimeDays: 3 },
  { id: 's8', name: 'Fresh Cuts Meat Supply', contact: '0923 555 0133', leadTimeDays: 1 },
  { id: 's9', name: 'CleanHome Wholesale', contact: '0924 555 0150', leadTimeDays: 5 },
]

const categoryColor: Record<string, string> = {
  'Rice & Grains': 'rice', Dairy: 'milk', Produce: 'banana', Pantry: 'noodles', Condiments: 'oil', 'Canned Goods': 'canned',
  Bakery: 'bakery', Beverages: 'beverage', Baking: 'rice', 'Meat & Poultry': 'meat', Frozen: 'frozen', Household: 'household', Snacks: 'snack',
}

export const categories = Object.keys(categoryColor)
export const colorForCategory = (category: string) => categoryColor[category] ?? 'rice'

// id, name, category, unit, price, cost, days of stock cover, supplier, expiryInDays, popularity, weekly trend
type Seed = [string, string, string, string, number, number, number, string, number | null, number, number]
const productSeeds: Seed[] = [
  ['p01', 'Jasmine Rice 5kg', 'Rice & Grains', 'bag', 325, 268, 9, 's1', null, 6, 0.025],
  ['p02', 'Fresh Milk 1L', 'Dairy', 'carton', 98, 76, 0.8, 's2', 2, 7, 0],
  ['p03', 'Bananas (Lakatan) 1kg', 'Produce', 'kg', 82, 55, 3, 's3', 4, 8, -0.01],
  ['p04', 'Eggs (12 pcs)', 'Dairy', 'tray', 112, 88, 14, 's2', 9, 9, 0.012],
  ['p05', 'Lucky Me Pancit Canton', 'Pantry', 'pack', 15.5, 11.2, 12, 's4', 210, 14, 0.035],
  ['p06', 'Cooking Oil 1L', 'Pantry', 'bottle', 145, 118, 10, 's4', 280, 4, 0],
  ['p07', 'Datu Puti Vinegar 1L', 'Condiments', 'bottle', 62, 46, 1.0, 's5', 360, 5, 0.01],
  ['p08', 'Silver Swan Soy Sauce 1L', 'Condiments', 'bottle', 58, 43, 11, 's5', 360, 5, 0.008],
  ['p09', 'Argentina Corned Beef 150g', 'Canned Goods', 'can', 58, 44, 16, 's4', 540, 7, -0.018],
  ['p10', 'Ligo Sardines 155g', 'Canned Goods', 'can', 26, 19, 18, 's4', 600, 9, 0.004],
  ['p11', 'Gardenia White Bread', 'Bakery', 'loaf', 78, 60, 1.2, 's6', 3, 8, 0],
  ['p12', 'Nescafé Classic 50g', 'Beverages', 'jar', 112, 86, 12, 's7', 400, 4, 0.02],
  ['p13', 'White Sugar 1kg', 'Baking', 'pack', 86, 68, 9, 's4', null, 4, 0],
  ['p14', 'Coffee Creamer 250g', 'Beverages', 'pack', 72, 54, 5, 's7', 300, 3, 0.022],
  ['p15', 'Coca-Cola 1.5L', 'Beverages', 'bottle', 85, 64, 4, 's7', 150, 8, 0.03],
  ['p16', 'Tomatoes 1kg', 'Produce', 'kg', 95, 62, 2.5, 's3', 5, 5, -0.03],
  ['p17', 'Red Onions 1kg', 'Produce', 'kg', 180, 135, 2.2, 's3', 20, 4, 0.04],
  ['p18', 'Whole Chicken 1kg', 'Meat & Poultry', 'kg', 210, 165, 5, 's8', 3, 5, 0.01],
  ['p19', 'Pork Liempo 1kg', 'Meat & Poultry', 'kg', 360, 290, 1.6, 's8', 3, 3, -0.02],
  ['p20', 'Frozen Hotdog 500g', 'Frozen', 'pack', 128, 96, 10, 's8', 60, 4, 0.015],
  ['p21', 'Peanut Butter 340g', 'Pantry', 'jar', 118, 88, 14, 's4', 240, 2, 0],
  ['p22', 'Dishwashing Liquid 250ml', 'Household', 'bottle', 49, 35, 15, 's9', null, 4, 0],
  ['p23', 'Laundry Powder 1kg', 'Household', 'pack', 165, 128, 12, 's9', null, 3, -0.005],
  ['p24', 'Bottled Water 500ml', 'Beverages', 'bottle', 15, 9, 6, 's7', 365, 10, 0.045],
  ['p25', 'Skyflakes Crackers', 'Snacks', 'pack', 42, 31, 9, 's4', 180, 6, 0.01],
  ['p26', 'Chippy BBQ 110g', 'Snacks', 'pack', 36, 26, 8, 's4', 120, 6, 0.02],
  ['p27', 'Yakult (5 pack)', 'Dairy', 'pack', 70, 54, 12, 's2', 6, 5, 0.03],
  ['p28', 'Calamansi 250g', 'Produce', 'pack', 35, 22, 9, 's3', 6, 4, 0],
  ['p29', 'Eden Cheese 165g', 'Dairy', 'box', 92, 72, 12, 's2', 120, 3, 0.012],
  ['p30', 'Brown Sugar 1kg', 'Baking', 'pack', 78, 60, 1.5, 's4', null, 2, 0.05],
]

// Items that are frequently bought together (drives the basket analysis).
const affinities: [string, string, number][] = [
  ['p05', 'p04', 0.45], ['p01', 'p09', 0.35], ['p01', 'p10', 0.3], ['p12', 'p14', 0.55], ['p12', 'p13', 0.35],
  ['p11', 'p21', 0.4], ['p07', 'p08', 0.5], ['p18', 'p28', 0.35], ['p26', 'p15', 0.4], ['p16', 'p17', 0.45],
]

const weekdayFactor = [1.2, 0.88, 0.9, 0.95, 1.0, 1.12, 1.32] // Sun..Sat
const hourWeights = [0, 0, 0, 0, 0, 0, 0, 3, 6, 5, 3, 4, 6, 5, 3, 3, 4, 6, 7, 5, 3, 1, 0, 0] // store open 07:00–21:00
const BASE_TXNS_PER_DAY = 92

export const employees: Employee[] = [
  { id: 'e1', name: 'John Doe', email: 'john.doe@9010.store', role: 'Owner', pin: '1234', status: 'Active', lastActive: new Date().toISOString() },
  { id: 'e2', name: 'Maria Santos', email: 'm.santos@9010.store', role: 'Cashier', pin: '1111', status: 'Active', lastActive: new Date().toISOString() },
  { id: 'e3', name: 'Rafael Cruz', email: 'r.cruz@9010.store', role: 'Inventory Clerk', pin: '2222', status: 'Active', lastActive: new Date().toISOString() },
  { id: 'e4', name: 'Ana Reyes', email: 'a.reyes@9010.store', role: 'Cashier', pin: '3333', status: 'On leave', lastActive: new Date(Date.now() - DAY_MS).toISOString() },
  { id: 'e5', name: 'Paolo Lim', email: 'p.lim@9010.store', role: 'Cashier', pin: '4444', status: 'Active', lastActive: new Date().toISOString() },
]

export const allWorkspaces: Settings['rolePermissions']['Owner'] = ['Dashboard', 'Point of Sale', 'Transactions', 'Inventory', 'Purchasing', 'AI Insights', 'Reports', 'Waste', 'Requests', 'Employees', 'Settings']

export const defaultSettings: Settings = {
  businessName: '9010 Grocery Retail Inc.',
  storeName: 'Central Market',
  tin: '000-123-456-000',
  storeCode: 'CM-001',
  address: '123 Market Street, Quezon City, Metro Manila',
  vatRate: 0.12,
  receiptHeader: 'Thank you for shopping at Central Market!',
  receiptFooter: 'This serves as your OFFICIAL RECEIPT. Keep for returns within 7 days.',
  machineSerial: 'MSN-9010-0002',
  permitNumber: 'FP012026-001-0000123',
  payments: { Cash: true, GCash: true, Card: true, Maya: true },
  forecastMethod: 'WMA',
  wmaWeights: [0.5, 0.3, 0.2],
  sesAlpha: 0.4,
  serviceLevel: 0.95,
  coverDays: 7,
  expiryWarningDays: 7,
  notifications: { lowStock: true, expiry: true, requests: true, aiDigest: true, shiftReminder: false },
  rolePermissions: {
    Owner: allWorkspaces,
    Cashier: ['Dashboard', 'Point of Sale', 'Transactions', 'Requests'],
    'Inventory Clerk': ['Dashboard', 'Inventory', 'Purchasing', 'Waste', 'Requests'],
  },
}

export interface SeedData {
  seededOn: string
  products: Product[]
  history: Record<string, number[]> // daily units for days older than DETAIL_DAYS, oldest first
  transactions: Transaction[]
  waste: WasteEntry[]
  requests: CustomerRequest[]
  purchaseOrders: PurchaseOrder[]
  shift: Shift
  nextReceipt: number
}

export function buildSeed(now = new Date()): SeedData {
  const rand = mulberry32(9010)
  const today = startOfDay(now)
  const dayAt = (offset: number) => new Date(today.getTime() - offset * DAY_MS)

  const popularity = Object.fromEntries(productSeeds.map((seed) => [seed[0], seed[9]]))
  const trend = Object.fromEntries(productSeeds.map((seed) => [seed[0], seed[10]]))
  const trendFactor = (id: string, daysAgo: number) => Math.pow(1 + trend[id], -daysAgo / 7)



  const products: Product[] = productSeeds.map(([id, name, category, unit, price, cost, cover, supplierId, expiry]) => {
    const leadTimeDays = suppliers.find((s) => s.id === supplierId)?.leadTimeDays ?? 3
    return {
      id, name, category, unit, price, cost, stock: cover, reorderPoint: 0, // replaced below once demand is calibrated
      sku: `SKU-${id.slice(1).padStart(4, '0')}`,
      barcode: `480${(100000000 + Number(id.slice(1)) * 7919).toString().slice(0, 10)}`,
      leadTimeDays,
      supplierId,
      expiry: expiry === null ? null : new Date(today.getTime() + expiry * DAY_MS).toISOString(),
      color: colorForCategory(category),
      symbol: name[0],
      active: true,
    }
  })

  // Itemised receipts for the most recent days.
  const cashiers = ['e2', 'e5', 'e2', 'e1', 'e4']
  const pick = <T,>(items: T[], weights: number[]) => {
    const total = weights.reduce((a, b) => a + b, 0)
    let r = rand() * total
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]
      if (r <= 0) return items[i]
    }
    return items[items.length - 1]
  }
  const poisson = (lambda: number) => {
    let k = 0
    let p = 1
    const limit = Math.exp(-lambda)
    do { k++; p *= rand() } while (p > limit)
    return k - 1
  }

  const transactions: Transaction[] = []
  let receipt = 1
  for (let daysAgo = DETAIL_DAYS - 1; daysAgo >= 0; daysAgo--) {
    const day = dayAt(daysAgo)
    const count = Math.round(BASE_TXNS_PER_DAY * weekdayFactor[day.getDay()] * (0.9 + rand() * 0.2))
    const weights = products.map((p) => popularity[p.id] * trendFactor(p.id, daysAgo))
    const times: number[] = []
    for (let i = 0; i < count; i++) {
      const hour = pick(hourWeights.map((_, h) => h), hourWeights)
      times.push(day.getTime() + hour * 3_600_000 + Math.floor(rand() * 3_600_000))
    }
    times.sort((a, b) => a - b)
    for (const timestamp of times) {
      if (timestamp > now.getTime()) break
      const qty = new Map<string, number>()
      const picks = 1 + poisson(2.2)
      for (let i = 0; i < picks; i++) {
        const product = pick(products, weights)
        const units = rand() < 0.7 ? 1 : rand() < 0.75 ? 2 : 3
        qty.set(product.id, (qty.get(product.id) ?? 0) + units)
        for (const [a, b, chance] of affinities) {
          const partner = product.id === a ? b : product.id === b ? a : null
          if (partner && rand() < chance) qty.set(partner, (qty.get(partner) ?? 0) + 1)
        }
      }
      const lines = [...qty].map(([productId, units]) => {
        const product = products.find((p) => p.id === productId)!
        return { productId, name: product.name, qty: units, price: product.price }
      })
      const customerType: CustomerType = rand() < 0.08 ? 'Senior' : rand() < 0.03 ? 'PWD' : 'Regular'
      const totals = computeTotals(lines, customerType, defaultSettings.vatRate)
      const method = pick<PaymentMethod>(['Cash', 'GCash', 'Card', 'Maya'], [62, 25, 9, 4])
      const tendered = method === 'Cash' ? Math.ceil(totals.total / 50) * 50 + (rand() < 0.3 ? 100 : 0) : totals.total
      const id = `t${receipt}`
      transactions.push({
        id,
        number: `OR-${String(receipt).padStart(6, '0')}`,
        date: new Date(timestamp).toISOString(),
        cashierId: pick(cashiers, [5, 4, 1, 1, daysAgo > 1 ? 2 : 0]),
        customerType,
        lines,
        ...totals,
        payment: { method, tendered, change: Math.round((tendered - totals.total) * 100) / 100, reference: method === 'Cash' ? undefined : `${method.slice(0, 2).toUpperCase()}${Math.floor(rand() * 1e10)}` },
        status: 'Completed',
        refunds: [],
      })
      receipt++
    }
  }

  // Calibrate the older daily history to the receipts so the series is continuous,
  // then seed stock as days of cover so the demo shows a mix of healthy, low and urgent items.
  const baseDaily: Record<string, number> = {}
  for (const product of products) {
    let units = 0
    let weight = 0
    for (let daysAgo = DETAIL_DAYS - 1; daysAgo >= 1; daysAgo--) {
      weight += weekdayFactor[dayAt(daysAgo).getDay()] * trendFactor(product.id, daysAgo)
      units += transactions.filter((t) => daysBetween(t.date, today) === daysAgo).reduce((sum, t) => sum + (t.lines.find((l) => l.productId === product.id)?.qty ?? 0), 0)
    }
    baseDaily[product.id] = units / (weight || 1)
    const cover = product.stock
    product.stock = Math.max(1, Math.round(baseDaily[product.id] * cover))
    product.reorderPoint = Math.ceil(baseDaily[product.id] * (product.leadTimeDays + 1))
  }

  const history: Record<string, number[]> = {}
  for (const product of products) {
    const series: number[] = []
    for (let daysAgo = HISTORY_DAYS - 1; daysAgo >= DETAIL_DAYS; daysAgo--) {
      let value = baseDaily[product.id] * weekdayFactor[dayAt(daysAgo).getDay()] * trendFactor(product.id, daysAgo) * (0.72 + rand() * 0.56)
      if (product.id === 'p15' && daysAgo === 12) value *= 2.8 // barangay fiesta spike
      if (product.id === 'p24' && daysAgo === 12) value *= 2.1
      series.push(Math.max(0, Math.round(value)))
    }
    history[product.id] = series
  }

  // A couple of historical refunds so the Returns screens have content.
  for (const index of [12, 140]) {
    const txn = transactions[index]
    if (!txn) continue
    const line = txn.lines[0]
    const unitShare = txn.total / txn.gross
    const amount = Math.round(line.price * unitShare * 100) / 100
    txn.refunds.push({ id: `r${index}`, date: new Date(new Date(txn.date).getTime() + 3_600_000).toISOString(), lines: [{ productId: line.productId, qty: 1, amount }], reason: 'Damaged packaging', restocked: false, amount, by: 'e1' })
    txn.status = txn.lines.length === 1 && line.qty === 1 ? 'Refunded' : 'Partially refunded'
  }

  const wasteSeeds: [string, number, WasteReason, number, string][] = [
    ['p02', 4, 'Expired', 0, 'Pulled from chiller during morning check'], ['p03', 2, 'Damaged', 0, 'Bruised in delivery'],
    ['p11', 3, 'Expired', 1, ''], ['p04', 1, 'Damaged', 2, 'Dropped tray at aisle 3'], ['p16', 3, 'Spoiled', 3, 'Overripe'],
    ['p18', 2, 'Spoiled', 4, 'Chiller temperature alarm overnight'], ['p27', 5, 'Expired', 6, ''], ['p02', 3, 'Expired', 8, ''],
    ['p26', 2, 'Theft / Shrink', 9, 'Count variance on cycle count'], ['p03', 3, 'Spoiled', 11, ''], ['p11', 4, 'Expired', 13, ''],
    ['p15', 2, 'Damaged', 15, 'Leaking bottles'], ['p19', 1, 'Spoiled', 18, ''], ['p16', 2, 'Spoiled', 22, ''], ['p02', 2, 'Expired', 26, ''],
  ]
  const waste: WasteEntry[] = wasteSeeds.map(([productId, qty, reason, daysAgo, notes], index) => {
    const product = products.find((p) => p.id === productId)!
    return { id: `w${index}`, productId, qty, reason, value: qty * product.cost, date: new Date(dayAt(daysAgo).getTime() + (8 + (index % 9)) * 3_600_000).toISOString(), by: index % 2 ? 'e3' : 'e1', notes }
  })

  const requestSeeds: [string, string, string, number, CustomerRequest['status']][] = [
    ['Silver Swan Soy Sauce 1 gal', 'Condiments', 'Maria Santos (for walk-in)', 0, 'New'], ['Oat Milk, Unsweetened 1L', 'Dairy alternatives', 'R. Dela Cruz', 0, 'Reviewing'],
    ['Brown Sugar 2kg', 'Baking', 'Ana Reyes', 1, 'Reviewing'], ['Spicy Sardines (Ligo Hot)', 'Canned Goods', 'Walk-in', 2, 'Ordered'],
    ['Oat Milk 1L', 'Dairy alternatives', 'Walk-in', 3, 'New'], ['Silver Swan Soy Sauce gallon', 'Condiments', 'Carinderia Aling Nena', 4, 'New'],
    ['Almond Milk', 'Dairy alternatives', 'J. Tan', 5, 'New'], ['Gluten-free Bread', 'Bakery', 'Walk-in', 6, 'Declined'],
    ['Oat milk', 'Dairy alternatives', 'K. Garcia', 8, 'New'], ['Spicy sardines', 'Canned Goods', 'Walk-in', 9, 'Ordered'],
    ['Brown sugar 2 kg', 'Baking', 'Bakeshop next door', 11, 'New'], ['Soy sauce 1 gallon', 'Condiments', 'Walk-in', 14, 'New'],
    ['Coke Zero 1.5L', 'Beverages', 'Walk-in', 16, 'Stocked'],
  ]
  const requests: CustomerRequest[] = requestSeeds.map(([item, category, requestedBy, daysAgo, status], index) => ({
    id: `q${index}`, item, category, requestedBy, contact: '', date: new Date(dayAt(daysAgo).getTime() + (9 + index % 8) * 3_600_000).toISOString(), status, notes: '',
  }))

  const purchaseOrders: PurchaseOrder[] = [
    { id: 'po1', number: 'PO-2026-0041', supplierId: 's2', created: dayAt(1).toISOString(), expected: dayAt(-1).toISOString(), status: 'Sent', source: 'AI suggestion', lines: [{ productId: 'p02', qty: 24, cost: 76 }, { productId: 'p27', qty: 12, cost: 54 }] },
    { id: 'po2', number: 'PO-2026-0040', supplierId: 's4', created: dayAt(8).toISOString(), expected: dayAt(4).toISOString(), status: 'Received', source: 'Manual', lines: [{ productId: 'p05', qty: 120, cost: 11.2 }, { productId: 'p09', qty: 48, cost: 44 }, { productId: 'p25', qty: 36, cost: 31 }] },
  ]

  const shift: Shift = { id: 'sh1', openedAt: new Date(today.getTime() + 7 * 3_600_000).toISOString(), openedBy: 'e2', openingFloat: 3000, movements: [
    { id: 'm1', date: new Date(today.getTime() + 10 * 3_600_000).toISOString(), type: 'Cash out', amount: 450, reason: 'Paid ice delivery', by: 'e2' },
  ] }

  return { seededOn: today.toISOString(), products, history, transactions, waste, requests, purchaseOrders, shift, nextReceipt: receipt }
}
