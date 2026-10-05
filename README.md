# 9010 Grocery Store — POS

Electron + React + TypeScript + Vite + Tailwind CSS.

## Setup
```
npm install
```

## Run in dev (browser only, fastest feedback loop)
```
npm run dev
```
Opens at http://localhost:5173

## Run in dev (inside the Electron window)
```
npm run electron:dev
```
This starts the Vite dev server and opens the Electron window pointed at it, with hot reload.

## Build a production desktop app
```
npm run electron:build
```
Outputs installers to /release.

## Signing in (demo)
The app opens on a PIN sign-in screen. Demo PINs: **Owner 1234 · Cashier 1111 · Inventory clerk 2222**.
Each role only sees the workspaces allowed in *Settings → Access & roles*.

## Screens (workspaces)
| Workspace | Panels |
|---|---|
| Dashboard | Live KPIs, sales by hour vs 6-day average, top sellers, AI insights, needs-attention list |
| Point of Sale | Product grid (search / SKU / barcode + Enter), cart with Senior/PWD VAT-exempt discount, hold/resume, Cash/GCash/Card/Maya payment, printable official receipt, AI "frequently bought with" upsell |
| Transactions | Sales journal with receipt detail, reprint, void (owner, same day), returns & refunds (owner PIN for cashiers), shift & cash drawer |
| Inventory | Stock metrics, sortable/filterable table, add/edit product, stock adjustments, AI reorder level & days of cover |
| Purchasing | AI-suggested purchase orders (editable quantities), purchase order lifecycle Draft → Sent → Received |
| AI Insights | Demand forecast chart (WMA / SES / Holt with 80% interval), model backtest & tuning, category trends, rising/falling movers, traffic heatmap, insight feed and "Ask AI" |
| Reports | X/Z reading, e-Journal, VAT summary, sales by item, inventory valuation, waste, cashier performance (CSV export + print); market-basket analysis and ABC classes |
| Waste | Waste log, loss by reason, AI expiry-risk with one-click markdowns |
| Requests | Customer item requests with automatic grouping into demand signals |
| Employees | Team, roles & PINs, 7-day sales per employee, cash drawer |
| Settings | Business profile, tax & receipts, payment methods, inventory & AI parameters, notifications, role permissions, reset demo data |

Every panel can be split, swapped or changed via the editor menu in its header (Blender-style areas).

## Data & AI
This is a front-end prototype: there is no backend yet. `src/data/mockData.ts` generates a deterministic dataset
(30 products, 12 weeks of daily sales, the last 7 days as itemised receipts) anchored to today's date, and changes are kept in
`localStorage`. `src/lib/ai.ts` contains the analytics — weighted moving average, simple exponential smoothing, Holt's linear trend,
backtest error (MAE/MAPE), safety stock & reorder quantities, expiry risk, association rules (basket analysis), ABC classes,
anomaly detection and the insight/assistant text. These functions are the seam to replace with API calls later.

## Project structure
- `src/components/Login.tsx` — PIN sign-in
- `src/components/Workspace.tsx` — workspace tabs and the split-panel layout engine
- `src/workspace/editors/` — every screen/panel; `index.tsx` registers them for the editor menu
- `src/workspace/ui.tsx` — shared UI: modal, fields, segmented control, charts (SVG with hover tooltips)
- `src/store/StoreContext.tsx` — app state, actions (checkout, refunds, POs, waste…) and memoised analytics
- `src/data/` — types and mock data; `src/lib/` — formatting, POS math, AI/analytics
- `src/components/CashierMainMenu.tsx` etc. — the earlier light-theme screens, still routable (`#/cashier`)
- `main.js` — Electron's entry point (creates the app window)
