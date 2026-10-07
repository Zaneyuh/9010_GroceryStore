import { iconRegistry } from '../../icons/iconRegistry'
import { hourlySales, netTotal } from '../../lib/ai'
import { DAY_MS, daysBetween, num, pct, peso } from '../../lib/format'
import { allowedWorkspaces, useAnalytics, useCurrentUser, useStore } from '../../store/StoreContext'
import type { WorkspaceName } from '../../data/types'
import { BarList, ComboChart, Legend, Metric, SERIES, SectionHeading } from '../ui'
import { InsightCard } from './Insights'

export function DashboardPanel() {
  const { state, actions } = useStore()
  const { analyses, insights } = useAnalytics()
  const user = useCurrentUser()
  const now = new Date()
  const hour = now.getHours()
  const today = state.transactions.filter((t) => daysBetween(t.date, now) === 0 && t.status !== 'Voided')
  const yesterdaySameTime = state.transactions.filter((t) => daysBetween(t.date, now) === 1 && t.status !== 'Voided' && new Date(t.date).getTime() + DAY_MS <= now.getTime())
  const sales = today.reduce((s, t) => s + netTotal(t), 0)
  const prevSales = yesterdaySameTime.reduce((s, t) => s + netTotal(t), 0)
  const salesChange = prevSales ? (sales - prevSales) / prevSales : 0
  const txnChange = yesterdaySameTime.length ? (today.length - yesterdaySameTime.length) / yesterdaySameTime.length : 0
  const low = analyses.filter((a) => a.urgency !== 'OK' || a.product.stock <= a.product.reorderPoint)
  const urgent = analyses.filter((a) => a.urgency === 'Urgent')
  const expiring = analyses.filter((a) => a.expiryDays !== null && a.expiryDays <= state.settings.expiryWarningDays)
  const dailyTotals = Array.from({ length: 7 }, (_, i) => state.transactions.filter((t) => daysBetween(t.date, now) === 6 - i).reduce((s, t) => s + netTotal(t), 0))

  const todayHourly = hourlySales(state.transactions, now)
  const pastDays = [1, 2, 3, 4, 5, 6].map((d) => hourlySales(state.transactions, new Date(now.getTime() - d * DAY_MS)))
  const avgHourly = todayHourly.map((_, h) => pastDays.reduce((s, day) => s + day[h], 0) / pastDays.length)
  const hours = Array.from({ length: 15 }, (_, i) => i + 7)

  const topToday = new Map<string, number>()
  today.forEach((t) => t.lines.forEach((l) => topToday.set(l.name, (topToday.get(l.name) ?? 0) + l.qty * l.price)))
  const top = [...topToday].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const attention = [...urgent, ...expiring.filter((e) => !urgent.includes(e))].slice(0, 4)
  const allowed = allowedWorkspaces(state.settings, user?.role ?? 'Owner')
  const shortcuts = (['Point of Sale', 'Inventory', 'AI Insights', 'Waste', 'Reports', 'Settings'] as WorkspaceName[]).filter((w) => allowed.includes(w))
  const shortcutText: Partial<Record<WorkspaceName, string>> = { 'Point of Sale': 'Start a transaction', Inventory: 'Manage stock and reorders', 'AI Insights': 'Forecasts, trends & basket analysis', Waste: 'Track losses', Reports: 'X/Z readings, VAT & BIR', Settings: 'Store preferences' }

  return <div className="dashboard-panel">
    {(urgent.length > 0 || expiring.length > 0) && <div className="alert-banner"><span className="alert-mark">!</span><div><b>{urgent.length + expiring.length} item{urgent.length + expiring.length === 1 ? '' : 's'} need attention</b><span>{urgent.length} predicted stock-out{urgent.length === 1 ? '' : 's'} and {expiring.length} near-expiry product{expiring.length === 1 ? '' : 's'}.</span></div>{allowed.includes('Inventory') && <button onClick={() => actions.navigate('Inventory', { inventoryFilter: 'Low stock' })}>REVIEW INVENTORY <span>↗</span></button>}</div>}
    <div className="dashboard-heading"><div><span className="eyebrow">{now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}</span><h1>{greeting}, {user?.name.split(' ')[0] ?? 'there'}.</h1><p>Here’s how {state.settings.storeName} is performing today.</p></div><span className="open-status"><i /> {hour >= 7 && hour < 21 ? 'STORE OPEN' : 'STORE CLOSED'}</span></div>
    <div className="metric-grid">
      <Metric label="Today's sales" value={peso(sales, 0)} change={pct(salesChange)} note="vs. yesterday, same time" accent="green" spark={dailyTotals} />
      <Metric label="Transactions" value={num(today.length)} change={pct(txnChange)} note={`avg basket ${peso(today.length ? sales / today.length : 0, 0)}`} accent="orange" />
      <Metric label="Reorder needed" value={String(low.length).padStart(2, '0')} change={`${urgent.length} urgent`} note="AI reorder level" accent="red" />
      <Metric label="Near expiry" value={String(expiring.length).padStart(2, '0')} change={`next ${state.settings.expiryWarningDays} days`} note={`${expiring.reduce((s, e) => s + e.product.stock, 0)} units`} accent="blue" />
    </div>
    <div className="dashboard-lower">
      <section className="dashboard-module"><SectionHeading title="SALES BY HOUR · TODAY VS 6-DAY AVERAGE" />
        <div className="module-body">
          <Legend items={[{ name: 'Today', color: SERIES[0], kind: 'bar' }, { name: '6-day average', color: SERIES[2], kind: 'line' }]} />
          <ComboChart height={190} labels={hours.map((h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`)} bars={{ name: 'Today', color: SERIES[0], values: hours.map((h) => (h <= hour ? todayHourly[h] : null)) }} lines={[{ name: '6-day average', color: SERIES[2], values: hours.map((h) => avgHourly[h]) }]} format={(v) => (v >= 1000 ? `₱${(v / 1000).toFixed(1)}k` : `₱${v.toFixed(0)}`)} />
        </div>
      </section>
      <section className="dashboard-module"><SectionHeading title="TOP SELLERS TODAY" />
        <div className="module-body">{top.length ? <BarList items={top.map(([label, value]) => ({ label, value }))} format={(v) => peso(v, 0)} /> : <p className="muted-text">No sales yet today.</p>}</div>
      </section>
    </div>
    <div className="dashboard-lower">
      <section className="dashboard-module"><SectionHeading title="AI INSIGHTS" action={allowed.includes('AI Insights') ? 'ALL INSIGHTS' : undefined} onAction={() => actions.navigate('AI Insights')} />
        <div className="insight-list compact">{insights.slice(0, 3).map((insight) => <InsightCard key={insight.id} insight={insight} />)}</div>
      </section>
      <section className="dashboard-module attention-module"><SectionHeading title="NEEDS ATTENTION" action={allowed.includes('Inventory') ? 'VIEW ALL' : undefined} onAction={() => actions.navigate('Inventory')} />
        {attention.length === 0 && <p className="muted-text pad">All stock levels look healthy.</p>}
        {attention.map((a) => <div className="attention-item" key={a.product.id}>
          <span className={a.urgency === 'Urgent' ? 'attention-symbol warning' : 'attention-symbol expiry'}>{a.urgency === 'Urgent' ? '!' : '◷'}</span>
          <div><b>{a.product.name}</b><small>{a.product.stock} {a.product.unit}s left · {a.urgency === 'Urgent' ? `~${Math.max(0, a.daysOfCover).toFixed(1)} days of cover` : `expires in ${a.expiryDays} day(s)`}</small></div>
          <span className="attention-count">{a.urgency === 'Urgent' ? 'LOW STOCK' : 'EXPIRING'}</span>
        </div>)}
        <div className="shortcut-grid">
          {shortcuts.map((name, index) => <button key={name} className="shortcut" onClick={() => actions.navigate(name)}><span className={`shortcut-icon tone-${index}`}>{iconRegistry.shortcuts[name] ?? '↗'}</span><span><b>{name}</b><small>{shortcutText[name]}</small></span><i>→</i></button>)}
        </div>
      </section>
    </div>
  </div>
}
