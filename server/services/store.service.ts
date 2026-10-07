import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getPool, withTransaction } from '../config/db.js'
import { HttpError } from '../utils/httpError.js'
import { computeTotals, round2, toIso, type CustomerType } from '../utils/pos.js'
import { logAudit } from './audit.service.js'
import type { OwnerApproval } from './auth.service.js'
import { SYSTEM_TERMINAL_ID } from './session.service.js'

// Store data for the workspace screens (src/store/StoreContext.tsx), shaped like the UI's own types
// (src/data/types.ts) so the UI only has to add colours and supplier ids. IDs are prefixed the same
// way the UI does it: p12 = product 12, t5 = transaction 5, u3 = user 3, w7 = waste 7, q2 = request 2.

type Db = PoolConnection | ReturnType<typeof getPool>

/** Who is acting: a cashier on a terminal session, or the owner on the server PC (session on PC-00). */
export interface Actor {
  user_id: number
  session_id: number
  terminal_id: string
  ip_address: string | null
}

/** Same windows as src/data/mockData.ts: itemised receipts for the last 7 days, daily totals for 12 weeks before. */
const DETAIL_DAYS = 7
const HISTORY_DAYS = 85

const PAYMENT_TO_UI = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card' } as const
const PAYMENT_TO_DB = { Cash: 'cash', GCash: 'gcash', Maya: 'maya', Card: 'card' } as const
const CUSTOMER_TO_UI = { regular: 'Regular', senior: 'Senior', pwd: 'PWD' } as const
const STATUS_TO_UI = { completed: 'Completed', voided: 'Voided', refunded: 'Refunded', partially_refunded: 'Partially refunded' } as const
export const WASTE_TO_UI = { damaged: 'Damaged', expired: 'Expired', spoiled: 'Spoiled', theft: 'Theft / Shrink', customer_return: 'Customer return', other: 'Other' } as const
export const WASTE_TO_DB = { Damaged: 'damaged', Expired: 'expired', Spoiled: 'spoiled', 'Theft / Shrink': 'theft', 'Customer return': 'customer_return', Other: 'other' } as const
export const REQUEST_TO_UI = { pending: 'New', reviewing: 'Reviewing', ordered: 'Ordered', available: 'Stocked', declined: 'Declined', closed: 'Stocked' } as const
export const REQUEST_TO_DB = { New: 'pending', Reviewing: 'reviewing', Ordered: 'ordered', Stocked: 'available', Declined: 'declined' } as const

export type PaymentMethodUi = keyof typeof PAYMENT_TO_DB
export type WasteReasonUi = keyof typeof WASTE_TO_DB
export type RequestStatusUi = keyof typeof REQUEST_TO_DB

const productNumber = (id: number | string) => Number(String(id).replace(/^p/, ''))

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The store's name, set by the owner (first launch or Settings); shown on every PC and receipt. */
export async function storeName(db: Db = getPool()): Promise<string> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'business_name'")
  return String(rows[0]?.setting_value ?? '')
}

export async function setStoreName(actor: Actor | null, name: string, db: Db = getPool()): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (setting_key, setting_value, description) VALUES ('business_name', ?, 'Business name for receipts')
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [name],
  )
  if (actor) await logAudit({ user_id: actor.user_id, session_id: actor.session_id, terminal_id: actor.terminal_id, ip_address: actor.ip_address, action: 'UPDATE_STORE_NAME', module: 'SETTINGS', details: { name } }, db)
}

export async function vatRate(db: Db = getPool()): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'vat_rate'")
  const percent = Number(rows[0]?.setting_value)
  return Number.isFinite(percent) && percent >= 0 ? percent / 100 : 0.12
}

/**
 * The owner's session on PC-00, opened on first use and kept open. Sales the owner rings up on the
 * server PC are recorded against it (transactions always need a session and a terminal).
 */
export async function ownerSession(connection: PoolConnection, ownerId: number): Promise<number> {
  const find = async () => {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT session_id FROM sessions WHERE user_id = ? AND terminal_id = ? AND is_active = TRUE', [
      ownerId,
      SYSTEM_TERMINAL_ID,
    ])
    return rows[0]?.session_id as number | undefined
  }
  const existing = await find()
  if (existing) return existing
  try {
    const [result] = await connection.execute<ResultSetHeader>('INSERT INTO sessions (user_id, terminal_id, assigned_by, login_time) VALUES (?, ?, ?, NOW())', [
      ownerId,
      SYSTEM_TERMINAL_ID,
      ownerId,
    ])
    return result.insertId
  } catch (error) {
    // Two owner requests at once: the other one opened it.
    const raced = await find()
    if (raced) return raced
    throw error
  }
}

