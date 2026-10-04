export type Role = 'Owner' | 'Cashier' | 'Inventory Clerk'

export type WorkspaceName =
  | 'Dashboard'
  | 'Point of Sale'
  | 'Transactions'
  | 'Inventory'
  | 'Purchasing'
  | 'AI Insights'
  | 'Reports'
  | 'Waste'
  | 'Requests'
  | 'Employees'
  | 'Settings'

export interface Product {
  id: string
  sku: string
  barcode: string
  name: string
  category: string
  unit: string
  price: number // VAT-inclusive shelf price
  cost: number
  stock: number
  reorderPoint: number
  leadTimeDays: number
  supplierId: string
  expiry: string | null // ISO date of the nearest-expiring batch
  color: string
  symbol: string
  active: boolean
}

export interface Supplier {
  id: string
  name: string
  contact: string
  leadTimeDays: number
}

export interface Employee {
  id: string
  name: string
  email: string
  role: Role
  pin: string
  status: 'Active' | 'On leave' | 'Inactive'
  lastActive: string
}

export type PaymentMethod = 'Cash' | 'GCash' | 'Card' | 'Maya'
export type CustomerType = 'Regular' | 'Senior' | 'PWD'

export interface SaleLine {
  productId: string
  name: string
  qty: number
  price: number
}

export interface Refund {
  id: string
  date: string
  lines: { productId: string; qty: number; amount: number }[]
  reason: string
  restocked: boolean
  amount: number
  by: string
}

export interface Transaction {
  id: string
  number: string
  date: string
  cashierId: string
  customerType: CustomerType
  lines: SaleLine[]
  gross: number // sum of shelf prices (VAT inclusive)
  lessVat: number // VAT removed for VAT-exempt (Senior/PWD) sales
  discount: number
  vat: number
  vatExempt: number
  total: number
  payment: { method: PaymentMethod; tendered: number; change: number; reference?: string }
  status: 'Completed' | 'Refunded' | 'Partially refunded' | 'Voided'
  refunds: Refund[]
}

export type WasteReason = 'Expired' | 'Damaged' | 'Spoiled' | 'Theft / Shrink' | 'Customer return' | 'Other'

export interface WasteEntry {
  id: string
  productId: string
  qty: number
  reason: WasteReason
  value: number
  date: string
  by: string
  notes: string
}

export type RequestStatus = 'New' | 'Reviewing' | 'Ordered' | 'Stocked' | 'Declined'

export interface CustomerRequest {
  id: string
  item: string
  category: string
  requestedBy: string
  contact: string
  date: string
  status: RequestStatus
  notes: string
}

export interface PurchaseOrder {
  id: string
  number: string
  supplierId: string
  created: string
  expected: string
  status: 'Draft' | 'Sent' | 'Received' | 'Cancelled'
  lines: { productId: string; qty: number; cost: number }[]
  source: 'AI suggestion' | 'Manual'
}

export interface CashMovement {
  id: string
  date: string
  type: 'Cash in' | 'Cash out'
  amount: number
  reason: string
  by: string
}

export interface Shift {
  id: string
  openedAt: string
  openedBy: string
  openingFloat: number
  movements: CashMovement[]
  closedAt?: string
  countedCash?: number
}

export type ForecastMethod = 'WMA' | 'SES' | 'Holt'

export interface Settings {
  businessName: string
  storeName: string
  tin: string
  storeCode: string
  address: string
  vatRate: number
  receiptHeader: string
  receiptFooter: string
  machineSerial: string
  permitNumber: string
  payments: Record<PaymentMethod, boolean>
  forecastMethod: ForecastMethod
  wmaWeights: number[]
  sesAlpha: number
  serviceLevel: number // e.g. 0.95
  coverDays: number // target days of stock after lead time
  expiryWarningDays: number
  notifications: Record<'lowStock' | 'expiry' | 'requests' | 'aiDigest' | 'shiftReminder', boolean>
  rolePermissions: Record<Role, WorkspaceName[]>
}

export interface CartLine {
  productId: string
  qty: number
}

export interface HeldCart {
  id: string
  label: string
  lines: CartLine[]
  customerType: CustomerType
  heldAt: string
}
