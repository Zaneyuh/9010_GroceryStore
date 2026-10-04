import type { ComponentType } from 'react'
import { DashboardPanel } from './Dashboard'
import { BasketPanel, ForecastPanel, InsightsFeedPanel, ModelPanel, TrendPanel } from './Insights'
import { InventoryMetrics, InventoryTable } from './Inventory'
import { EmployeesPanel, RequestsPanel, ShiftPanel, WastePanel } from './Operations'
import { CartPanel, ProductGrid } from './PointOfSale'
import { PurchaseOrdersPanel, PurchasingPanel } from './Purchasing'
import { ReportsPanel } from './Reports'
import { SettingsNav, SettingsPanel } from './Settings'
import { ReturnsPanel, TransactionsPanel } from './Transactions'

export const editors = {
  Dashboard: DashboardPanel,
  'Product Grid': ProductGrid,
  Cart: CartPanel,
  Transactions: TransactionsPanel,
  'Returns & Refunds': ReturnsPanel,
  'Shift & Cash Drawer': ShiftPanel,
  'Inventory Metrics': InventoryMetrics,
  'Inventory Table': InventoryTable,
  Purchasing: PurchasingPanel,
  'Purchase Orders': PurchaseOrdersPanel,
  'Waste Log': WastePanel,
  'AI Insights': InsightsFeedPanel,
  'WMA Forecast': ForecastPanel,
  'Model Explanation': ModelPanel,
  'Trend Analysis': TrendPanel,
  'Basket Analysis': BasketPanel,
  'Customer Requests': RequestsPanel,
  Employees: EmployeesPanel,
  Reports: ReportsPanel,
  'Settings Navigation': SettingsNav,
  'Business Settings': SettingsPanel,
} satisfies Record<string, ComponentType>

export type Editor = keyof typeof editors

export const editorGroups: { category: string; items: Editor[] }[] = [
  { category: 'Sales', items: ['Dashboard', 'Product Grid', 'Cart', 'Transactions', 'Returns & Refunds', 'Shift & Cash Drawer'] },
  { category: 'Stock', items: ['Inventory Metrics', 'Inventory Table', 'Purchasing', 'Purchase Orders', 'Waste Log'] },
  { category: 'AI & Analytics', items: ['AI Insights', 'WMA Forecast', 'Model Explanation', 'Trend Analysis', 'Basket Analysis', 'Reports'] },
  { category: 'Store', items: ['Customer Requests', 'Employees', 'Settings Navigation', 'Business Settings'] },
]