/**
 * Changes a product's stock across its inventory batches and records each change in inventory_adjustments.
 * Removals take the soonest-expiring batch first and stop at zero (like the UI). Returns the first batch touched.
 */
export async function changeStock(
  connection: PoolConnection,
  productId: number,
  delta: number,
  log: { user_id: number; session_id: number | null; type: 'sale' | 'receive' | 'waste' | 'adjustment' | 'void_return'; reason: string; reference_id?: number | null },
): Promise<number> {
  let [batches] = await connection.query<RowDataPacket[]>(
    `SELECT inventory_id, quantity_on_hand FROM inventory WHERE product_id = ?
      ORDER BY expiry_date IS NULL, expiry_date, inventory_id FOR UPDATE`,
    [productId],
  )
  if (!batches.length) {
    const [created] = await connection.execute<ResultSetHeader>('INSERT INTO inventory (product_id, quantity_on_hand) VALUES (?, 0)', [productId])
    batches = [{ inventory_id: created.insertId, quantity_on_hand: 0 } as RowDataPacket]
  }
  const record = (inventoryId: number, change: number) =>
    connection.execute(
      'INSERT INTO inventory_adjustments (inventory_id, user_id, session_id, quantity_change, reason, adjustment_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [inventoryId, log.user_id, log.session_id, change, log.reason.slice(0, 255), log.type, log.reference_id ?? null],
    )

  if (delta >= 0) {
    // Additions go to the newest batch.
    const target = batches[batches.length - 1]
    if (delta > 0) {
      await connection.execute('UPDATE inventory SET quantity_on_hand = quantity_on_hand + ? WHERE inventory_id = ?', [delta, target.inventory_id])
      await record(target.inventory_id, delta)
    }
    return target.inventory_id
  }

  let remaining = -delta
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Math.max(0, Number(batch.quantity_on_hand)))
    if (take <= 0) continue
    await connection.execute('UPDATE inventory SET quantity_on_hand = quantity_on_hand - ? WHERE inventory_id = ?', [take, batch.inventory_id])
    await record(batch.inventory_id, -take)
    remaining -= take
  }
  return batches[0].inventory_id
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadProducts(db: Db = getPool(), productId?: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.product_id, p.barcode, p.product_code, p.product_name, p.category, p.supplier_name, p.unit_of_measure,
            p.unit_price, p.cost_price, p.reorder_level, p.lead_time_days, p.is_active,
            COALESCE(SUM(i.quantity_on_hand), 0) AS stock,
            MIN(CASE WHEN i.quantity_on_hand > 0 THEN i.expiry_date END) AS expiry
       FROM products p LEFT JOIN inventory i ON i.product_id = p.product_id
      ${productId ? 'WHERE p.product_id = ?' : ''}
      GROUP BY p.product_id
      ORDER BY p.product_name`,
    productId ? [productId] : [],
  )
  return rows.map((row) => ({
    id: `p${row.product_id}`,
    sku: row.product_code ?? '',
    barcode: row.barcode ?? '',
    name: row.product_name as string,
    category: row.category ?? 'Uncategorized',
    supplierName: (row.supplier_name as string | null) ?? null,
    unit: row.unit_of_measure ?? 'pc',
    price: Number(row.unit_price),
    cost: Number(row.cost_price ?? 0),
    stock: Number(row.stock),
    reorderPoint: Number(row.reorder_level ?? 0),
    leadTimeDays: Number(row.lead_time_days ?? 3),
    expiry: toIso(row.expiry),
    active: Boolean(row.is_active),
  }))
}

/** Receipts with their items and refunds, shaped like the UI's Transaction. */
async function loadTransactions(db: Db, where: string, params: unknown[]) {
  const [txns] = await db.query<RowDataPacket[]>(`SELECT t.* FROM transactions t WHERE ${where} ORDER BY t.transaction_date, t.transaction_id`, params)
  if (!txns.length) return []
  const ids = txns.map((t) => t.transaction_id)
  const [items] = await db.query<RowDataPacket[]>('SELECT * FROM transaction_items WHERE transaction_id IN (?) ORDER BY transaction_item_id', [ids])
  const [refundRows] = await db.query<RowDataPacket[]>(
    `SELECT r.refund_id, r.transaction_id, r.reason, r.refund_amount, r.refunded_at, r.processed_by,
            ri.product_id, ri.quantity, ri.amount, ri.restocked
       FROM refunds r JOIN refund_items ri ON ri.refund_id = r.refund_id
      WHERE r.transaction_id IN (?) ORDER BY r.refund_id, ri.refund_item_id`,
    [ids],
  )
  const refundsByTxn = new Map<number, Map<number, { id: string; date: string; lines: { productId: string; qty: number; amount: number }[]; reason: string; restocked: boolean; amount: number; by: string }>>()
  for (const row of refundRows) {
    const byId = refundsByTxn.get(row.transaction_id) ?? new Map()
    refundsByTxn.set(row.transaction_id, byId)
    const refund = byId.get(row.refund_id) ?? {
      id: `r${row.refund_id}`, date: toIso(row.refunded_at) ?? '', lines: [], reason: row.reason, restocked: Boolean(row.restocked), amount: Number(row.refund_amount), by: `u${row.processed_by}`,
    }
    refund.lines.push({ productId: `p${row.product_id}`, qty: Number(row.quantity), amount: Number(row.amount) })
    byId.set(row.refund_id, refund)
  }
  const itemsByTxn = new Map<number, RowDataPacket[]>()
  for (const item of items) itemsByTxn.set(item.transaction_id, [...(itemsByTxn.get(item.transaction_id) ?? []), item])

  return txns.map((t) => {
    const customerType = CUSTOMER_TO_UI[t.customer_type as keyof typeof CUSTOMER_TO_UI] ?? 'Regular'
    const gross = Number(t.subtotal)
    const vatExempt = Number(t.vat_exempt_sales)
    const method = PAYMENT_TO_UI[t.payment_method as keyof typeof PAYMENT_TO_UI] ?? 'Cash'
    return {
      id: `t${t.transaction_id}`,
      number: t.receipt_number as string,
      date: toIso(t.transaction_date) ?? '',
      cashierId: `u${t.cashier_id}`,
      terminalId: t.terminal_id as string,
      customerType,
      lines: (itemsByTxn.get(t.transaction_id) ?? []).map((item) => ({ productId: `p${item.product_id}`, name: item.product_name, qty: Number(item.quantity), price: Number(item.unit_price) })),
      gross,
      lessVat: customerType === 'Regular' ? 0 : round2(gross - vatExempt),
      discount: Number(t.discount_total ?? 0),
      vat: Number(t.tax_amount ?? 0),
      vatExempt,
      total: Number(t.total_amount),
      payment: { method, tendered: Number(t.amount_received ?? t.total_amount), change: Number(t.change_given ?? 0), reference: t.payment_reference ?? undefined },
      status: STATUS_TO_UI[t.status as keyof typeof STATUS_TO_UI] ?? 'Completed',
      refunds: [...(refundsByTxn.get(t.transaction_id)?.values() ?? [])],
    }
  })
}

export async function loadTransaction(db: Db, transactionId: number) {
  const [txn] = await loadTransactions(db, 't.transaction_id = ?', [transactionId])
  if (!txn) throw HttpError.notFound('Receipt not found')
  return txn
}

async function loadWaste(db: Db, where = 'w.waste_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)', params: unknown[] = []) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT w.*, p.cost_price FROM waste_records w JOIN products p ON p.product_id = w.product_id WHERE ${where} ORDER BY w.waste_date, w.waste_id`,
    params,
  )
  return rows.map((row) => ({
    id: `w${row.waste_id}`,
    productId: `p${row.product_id}`,
    qty: Number(row.quantity),
    reason: WASTE_TO_UI[row.reason as keyof typeof WASTE_TO_UI] ?? 'Other',
    value: round2(Number(row.quantity) * Number(row.cost_price ?? 0)),
    date: toIso(row.waste_date) ?? '',
    by: `u${row.user_id}`,
    notes: row.notes ?? '',
  }))
}

