import { Router, type Request } from 'express'
import { z } from 'zod'
import { requireOwnerPin } from '../middleware/ownerPin.js'
import { actorFor, requireOwnerUser, requireStoreUser } from '../middleware/storeAuth.js'
import {
  addRequest,
  adjustProductStock,
  createSale,
  loadSnapshot,
  logWaste,
  refundSale,
  saveEmployee,
  saveProduct,
  setRequestStatus,
  setStoreName,
  voidSale,
} from '../services/store.service.js'

// Store data behind the workspace screens. The owner (server PC) and cashier terminals with an active
// session can read it and ring up sales; catalog, stock and employee changes are owner-only.
export const storeRoutes = Router()
storeRoutes.use(requireStoreUser)

const id = (prefix: string) => z.union([z.number(), z.string()]).transform((value, ctx) => {
  const n = Number(String(value).replace(new RegExp(`^${prefix}`), ''))
  if (!Number.isInteger(n) || n <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Invalid id' })
    return z.NEVER
  }
  return n
})
const routeId = (req: Request, prefix: string) => id(prefix).parse(req.params.id)
const qty = z.number().int().positive().max(100_000)
const money = z.number().min(0).max(10_000_000)
const text = (max: number) => z.string().trim().max(max)

const saleBody = z.object({
  lines: z.array(z.object({ product_id: id('p'), qty })).min(1).max(500),
  customer_type: z.enum(['Regular', 'Senior', 'PWD']),
  senior_pwd_id: text(50).nullish(),
  senior_pwd_name: text(100).nullish(),
  payment_method: z.enum(['Cash', 'GCash', 'Maya', 'Card']),
  amount_received: money,
  payment_reference: text(60).nullish(),
})

const voidBody = z.object({ reason: text(255).default('') })
const refundBody = z.object({
  reason: text(255).min(1, 'Give a reason for the return'),
  restock: z.boolean(),
  lines: z.array(z.object({ product_id: id('p'), qty })).min(1),
})

const productBody = z.object({
  name: text(100).min(1, 'Product name is required'),
  sku: text(50).nullish(),
  barcode: text(50).nullish(),
  category: text(50).nullish(),
  supplier_name: text(100).nullish(),
  unit: text(20).nullish(),
  price: money,
  cost: money.nullish(),
  reorder_point: z.number().int().min(0).max(1_000_000).nullish(),
  lead_time_days: z.number().int().min(0).max(365).nullish(),
  stock: z.number().int().min(0).max(10_000_000).nullish(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  active: z.boolean().optional(),
})

const stockBody = z.object({ delta: z.number().int().refine((n) => n !== 0, 'Change must not be zero'), reason: text(255).default('') })
const wasteBody = z.object({ product_id: id('p'), qty, reason: z.enum(['Expired', 'Damaged', 'Spoiled', 'Theft / Shrink', 'Customer return', 'Other']), notes: text(255).nullish() })
const requestBody = z.object({ item: text(100).min(1, 'What did the customer ask for?'), category: text(50).nullish(), requested_by: text(100).nullish(), contact: text(100).nullish(), notes: text(255).nullish() })
const requestStatusBody = z.object({ ids: z.array(id('q')).min(1).max(1000), status: z.enum(['New', 'Reviewing', 'Ordered', 'Stocked', 'Declined']) })
const employeeBody = z.object({ name: text(101).min(1, 'Name is required'), email: text(100).nullish(), status: z.enum(['Active', 'On leave', 'Inactive']) })

storeRoutes.get('/snapshot', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await loadSnapshot())
})

storeRoutes.post('/sales', async (req, res) => {
  const body = saleBody.parse(req.body)
  req.auditLogged = true
  res.status(201).json(await createSale(await actorFor(req), body))
})

/** Body: { owner_pin, reason } */
storeRoutes.post('/sales/:id/void', requireOwnerPin('void'), async (req, res) => {
  const { reason } = voidBody.parse(req.body)
  req.auditLogged = true
  const transaction = await voidSale(await actorFor(req), req.ownerApproval!, routeId(req, 't'), reason)
  res.json({ transaction, approved_by: req.ownerApproval!.owner_name })
})

/** Body: { owner_pin, reason, restock, lines: [{ product_id, qty }] } */
storeRoutes.post('/sales/:id/refunds', requireOwnerPin('refund'), async (req, res) => {
  const body = refundBody.parse(req.body)
  req.auditLogged = true
  const transaction = await refundSale(await actorFor(req), req.ownerApproval!, routeId(req, 't'), body)
  res.status(201).json({ transaction, approved_by: req.ownerApproval!.owner_name })
})

storeRoutes.post('/waste', async (req, res) => {
  const body = wasteBody.parse(req.body)
  req.auditLogged = true
  res.status(201).json(await logWaste(await actorFor(req), body))
})

storeRoutes.post('/requests', async (req, res) => {
  const body = requestBody.parse(req.body)
  res.status(201).json(await addRequest(await actorFor(req), body))
})

storeRoutes.patch('/requests/status', requireOwnerUser, async (req, res) => {
  const { ids, status } = requestStatusBody.parse(req.body)
  res.json(await setRequestStatus(await actorFor(req), ids, status))
})

storeRoutes.post('/products', requireOwnerUser, async (req, res) => {
  const body = productBody.parse(req.body)
  req.auditLogged = true
  res.status(201).json(await saveProduct(await actorFor(req), null, body))
})

storeRoutes.put('/products/:id', requireOwnerUser, async (req, res) => {
  const body = productBody.parse(req.body)
  req.auditLogged = true
  res.json(await saveProduct(await actorFor(req), routeId(req, 'p'), body))
})

storeRoutes.post('/products/:id/stock', requireOwnerUser, async (req, res) => {
  const { delta, reason } = stockBody.parse(req.body)
  req.auditLogged = true
  res.json(await adjustProductStock(await actorFor(req), routeId(req, 'p'), delta, reason))
})

/** Body: { store_name } */
storeRoutes.put('/settings', requireOwnerUser, async (req, res) => {
  const { store_name } = z.object({ store_name: text(80).min(1, 'Store name is required') }).parse(req.body)
  req.auditLogged = true
  await setStoreName(await actorFor(req), store_name)
  res.json({ ok: true })
})

storeRoutes.post('/employees', requireOwnerUser, async (req, res) => {
  const body = employeeBody.parse(req.body)
  req.auditLogged = true
  res.status(201).json(await saveEmployee(await actorFor(req), null, body))
})

storeRoutes.put('/employees/:id', requireOwnerUser, async (req, res) => {
  const body = employeeBody.parse(req.body)
  req.auditLogged = true
  res.json(await saveEmployee(await actorFor(req), routeId(req, 'u'), body))
})
