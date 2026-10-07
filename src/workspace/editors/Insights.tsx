import { useMemo, useState } from 'react'
import type { ForecastMethod } from '../../data/types'
import { askAssistant, basketRules, bestMethod, forecastSeries, trafficHeatmap, WEEKS, weekLabels, type AssistantAnswer, type Insight } from '../../lib/ai'
import { peso, pct } from '../../lib/format'
import { useAnalytics, useStore } from '../../store/StoreContext'
import { ComboChart, Empty, Heatmap, Legend, SERIES, Segmented, SectionHeading, Sparkline } from '../ui'

const methodNames: Record<ForecastMethod, string> = { WMA: 'Weighted moving average', SES: 'Simple exponential smoothing', Holt: 'Holt linear trend' }

function ProductPicker() {
  const { state, actions } = useStore()
  return <select className="select" aria-label="Product" value={state.ui.forecastProductId} onChange={(e) => actions.setUi({ forecastProductId: e.target.value })}>
    {[...state.products].filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
  </select>
}

export function ForecastPanel() {
  const { state } = useStore()
  const { byId } = useAnalytics()
  const [method, setMethod] = useState<ForecastMethod>(state.settings.forecastMethod)
  const analysis = byId.get(state.ui.forecastProductId) ?? [...byId.values()][0]
  if (!analysis) return <Empty>No products to forecast.</Empty>
  const result = forecastSeries(analysis.weekly, method, state.settings, 4)
  const labels = [...weekLabels(), '+1 wk', '+2 wk', '+3 wk', '+4 wk']
  const pad = <T,>(values: T[], before: number, after: number) => [...new Array(before).fill(null), ...values, ...new Array(after).fill(null)]
  const forecastLine = [...new Array(WEEKS - 1).fill(null), analysis.weekly[WEEKS - 1], ...result.forecast]
  const up = analysis.change > 0

  return <div className="forecast-panel">
    <div className="forecast-heading"><div><span className="eyebrow">DEMAND FORECAST · {analysis.product.name.toUpperCase()}</span><h2>Sales trend &amp; forecast</h2></div><div className="heading-controls"><ProductPicker /><Segmented label="Forecast method" options={['WMA', 'SES', 'Holt'] as const} value={method} onChange={setMethod} /></div></div>
    <Legend items={[{ name: 'Actual units / week', color: SERIES[0], kind: 'bar' }, { name: 'Model fit', color: SERIES[1], kind: 'dashed' }, { name: `${method} forecast`, color: SERIES[2], kind: 'line' }, { name: '80% interval', color: SERIES[2], kind: 'band' }]} />
    <ComboChart height={240} labels={labels} splitIndex={WEEKS}
      bars={{ name: 'Actual', color: SERIES[0], values: pad(analysis.weekly, 0, 4) }}
      lines={[{ name: 'Model fit', color: SERIES[1], values: pad(result.fitted, 0, 4), dashed: true }, { name: 'Forecast', color: SERIES[2], values: forecastLine }]}
      band={{ name: '80% interval', color: SERIES[2], lower: pad(result.lower, WEEKS, 0), upper: pad(result.upper, WEEKS, 0) }}
      format={(v) => v.toFixed(0)} />
    <div className="chart-insight"><span>{up ? '↗' : analysis.change < -0.06 ? '↘' : '→'}</span><div><b>Demand is {analysis.direction.toLowerCase()}</b><small>Last 4 weeks sold {analysis.weekly.slice(-4).reduce((a, b) => a + b, 0)} vs {analysis.weekly.slice(-8, -4).reduce((a, b) => a + b, 0)} the 4 weeks before. Next week: {result.forecast[0].toFixed(1)} {analysis.product.unit}s ({result.lower[0].toFixed(0)}–{result.upper[0].toFixed(0)}).</small></div><strong className={up ? '' : 'down'}>{pct(analysis.change)}</strong></div>
  </div>
}

export function ModelPanel() {
  const { state, actions } = useStore()
  const { byId } = useAnalytics()
  const analysis = byId.get(state.ui.forecastProductId) ?? [...byId.values()][0]
  if (!analysis) return <Empty>No products to forecast.</Empty>
  const settings = state.settings
  const results = (['WMA', 'SES', 'Holt'] as ForecastMethod[]).map((m) => forecastSeries(analysis.weekly, m, settings))
  const best = bestMethod(analysis.weekly, settings)
  const active = results.find((r) => r.method === settings.forecastMethod)!
  const weightTotal = settings.wmaWeights.reduce((a, b) => a + b, 0)

  function setWeight(index: number, value: number) {
    const weights = [...settings.wmaWeights]
    weights[index] = value
    actions.updateSettings({ wmaWeights: weights })
  }

  return <div className="model-panel">
    <div className="model-title"><span className="model-symbol">∑</span><div><span className="eyebrow">MODEL DETAILS · {analysis.product.name.toUpperCase()}</span><h2>{methodNames[settings.forecastMethod]}</h2></div></div>
    <p className="model-description">{settings.forecastMethod === 'WMA' ? 'Recent weeks are weighted more heavily so the forecast reacts to changing demand while smoothing one-off spikes.' : settings.forecastMethod === 'SES' ? `Each week updates the level by α = ${settings.sesAlpha}; higher α reacts faster, lower α smooths more.` : 'Tracks both the level and the week-over-week trend, so growing or shrinking products are projected forward.'}</p>
    <div className="forecast-callout"><span>NEXT WEEK FORECAST</span><strong>{active.forecast[0].toFixed(1)} <small>{analysis.product.unit}s / week</small></strong><div><i className={active.confidence.toLowerCase()} /> {active.confidence.toUpperCase()} CONFIDENCE <b>{Math.round(active.accuracy * 100)}%</b></div></div>
    <SectionHeading title="BACKTEST · ALL METHODS ON THIS PRODUCT" />
    <table className="data-table compact-table"><thead><tr><th>METHOD</th><th>MAE</th><th>MAPE</th><th>ACCURACY</th><th /></tr></thead><tbody>
      {results.map((r) => <tr key={r.method} className={r.method === settings.forecastMethod ? 'selected' : ''}><td><b>{r.method}</b>{r.method === best.method && <small>BEST FIT</small>}</td><td>{r.mae.toFixed(1)}</td><td>{(r.mape * 100).toFixed(1)}%</td><td>{Math.round(r.accuracy * 100)}%</td>
        <td>{r.method !== settings.forecastMethod && <button className="link-button" onClick={() => actions.updateSettings({ forecastMethod: r.method })}>USE</button>}</td></tr>)}
    </tbody></table>
    {settings.forecastMethod === 'WMA' ? <>
      <SectionHeading title="WEIGHT CONFIGURATION (STORE-WIDE)" />
      <div className="weight-list">{settings.wmaWeights.map((w, i) => <div className="weight-row" key={i}><span>W{i + 1}</span><div><b>{['Most recent week', 'Previous week', 'Two weeks prior', 'Three weeks prior'][i]}</b><input type="range" min={0} max={1} step={0.05} value={w} aria-label={`Weight ${i + 1}`} onChange={(e) => setWeight(i, Number(e.target.value))} /></div><strong>{(w / (weightTotal || 1)).toFixed(2)}</strong></div>)}</div>
    </> : <>
      <SectionHeading title="SMOOTHING (STORE-WIDE)" />
      <div className="weight-list"><div className="weight-row"><span>α</span><div><b>Level smoothing</b><input type="range" min={0.05} max={0.95} step={0.05} value={settings.sesAlpha} aria-label="Alpha" onChange={(e) => actions.updateSettings({ sesAlpha: Number(e.target.value) })} /></div><strong>{settings.sesAlpha.toFixed(2)}</strong></div></div>
    </>}
    <div className="advisory-banner"><span>i</span><p><b>{analysis.suggestedQty ? 'Reorder advisory' : 'Stock coverage OK'}</b><small>{analysis.suggestedQty ? `Projected demand exceeds stock coverage (${analysis.daysOfCover.toFixed(1)} days vs ${analysis.product.leadTimeDays}-day lead time). Add ${analysis.suggestedQty} ${analysis.product.unit}s to the next purchase order.` : `${analysis.product.stock} on hand covers ~${Number.isFinite(analysis.daysOfCover) ? analysis.daysOfCover.toFixed(0) : '∞'} days of forecast demand.`}</small></p></div>
    <div className="model-foot"><span>MAE = avg units off per week · MAPE = avg % error</span>{analysis.suggestedQty > 0 && <button onClick={() => actions.navigate('Purchasing')}>CREATE PO ↗</button>}</div>
  </div>
}

export function TrendPanel() {
  const { state } = useStore()
  const { analyses } = useAnalytics()
  const [view, setView] = useState<'Categories' | 'Movers' | 'Traffic'>('Categories')
  const labels = weekLabels()
  const categoryRevenue = new Map<string, number[]>()
  for (const a of analyses) {
    const series = categoryRevenue.get(a.product.category) ?? new Array(WEEKS).fill(0)
    a.weekly.forEach((units, i) => { series[i] += units * a.product.price })
    categoryRevenue.set(a.product.category, series)
  }
  const topCategories = [...categoryRevenue].sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0)).slice(0, 5)
  const movers = [...analyses].filter((a) => a.units28 >= 8).sort((a, b) => b.change - a.change)
  const heat = useMemo(() => trafficHeatmap(state.transactions), [state.transactions])
  const hours = Array.from({ length: 14 }, (_, i) => i + 7)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return <div className="module-panel">
    <div className="module-intro"><div><span className="eyebrow">TREND ANALYSIS</span><h2>What’s changing in the store</h2></div><Segmented label="View" options={['Categories', 'Movers', 'Traffic'] as const} value={view} onChange={setView} /></div>
    {view === 'Categories' && <>
      <Legend items={topCategories.map(([name], i) => ({ name, color: SERIES[i] }))} />
      <ComboChart height={230} labels={labels} lines={topCategories.map(([name, values], i) => ({ name, values, color: SERIES[i] }))} format={(v) => (v >= 1000 ? `₱${(v / 1000).toFixed(0)}k` : `₱${v.toFixed(0)}`)} />
      <div className="trend-chips">{topCategories.map(([name, values], i) => {
        const change = (values.slice(-4).reduce((a, b) => a + b, 0) - values.slice(-8, -4).reduce((a, b) => a + b, 0)) / (values.slice(-8, -4).reduce((a, b) => a + b, 0) || 1)
        return <div key={name}><i style={{ background: SERIES[i] }} /><b>{name}</b><span className={change >= 0 ? 'up' : 'down'}>{pct(change, 0)}</span></div>
      })}</div>
    </>}
    {view === 'Movers' && <div className="movers">
      {[{ title: 'RISING DEMAND', list: movers.slice(0, 5) }, { title: 'FALLING DEMAND', list: movers.slice(-5).reverse() }].map((group) => <section key={group.title}><SectionHeading title={group.title} />
        {group.list.map((a) => <div className="mover-row" key={a.product.id}><div><b>{a.product.name}</b><small>{a.units28} units / 28 days</small></div><Sparkline values={a.weekly} color={a.change >= 0 ? SERIES[0] : SERIES[2]} /><strong className={a.change >= 0 ? 'up' : 'down'}>{pct(a.change, 0)}</strong></div>)}
      </section>)}
    </div>}
    {view === 'Traffic' && <>
      <p className="muted-text">Transactions per hour over the last 7 days. Use it to plan cashier shifts and deliveries.</p>
      <Heatmap rows={heat.map((row) => hours.map((h) => row[h]))} rowLabels={days} colLabels={hours.map((h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`)} format={(v, r, c) => `${days[r]} ${hours[c] % 12 || 12}${hours[c] < 12 ? 'am' : 'pm'}: ${v} transactions`} />
    </>}
  </div>
}

export function BasketPanel() {
  const { state } = useStore()
  const { analyses, abc } = useAnalytics()
  const rules = useMemo(() => basketRules(state.transactions).slice(0, 10), [state.transactions])
  const name = (id: string) => state.products.find((p) => p.id === id)?.name ?? id
  const classes = (['A', 'B', 'C'] as const).map((c) => {
    const items = analyses.filter((a) => abc.get(a.product.id) === c)
    return { c, count: items.length, revenue: items.reduce((s, a) => s + a.revenue28, 0) }
  })
  const totalRevenue = classes.reduce((s, c) => s + c.revenue, 0) || 1
  return <div className="module-panel">
    <div className="module-intro"><div><span className="eyebrow">MARKET BASKET ANALYSIS</span><h2>Frequently bought together</h2><p>Association rules mined from the last 7 days of receipts. Lift &gt; 1 means the pair appears together more often than chance.</p></div></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>IF CUSTOMER BUYS</th><th>THEY ALSO BUY</th><th>CONFIDENCE</th><th>LIFT</th><th>RECEIPTS</th></tr></thead><tbody>
      {rules.map((r) => <tr key={`${r.a}${r.b}`}><td><b>{name(r.a)}</b></td><td>{name(r.b)}</td><td><div className="inline-bar"><span style={{ width: `${r.confidence * 100}%` }} /></div>{Math.round(r.confidence * 100)}%</td><td><b>{r.lift.toFixed(2)}×</b></td><td>{r.together}</td></tr>)}
    </tbody></table>{rules.length === 0 && <Empty>Not enough receipts yet.</Empty>}</div>
    <SectionHeading title="ABC CLASSIFICATION · LAST 28 DAYS REVENUE" />
    <div className="abc-grid">{classes.map(({ c, count, revenue }) => <div key={c} className={`abc-card abc-${c}`}><strong>{c}</strong><div><b>{count} products · {Math.round((revenue / totalRevenue) * 100)}% of revenue</b><small>{c === 'A' ? 'Never run out; review weekly' : c === 'B' ? 'Standard reorder cycle' : 'Keep lean; candidates for delisting'}</small></div><span>{peso(revenue, 0)}</span></div>)}</div>
  </div>
}

export function InsightCard({ insight }: { insight: Insight }) {
  const { actions } = useStore()
  return <div className={`insight-card ${insight.severity}`}>
    <span className="insight-mark">{insight.severity === 'critical' ? '!' : insight.severity === 'warning' ? '◷' : insight.severity === 'opportunity' ? '↗' : 'i'}</span>
    <div><b>{insight.title}</b><small>{insight.detail}</small>{insight.action && <button onClick={() => actions.navigate(insight.action!.workspace, insight.action!.productId ? { forecastProductId: insight.action!.productId } : undefined)}>{insight.action.label} →</button>}</div>
    {insight.metric && <strong>{insight.metric}</strong>}
  </div>
}

const prompts = ['What should I reorder?', 'What will expire soon?', 'Which items are trending?', 'What sells together?', 'When are we busiest?', 'Forecast for rice']

export function InsightsFeedPanel() {
  const { state, actions } = useStore()
  const { insights, analyses } = useAnalytics()
  const [filter, setFilter] = useState<'All' | 'Risks' | 'Opportunities'>('All')
  const [question, setQuestion] = useState('')
  const [conversation, setConversation] = useState<{ q: string; a: AssistantAnswer }[]>([])
  const shown = insights.filter((i) => filter === 'All' || (filter === 'Risks' ? i.severity === 'critical' || i.severity === 'warning' : i.severity === 'opportunity' || i.severity === 'info'))

  function ask(text: string) {
    if (!text.trim()) return
    setConversation((c) => [{ q: text, a: askAssistant(text, analyses, state.transactions) }, ...c].slice(0, 6))
    setQuestion('')
  }

  return <div className="module-panel">
    <div className="module-intro"><div><span className="eyebrow">AI INSIGHTS</span><h2>Recommendations for today</h2><p>Generated from sales, stock, expiry, waste and customer-request data. Refreshes after every sale.</p></div><Segmented label="Filter insights" options={['All', 'Risks', 'Opportunities'] as const} value={filter} onChange={setFilter} /></div>
    <div className="ask-box"><span className="ask-mark">AI</span><input placeholder="Ask about your store… e.g. “What should I reorder?”" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(question) }} /><button className="primary-button" onClick={() => ask(question)}>ASK</button></div>
    <div className="prompt-chips">{prompts.map((p) => <button key={p} onClick={() => ask(p)}>{p}</button>)}</div>
    {conversation.map((turn, i) => <div className="answer" key={i}><span className="eyebrow">YOU ASKED · {turn.q.toUpperCase()}</span><p>{turn.a.text}</p>{turn.a.bullets && <ul>{turn.a.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}{turn.a.action && <button className="link-button" onClick={() => actions.navigate(turn.a.action!.workspace, turn.a.action!.productId ? { forecastProductId: turn.a.action!.productId } : undefined)}>{turn.a.action.label} →</button>}</div>)}
    <div className="insight-list">{shown.map((insight) => <InsightCard key={insight.id} insight={insight} />)}</div>
    {shown.length === 0 && <Empty>No insights in this category right now.</Empty>}
  </div>
}