async function loadRequests(db: Db, where = '1 = 1', params: unknown[] = []) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT q.*, CONCAT(u.first_name, ' ', u.last_name) AS cashier_name
       FROM customer_requests q LEFT JOIN users u ON u.user_id = q.cashier_id
      WHERE ${where} ORDER BY q.request_date DESC, q.request_id DESC LIMIT 1000`,
    params,
  )
  return rows.map((row) => ({
    id: `q${row.request_id}`,
    item: row.product_name_requested as string,
    category: row.category ?? '',
    requestedBy: row.requested_by ?? row.cashier_name ?? '',
    contact: row.contact ?? '',
    date: toIso(row.request_date) ?? '',
    status: REQUEST_TO_UI[row.status as keyof typeof REQUEST_TO_UI] ?? 'New',
    notes: row.notes ?? '',
  }))
}

async function loadEmployees(db: Db, userId?: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.on_leave, u.last_login, u.created_at, r.role_name,
            (SELECT MAX(s.assigned_at) FROM sessions s WHERE s.user_id = u.user_id) AS last_session
       FROM users u JOIN roles r ON r.role_id = u.role_id
      ${userId ? 'WHERE u.user_id = ?' : ''}
      ORDER BY u.user_id`,
    userId ? [userId] : [],
  )
  return rows.map((row) => ({
    id: `u${row.user_id}`,
    name: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email ?? row.phone ?? '',
    role: row.role_name === 'Owner' ? ('Owner' as const) : ('Cashier' as const),
    status: !row.is_active ? ('Inactive' as const) : row.on_leave ? ('On leave' as const) : ('Active' as const),
    lastActive: toIso([row.last_login, row.last_session].filter(Boolean).sort().pop() ?? row.created_at) ?? '',
  }))
}

/** Daily units per product for the 12 weeks before the itemised receipts, oldest first (like mockData history). */
async function loadHistory(db: Db) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ti.product_id, DATEDIFF(CURDATE(), DATE(t.transaction_date)) AS days_ago, SUM(ti.quantity) AS units
       FROM transaction_items ti JOIN transactions t ON t.transaction_id = ti.transaction_id
      WHERE t.status <> 'voided'
        AND t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND t.transaction_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY ti.product_id, days_ago`,
    [HISTORY_DAYS - 1, DETAIL_DAYS - 1],
  )
  const length = HISTORY_DAYS - DETAIL_DAYS
  const history: Record<string, number[]> = {}
  for (const row of rows) {
    const key = `p${row.product_id}`
    history[key] ??= new Array(length).fill(0)
    const index = HISTORY_DAYS - 1 - Number(row.days_ago)
    if (index >= 0 && index < length) history[key][index] = Number(row.units)
  }
  return history
}

/** Everything the workspace screens show, in one request. */
export async function loadSnapshot() {
  const db = getPool()
  const [products, transactions, history, waste, requests, employees, rate, name] = await Promise.all([
    loadProducts(db),
    loadTransactions(db, 't.transaction_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)', [DETAIL_DAYS - 1]),
    loadHistory(db),
    loadWaste(db),
    loadRequests(db),
    loadEmployees(db),
    vatRate(db),
    storeName(db),
  ])
  return { products, transactions, history, waste, requests, employees, vatRate: rate, storeName: name, serverTime: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// Sales, voids and refunds
// ---------------------------------------------------------------------------

async function nextReceiptNumber(connection: PoolConnection): Promise<string> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number, 4) AS UNSIGNED)), 0) AS last FROM transactions WHERE receipt_number REGEXP '^OR-[0-9]+$'",
  )
  return `OR-${String(Number(rows[0]?.last ?? 0) + 1).padStart(6, '0')}`
}

export interface SaleInput {
  lines: { product_id: number; qty: number }[]
  customer_type: CustomerType
  senior_pwd_id?: string | null
  senior_pwd_name?: string | null
  payment_method: PaymentMethodUi
  amount_received: number
  payment_reference?: string | null
}

/** Records a sale at the server's prices, takes the items out of stock, and returns the receipt. */
export async function createSale(actor: Actor, input: SaleInput) {
  if (input.customer_type !== 'Regular' && (!input.senior_pwd_id?.trim() || !input.senior_pwd_name?.trim())) {
    throw HttpError.badRequest(`${input.customer_type} sales need the ID number and name on the ${input.customer_type === 'PWD' ? 'PWD' : 'Senior Citizen'} ID`)
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const transactionId = await withTransaction(async (connection) => {
        const quantities = new Map<number, number>()
        for (const line of input.lines) quantities.set(line.product_id, (quantities.get(line.product_id) ?? 0) + line.qty)
        const [products] = await connection.query<RowDataPacket[]>('SELECT product_id, product_name, unit_price, is_active FROM products WHERE product_id IN (?)', [[...quantities.keys()]])
        const lines = [...quantities].map(([productId, qty]) => {
          const product = products.find((p) => p.product_id === productId)
          if (!product) throw HttpError.badRequest(`Product ${productId} no longer exists`)
          if (!product.is_active) throw HttpError.conflict(`${product.product_name} is no longer sold`)
          return { productId, name: product.product_name as string, qty, price: Number(product.unit_price) }
        })
        const totals = computeTotals(lines, input.customer_type, await vatRate(connection))
        if (input.payment_method === 'Cash' && input.amount_received + 0.001 < totals.total) throw HttpError.badRequest('Cash received is less than the total')
        const received = input.payment_method === 'Cash' ? input.amount_received : totals.total
        const receipt = await nextReceiptNumber(connection)
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO transactions (receipt_number, cashier_id, session_id, terminal_id, customer_type, senior_pwd_id, senior_pwd_name,
             subtotal, discount_total, vatable_sales, vat_exempt_sales, tax_amount, total_amount, payment_method, payment_reference, amount_received, change_given)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            receipt, actor.user_id, actor.session_id, actor.terminal_id, input.customer_type.toLowerCase(),
            input.customer_type === 'Regular' ? null : input.senior_pwd_id!.trim(), input.customer_type === 'Regular' ? null : input.senior_pwd_name!.trim(),
            totals.gross, totals.discount, input.customer_type === 'Regular' ? round2(totals.gross - totals.vat) : 0, totals.vatExempt, totals.vat, totals.total,
            PAYMENT_TO_DB[input.payment_method], input.payment_reference?.trim() || null, received, round2(Math.max(0, received - totals.total)),
          ],
        )
        const transactionIdNew = result.insertId
        for (const line of lines) {
          await connection.execute(
            'INSERT INTO transaction_items (transaction_id, product_id, product_name, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
            [transactionIdNew, line.productId, line.name, line.qty, line.price, round2(line.price * line.qty)],
          )
          await changeStock(connection, line.productId, -line.qty, { user_id: actor.user_id, session_id: actor.session_id, type: 'sale', reason: receipt, reference_id: transactionIdNew })
        }
        await logAudit({ user_id: actor.user_id, session_id: actor.session_id, terminal_id: actor.terminal_id, ip_address: actor.ip_address, action: 'SALE', module: 'POS', details: { receipt, total: totals.total } }, connection)
        return transactionIdNew
      })
      return await loadTransaction(getPool(), transactionId)
    } catch (error) {
      // Two terminals took the same receipt number at once: try again with the next one.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY' && attempt < 3) continue
      throw error
    }
  }
}

async function recordOverride(connection: PoolConnection, actor: Actor, approval: OwnerApproval, action: 'void' | 'refund', transactionId: number, reason: string, details: unknown) {
  const [result] = await connection.execute<ResultSetHeader>(
    'INSERT INTO supervisor_overrides (session_id, terminal_id, requested_by, approved_by, action_type, reference_id, details, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [actor.session_id, actor.terminal_id, actor.user_id, approval.owner_id, action, transactionId, JSON.stringify(details), reason.slice(0, 255)],
  )
  return result.insertId
}

/** Cancels a whole sale (owner PIN required) and puts every item back in stock. */
export async function voidSale(actor: Actor, approval: OwnerApproval, transactionId: number, reason: string) {
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT receipt_number, status FROM transactions WHERE transaction_id = ? FOR UPDATE', [transactionId])
    const txn = rows[0]
    if (!txn) throw HttpError.notFound('Receipt not found')
    if (txn.status !== 'completed') throw HttpError.conflict(`${txn.receipt_number} can't be voided because it is ${String(txn.status).replace('_', ' ')}`)
    const [items] = await connection.query<RowDataPacket[]>('SELECT product_id, quantity FROM transaction_items WHERE transaction_id = ?', [transactionId])
    await recordOverride(connection, actor, approval, 'void', transactionId, reason, { receipt: txn.receipt_number })
    await connection.execute("UPDATE transactions SET status = 'voided', voided_by = ?, void_reason = ?, voided_at = NOW() WHERE transaction_id = ?", [
      approval.owner_id, reason.slice(0, 255) || null, transactionId,
    ])
    for (const item of items) {
      await changeStock(connection, item.product_id, Number(item.quantity), { user_id: actor.user_id, session_id: actor.session_id, type: 'void_return', reason: `Void ${txn.receipt_number}`, reference_id: transactionId })
    }
    await logAudit({ user_id: actor.user_id, session_id: actor.session_id, terminal_id: actor.terminal_id, ip_address: actor.ip_address, action: 'VOID_SALE', module: 'POS', details: { receipt: txn.receipt_number, approved_by: approval.owner_id, reason } }, connection)
  })
  return loadTransaction(getPool(), transactionId)
}

/** Returns some or all items of a sale (owner PIN required): back to stock, or written off as waste. */
export async function refundSale(actor: Actor, approval: OwnerApproval, transactionId: number, input: { lines: { product_id: number; qty: number }[]; reason: string; restock: boolean }) {
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM transactions WHERE transaction_id = ? FOR UPDATE', [transactionId])
    const txn = rows[0]
    if (!txn) throw HttpError.notFound('Receipt not found')
    if (txn.status === 'voided' || txn.status === 'refunded') throw HttpError.conflict(`${txn.receipt_number} is already ${txn.status}`)
    const [items] = await connection.query<RowDataPacket[]>(
      `SELECT ti.transaction_item_id, ti.product_id, ti.quantity, ti.unit_price,
              COALESCE((SELECT SUM(ri.quantity) FROM refund_items ri WHERE ri.transaction_item_id = ti.transaction_item_id), 0) AS returned
         FROM transaction_items ti WHERE ti.transaction_id = ?`,
      [transactionId],
    )
    const ratio = Number(txn.subtotal) ? Number(txn.total_amount) / Number(txn.subtotal) : 1
    const lines = input.lines.filter((line) => line.qty > 0).map((line) => {
      const item = items.find((i) => i.product_id === line.product_id)
      if (!item) throw HttpError.badRequest('That item is not on this receipt')
      if (line.qty > Number(item.quantity) - Number(item.returned)) throw HttpError.conflict('Cannot return more than was sold')
      return { item, qty: line.qty, amount: round2(Number(item.unit_price) * line.qty * ratio) }
    })
    if (!lines.length) throw HttpError.badRequest('Choose at least one item to return')
    const amount = round2(lines.reduce((sum, line) => sum + line.amount, 0))

    const overrideId = await recordOverride(connection, actor, approval, 'refund', transactionId, input.reason, { receipt: txn.receipt_number, amount })
    const [refund] = await connection.execute<ResultSetHeader>(
      'INSERT INTO refunds (transaction_id, session_id, terminal_id, processed_by, approved_by, override_id, reason, refund_method, refund_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [transactionId, actor.session_id, actor.terminal_id, actor.user_id, approval.owner_id, overrideId, input.reason.slice(0, 255) || 'Return', txn.payment_method, amount],
    )
    for (const line of lines) {
      await connection.execute('INSERT INTO refund_items (refund_id, transaction_item_id, product_id, quantity, amount, restocked) VALUES (?, ?, ?, ?, ?, ?)', [
        refund.insertId, line.item.transaction_item_id, line.item.product_id, line.qty, line.amount, input.restock,
      ])
      if (input.restock) {
        await changeStock(connection, line.item.product_id, line.qty, { user_id: actor.user_id, session_id: actor.session_id, type: 'void_return', reason: `Refund ${txn.receipt_number}`, reference_id: refund.insertId })
      } else {
        const [batch] = await connection.query<RowDataPacket[]>('SELECT inventory_id FROM inventory WHERE product_id = ? ORDER BY inventory_id LIMIT 1', [line.item.product_id])
        const inventoryId = batch[0]?.inventory_id ?? (await changeStock(connection, line.item.product_id, 0, { user_id: actor.user_id, session_id: actor.session_id, type: 'adjustment', reason: 'Batch for write-off' }))
        await connection.execute("INSERT INTO waste_records (product_id, inventory_id, user_id, quantity, reason, notes) VALUES (?, ?, ?, ?, 'customer_return', ?)", [
          line.item.product_id, inventoryId, actor.user_id, line.qty, `${txn.receipt_number}: ${input.reason}`.slice(0, 255),
        ])
      }
    }
    const remaining = items.reduce((sum, item) => sum + Number(item.quantity) - Number(item.returned), 0) - lines.reduce((sum, line) => sum + line.qty, 0)
    await connection.execute('UPDATE transactions SET status = ? WHERE transaction_id = ?', [remaining <= 0 ? 'refunded' : 'partially_refunded', transactionId])
    await logAudit({ user_id: actor.user_id, session_id: actor.session_id, terminal_id: actor.terminal_id, ip_address: actor.ip_address, action: 'REFUND', module: 'POS', details: { receipt: txn.receipt_number, amount, restock: input.restock, approved_by: approval.owner_id } }, connection)
  })
  return loadTransaction(getPool(), transactionId)
}

// ---------------------------------------------------------------------------
// Catalog and stock (owner)
// ---------------------------------------------------------------------------

export interface ProductInput {
  name: string
  sku?: string | null
  barcode?: string | null
  category?: string | null
  supplier_name?: string | null
  unit?: string | null
  price: number
  cost?: number | null
  reorder_point?: number | null
  lead_time_days?: number | null
  stock?: number | null
  expiry?: string | null // YYYY-MM-DD
  active?: boolean
}

function duplicateProduct(error: unknown): never {
  const message = String((error as { sqlMessage?: string }).sqlMessage ?? '')
  if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
    throw HttpError.conflict(message.includes('barcode') ? 'Another product already has that barcode' : 'Another product already has that SKU')
  }
  throw error
}

export async function saveProduct(actor: Actor, productId: number | null, input: ProductInput) {
  const id = await withTransaction(async (connection) => {
    const values = [
      input.barcode?.trim() || null, input.sku?.trim() || null, input.name.trim(), input.category?.trim() || null, input.supplier_name?.trim() || null,
      input.unit?.trim() || null, input.price, input.cost ?? null, input.reorder_point ?? 10, input.lead_time_days ?? null, input.active ?? true,
    ]
    let savedId = productId
    try {
      if (savedId === null) {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO products (barcode, product_code, product_name, category, supplier_name, unit_of_measure, unit_price, cost_price, reorder_level, lead_time_days, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          values,
        )
        savedId = result.insertId
        await connection.execute('INSERT INTO inventory (product_id, quantity_on_hand, expiry_date) VALUES (?, 0, ?)', [savedId, input.expiry ?? null])
      } else {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE products SET barcode = ?, product_code = ?, product_name = ?, category = ?, supplier_name = ?, unit_of_measure = ?, unit_price = ?,
             cost_price = ?, reorder_level = ?, lead_time_days = ?, is_active = ? WHERE product_id = ?`,
          [...values, savedId],
        )
        if (!result.affectedRows) throw HttpError.notFound('Product not found')
      }
    } catch (error) {
      duplicateProduct(error)
    }
    const [current] = await loadProducts(connection, savedId!)
    const [nearest] = await connection.query<RowDataPacket[]>('SELECT MIN(CASE WHEN quantity_on_hand > 0 THEN expiry_date END) AS expiry FROM inventory WHERE product_id = ?', [savedId])
    if (input.stock !== undefined && input.stock !== null && input.stock !== current.stock) {
      await changeStock(connection, savedId!, input.stock - current.stock, { user_id: actor.user_id, session_id: actor.session_id, type: 'adjustment', reason: 'Stock count from product editor' })
    }
    if (input.expiry !== undefined && (input.expiry ?? null) !== (nearest[0]?.expiry ?? null)) {
      // The nearest-expiring batch is the one the editor shows.
      await connection.execute(
        `UPDATE inventory SET expiry_date = ? WHERE inventory_id = (
           SELECT inventory_id FROM (SELECT inventory_id FROM inventory WHERE product_id = ? ORDER BY quantity_on_hand <= 0, expiry_date IS NULL, expiry_date, inventory_id LIMIT 1) AS nearest)`,
        [input.expiry ?? null, savedId],
      )
    }
    await logAudit({ user_id: actor.user_id, session_id: actor.session_id, terminal_id: actor.terminal_id, ip_address: actor.ip_address, action: productId === null ? 'CREATE_PRODUCT' : 'UPDATE_PRODUCT', module: 'INVENTORY', details: { product_id: savedId, name: input.name, price: input.price } }, connection)
    return savedId!
  })
  const [product] = await loadProducts(getPool(), id)
  return product
}

export async function adjustProductStock(actor: Actor, productId: number, delta: number, reason: string) {
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT product_name FROM products WHERE product_id = ?', [productId])
    if (!rows[0]) throw HttpError.notFound('Product not found')
    await changeStock(connection, productId, delta, { user_id: actor.user_id, session_id: actor.session_id, type: delta > 0 ? 'receive' : 'adjustment', reason: reason || 'Manual adjustment' })
    await logAudit({ user_id: actor.user_id, session_id: actor.session_id, terminal_id: actor.terminal_id, ip_address: actor.ip_address, action: 'ADJUST_STOCK', module: 'INVENTORY', details: { product_id: productId, delta, reason } }, connection)
  })
  const [product] = await loadProducts(getPool(), productId)
  return product
}

// ---------------------------------------------------------------------------
// Waste, customer requests, employees
// ---------------------------------------------------------------------------

export async function logWaste(actor: Actor, input: { product_id: number; qty: number; reason: WasteReasonUi; notes?: string | null }) {
  const wasteId = await withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT product_name FROM products WHERE product_id = ?', [input.product_id])
    if (!rows[0]) throw HttpError.notFound('Product not found')
    const inventoryId = await changeStock(connection, input.product_id, -input.qty, { user_id: actor.user_id, session_id: actor.session_id, type: 'waste', reason: input.reason })
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO waste_records (product_id, inventory_id, user_id, quantity, reason, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [input.product_id, inventoryId, actor.user_id, input.qty, WASTE_TO_DB[input.reason], input.notes?.trim().slice(0, 255) || null],
    )
    await logAudit({ user_id: actor.user_id, session_id: actor.session_id, terminal_id: actor.terminal_id, ip_address: actor.ip_address, action: 'LOG_WASTE', module: 'INVENTORY', details: { product_id: input.product_id, qty: input.qty, reason: input.reason } }, connection)
    return result.insertId
  })
  const [entry] = await loadWaste(getPool(), 'w.waste_id = ?', [wasteId])
  const [product] = await loadProducts(getPool(), input.product_id)
  return { entry, product }
}

export async function addRequest(actor: Actor, input: { item: string; category?: string | null; requested_by?: string | null; contact?: string | null; notes?: string | null }) {
  const [result] = await getPool().execute<ResultSetHeader>(
    'INSERT INTO customer_requests (cashier_id, product_name_requested, category, requested_by, contact, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [actor.user_id, input.item.trim(), input.category?.trim() || null, input.requested_by?.trim() || null, input.contact?.trim() || null, input.notes?.trim() || null],
  )
  const [request] = await loadRequests(getPool(), 'q.request_id = ?', [result.insertId])
  return request
}

export async function setRequestStatus(actor: Actor, ids: number[], status: RequestStatusUi) {
  await getPool().query('UPDATE customer_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE request_id IN (?)', [REQUEST_TO_DB[status], actor.user_id, ids])
  return loadRequests(getPool(), 'q.request_id IN (?)', [ids])
}

/** Splits "Juan Dela Cruz" into first "Juan" and last "Dela Cruz" for the users table. */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  // Filipino surnames often start with a particle: Dela Cruz, De Leon, Del Rosario, San Jose, Santa Maria.
  const particles = new Set(['de', 'dela', 'del', 'delos', 'de los', 'san', 'santa', 'sta.', 'sto.', 'santo', 'la', 'van', 'von', 'di', 'da'])
  let start = parts.length - 1
  while (start > 1 && particles.has(parts[start - 1].toLowerCase())) start--
  return { first: parts.slice(0, start).join(' '), last: parts.slice(start).join(' ') }
}

export async function saveEmployee(actor: Actor, userId: number | null, input: { name: string; email?: string | null; status: 'Active' | 'On leave' | 'Inactive' }) {
  const { first, last } = splitName(input.name)
  const email = input.email?.trim() || null
  const isActive = input.status !== 'Inactive'
  const onLeave = input.status === 'On leave'
  const id = await withTransaction(async (connection) => {
    let savedId = userId
    if (savedId === null) {
      const [role] = await connection.query<RowDataPacket[]>("SELECT role_id FROM roles WHERE role_name = 'Cashier'")
      const [result] = await connection.execute<ResultSetHeader>('INSERT INTO users (role_id, first_name, last_name, email, is_active, on_leave) VALUES (?, ?, ?, ?, ?, ?)', [
        role[0].role_id, first, last, email, isActive, onLeave,
      ])
      savedId = result.insertId
    } else {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? FOR UPDATE', [savedId])
      if (!rows[0]) throw HttpError.notFound('Employee not found')
      if (rows[0].role_name === 'Owner' && !isActive) throw HttpError.conflict("The owner account can't be deactivated here")
      if (!isActive) {
        const [busy] = await connection.query<RowDataPacket[]>('SELECT terminal_id FROM sessions WHERE user_id = ? AND is_active = TRUE AND terminal_id <> ?', [savedId, SYSTEM_TERMINAL_ID])
        if (busy.length) throw HttpError.conflict(`End this cashier's shift on ${busy[0].terminal_id} first`)
      }
      await connection.execute('UPDATE users SET first_name = ?, last_name = ?, email = ?, is_active = ?, on_leave = ? WHERE user_id = ?', [first, last, email, isActive, onLeave, savedId])
    }
    await logAudit({ user_id: actor.user_id, session_id: actor.session_id, terminal_id: actor.terminal_id, ip_address: actor.ip_address, action: userId === null ? 'CREATE_EMPLOYEE' : 'UPDATE_EMPLOYEE', module: 'ADMIN', details: { employee_id: savedId, name: input.name, status: input.status } }, connection)
    return savedId!
  })
  const [employee] = await loadEmployees(getPool(), id)
  return employee
}

export { productNumber }
