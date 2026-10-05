import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { iconRegistry } from '../icons/iconRegistry'

type Editor =
  | 'Dashboard'
  | 'Product Grid'
  | 'Cart'
  | 'Inventory Metrics'
  | 'Inventory Table'
  | 'WMA Forecast'
  | 'Model Explanation'
  | 'Purchasing'
  | 'Waste Log'
  | 'Customer Requests'
  | 'Employees'
  | 'Reports'
  | 'Settings Navigation'
  | 'Business Settings'

type Direction = 'horizontal' | 'vertical'
type LayoutNode =
  | { type: 'panel'; id: string; editor: Editor }
  | { type: 'split'; id: string; direction: Direction; ratio: number; first: LayoutNode; second: LayoutNode }

interface Product {
  name: string
  category: string
  price: number
  stock: number
  color: string
  symbol: string
}

interface CartItem {
  product: Product
  quantity: number
}

type WorkspaceName = 'Dashboard' | 'Point of Sale' | 'Inventory' | 'Insights & Reports' | 'Waste' | 'Requests' | 'Employees' | 'Settings'

const editorGroups: { category: string; items: Editor[] }[] = [
  { category: 'General', items: ['Dashboard', 'Product Grid', 'Cart', 'Inventory Metrics', 'Inventory Table', 'Reports'] },
  { category: 'Animation', items: ['WMA Forecast'] },
  { category: 'Scripting', items: ['Purchasing', 'Waste Log', 'Customer Requests', 'Employees'] },
  { category: 'Data', items: ['Model Explanation', 'Settings Navigation', 'Business Settings'] },
]

const makePanel = (editor: Editor): LayoutNode => ({ type: 'panel', id: crypto.randomUUID(), editor })
const makeSplit = (direction: Direction, first: LayoutNode, second: LayoutNode, ratio = 0.5): LayoutNode => ({
  type: 'split', id: crypto.randomUUID(), direction, ratio, first, second,
})

function defaultLayout(workspace: WorkspaceName): LayoutNode {
  switch (workspace) {
    case 'Point of Sale': return makeSplit('horizontal', makePanel('Product Grid'), makePanel('Cart'), 0.8)
    case 'Inventory': return makeSplit('horizontal', makeSplit('vertical', makePanel('Inventory Metrics'), makePanel('Purchasing'), 0.3), makePanel('Inventory Table'), 0.45)
    case 'Insights & Reports': return makeSplit('horizontal', makeSplit('vertical', makePanel('WMA Forecast'), makePanel('Model Explanation'), 0.55), makePanel('Reports'), 0.55)
    case 'Waste': return makePanel('Waste Log')
    case 'Requests': return makePanel('Customer Requests')
    case 'Employees': return makePanel('Employees')
    case 'Settings': return makeSplit('horizontal', makePanel('Settings Navigation'), makePanel('Business Settings'))
    default: return makePanel('Dashboard')
  }
}

function updateNode(node: LayoutNode, id: string, update: (node: LayoutNode) => LayoutNode): LayoutNode {
  if (node.id === id) return update(node)
  if (node.type === 'panel') return node
  return { ...node, first: updateNode(node.first, id, update), second: updateNode(node.second, id, update) }
}

function updateRatio(node: LayoutNode, id: string, ratio: number): LayoutNode {
  return updateNode(node, id, (item) => item.type === 'split' ? { ...item, ratio } : item)
}

function replacePanel(node: LayoutNode, id: string, editor: Editor): LayoutNode {
  return updateNode(node, id, (item) => item.type === 'panel' ? { ...item, editor } : item)
}

function splitPanel(node: LayoutNode, id: string, direction: Direction, after: boolean, ratio = 0.5, editor?: Editor): LayoutNode {
  return updateNode(node, id, (item) => {
    if (item.type !== 'panel') return item
    const freshPanel = makePanel(editor ?? item.editor)
    return makeSplit(direction, after ? item : freshPanel, after ? freshPanel : item, ratio)
  })
}

function splitRatioAtPointer(direction: Direction, bounds: DOMRect, clientX: number, clientY: number) {
  const position = direction === 'horizontal' ? clientX - bounds.left : clientY - bounds.top
  const dimension = direction === 'horizontal' ? bounds.width : bounds.height
  return Math.max(0.005, Math.min(0.995, position / dimension))
}

function collapseSplit(node: LayoutNode, id: string, keep: 'first' | 'second'): LayoutNode {
  if (node.type === 'panel') return node
  if (node.id === id) return keep === 'first' ? node.first : node.second
  return { ...node, first: collapseSplit(node.first, id, keep), second: collapseSplit(node.second, id, keep) }
}

function editorForPanel(node: LayoutNode, id: string): Editor | undefined {
  if (node.type === 'panel') return node.id === id ? node.editor : undefined
  return editorForPanel(node.first, id) ?? editorForPanel(node.second, id)
}

type PanelNode = Extract<LayoutNode, { type: 'panel' }>
interface PanelRect { panel: PanelNode; x0: number; y0: number; x1: number; y1: number }

const edgeTolerance = 0.006

function collectPanelRects(node: LayoutNode, x0 = 0, y0 = 0, x1 = 1, y1 = 1, rects: PanelRect[] = []): PanelRect[] {
  if (node.type === 'panel') {
    rects.push({ panel: node, x0, y0, x1, y1 })
  } else if (node.direction === 'horizontal') {
    const cut = x0 + (x1 - x0) * node.ratio
    collectPanelRects(node.first, x0, y0, cut, y1, rects)
    collectPanelRects(node.second, cut, y0, x1, y1, rects)
  } else {
    const cut = y0 + (y1 - y0) * node.ratio
    collectPanelRects(node.first, x0, y0, x1, cut, rects)
    collectPanelRects(node.second, x0, cut, x1, y1, rects)
  }
  return rects
}

function buildLayoutFromRects(rects: PanelRect[], x0: number, y0: number, x1: number, y1: number): LayoutNode | undefined {
  if (rects.length === 1) return rects[0].panel
  for (const cut of new Set(rects.map((rect) => rect.x1).filter((x) => x < x1 - edgeTolerance))) {
    const first = rects.filter((rect) => rect.x1 <= cut + edgeTolerance)
    const second = rects.filter((rect) => rect.x0 >= cut - edgeTolerance)
    if (first.length === 0 || first.length + second.length !== rects.length) continue
    const firstNode = buildLayoutFromRects(first, x0, y0, cut, y1)
    const secondNode = buildLayoutFromRects(second, cut, y0, x1, y1)
    if (firstNode && secondNode) return makeSplit('horizontal', firstNode, secondNode, (cut - x0) / (x1 - x0))
  }
  for (const cut of new Set(rects.map((rect) => rect.y1).filter((y) => y < y1 - edgeTolerance))) {
    const first = rects.filter((rect) => rect.y1 <= cut + edgeTolerance)
    const second = rects.filter((rect) => rect.y0 >= cut - edgeTolerance)
    if (first.length === 0 || first.length + second.length !== rects.length) continue
    const firstNode = buildLayoutFromRects(first, x0, y0, x1, cut)
    const secondNode = buildLayoutFromRects(second, x0, cut, x1, y1)
    if (firstNode && secondNode) return makeSplit('vertical', firstNode, secondNode, (cut - y0) / (y1 - y0))
  }
  return undefined
}

// The target is absorbed only when the panels bordering it on the source's side
// start and end exactly where the target does (their gutters line up with its edges).
function joinPanels(layout: LayoutNode, sourceId: string, targetId: string): LayoutNode | undefined {
  const rects = collectPanelRects(layout)
  const source = rects.find((rect) => rect.panel.id === sourceId)
  const target = rects.find((rect) => rect.panel.id === targetId)
  if (!source || !target) return undefined
  const near = (a: number, b: number) => Math.abs(a - b) < edgeTolerance
  const overlapsY = (rect: PanelRect) => rect.y0 < target.y1 - edgeTolerance && rect.y1 > target.y0 + edgeTolerance
  const overlapsX = (rect: PanelRect) => rect.x0 < target.x1 - edgeTolerance && rect.x1 > target.x0 + edgeTolerance
  const sides = [
    { touches: (rect: PanelRect) => near(rect.x1, target.x0) && overlapsY(rect), vertical: true, grow: (rect: PanelRect) => ({ ...rect, x1: target.x1 }) },
    { touches: (rect: PanelRect) => near(rect.x0, target.x1) && overlapsY(rect), vertical: true, grow: (rect: PanelRect) => ({ ...rect, x0: target.x0 }) },
    { touches: (rect: PanelRect) => near(rect.y1, target.y0) && overlapsX(rect), vertical: false, grow: (rect: PanelRect) => ({ ...rect, y1: target.y1 }) },
    { touches: (rect: PanelRect) => near(rect.y0, target.y1) && overlapsX(rect), vertical: false, grow: (rect: PanelRect) => ({ ...rect, y0: target.y0 }) },
  ]
  const side = sides.find((candidate) => candidate.touches(source))
  if (!side) return undefined
  const neighbours = rects.filter((rect) => rect !== target && side.touches(rect))
  const aligned = side.vertical
    ? near(Math.min(...neighbours.map((rect) => rect.y0)), target.y0) && near(Math.max(...neighbours.map((rect) => rect.y1)), target.y1)
    : near(Math.min(...neighbours.map((rect) => rect.x0)), target.x0) && near(Math.max(...neighbours.map((rect) => rect.x1)), target.x1)
  if (!aligned) return undefined
  const remaining = rects.filter((rect) => rect !== target).map((rect) => neighbours.includes(rect) ? side.grow(rect) : rect)
  return buildLayoutFromRects(remaining, 0, 0, 1, 1)
}

function swapPanelEditors(node: LayoutNode, firstId: string, secondId: string): LayoutNode {
  const firstEditor = editorForPanel(node, firstId)
  const secondEditor = editorForPanel(node, secondId)
  if (!firstEditor || !secondEditor) return node
  return replacePanel(replacePanel(node, firstId, secondEditor), secondId, firstEditor)
}

function areasAreAdjacent(first: DOMRect, second: DOMRect) {
  const horizontalOverlap = first.top < second.bottom && first.bottom > second.top
  const verticalOverlap = first.left < second.right && first.right > second.left
  const touchesHorizontally = Math.abs(first.right - second.left) < 18 || Math.abs(second.right - first.left) < 18
  const touchesVertically = Math.abs(first.bottom - second.top) < 18 || Math.abs(second.bottom - first.top) < 18
  return (touchesHorizontally && horizontalOverlap) || (touchesVertically && verticalOverlap)
}

const workspaceNames: WorkspaceName[] = ['Dashboard', 'Point of Sale', 'Inventory', 'Insights & Reports', 'Waste', 'Requests', 'Employees', 'Settings']

interface SplitDrag {
  panelId: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  ctrlKey: boolean
  gestureDirection?: Direction
  axisAnchorX: number
  axisAnchorY: number
  joinDirection?: 'left' | 'right' | 'up' | 'down'
  joinBlocked?: boolean
  targetId?: string
  ghost?: { left: number; top: number; width: number; height: number }
  targetRect?: { left: number; top: number; width: number; height: number }
  sourceCenter?: { left: number; top: number }
}

function classifySplitDirection(dx: number, dy: number): Direction | undefined {
  const horizontalTravel = Math.abs(dx)
  const verticalTravel = Math.abs(dy)
  const minimumTravel = 12
  const axisMargin = 1.2

  if (Math.max(horizontalTravel, verticalTravel) < minimumTravel) return undefined
  if (horizontalTravel >= verticalTravel * axisMargin) return 'horizontal'
  if (verticalTravel >= horizontalTravel * axisMargin) return 'vertical'
  return undefined
}

function resolveSplitDirection(dx: number, dy: number, previous?: Direction): Direction {
  return previous ?? classifySplitDirection(dx, dy) ?? (Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical')
}

function Workspace() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceName>('Dashboard')
  const [layout, setLayout] = useState<LayoutNode>(() => defaultLayout('Dashboard'))
  const [dragging, setDragging] = useState(false)
  const [splitDrag, setSplitDrag] = useState<SplitDrag | null>(null)
  const [cartItems, setCartItems] = useState<CartItem[]>(() => products.slice(0, 3).map((product) => ({ product, quantity: 1 })))
  const [saleComplete, setSaleComplete] = useState(false)

  function addProduct(product: Product) {
    setSaleComplete(false)
    setCartItems((current) => {
      const existing = current.find((item) => item.product.name === product.name)
      return existing
        ? current.map((item) => item.product.name === product.name ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { product, quantity: 1 }]
    })
  }

  function changeQuantity(productName: string, amount: number) {
    setCartItems((current) => current
      .map((item) => item.product.name === productName ? { ...item, quantity: item.quantity + amount } : item)
      .filter((item) => item.quantity > 0))
  }

  function completeSale() {
    if (cartItems.length === 0) return
    setCartItems([])
    setSaleComplete(true)
  }

  function selectWorkspace(workspace: WorkspaceName) {
    setActiveWorkspace(workspace)
    setLayout(defaultLayout(workspace))
    setSplitDrag(null)
  }

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const workspace = (event as CustomEvent<WorkspaceName>).detail
      if (workspaceNames.includes(workspace)) selectWorkspace(workspace)
    }
    window.addEventListener('workspace-navigate', handleNavigate)
    return () => window.removeEventListener('workspace-navigate', handleNavigate)
  }, [])

  function beginSplitDrag(event: PointerEvent<HTMLButtonElement>, panelId: string) {
    event.preventDefault()
    event.stopPropagation()
    setSplitDrag({ panelId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, ctrlKey: event.ctrlKey, axisAnchorX: event.clientX, axisAnchorY: event.clientY })
  }

  function onWorkspacePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!splitDrag || splitDrag.pointerId !== event.pointerId) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-area-id]')
    const bounds = target?.getBoundingClientRect()
    const movementX = event.clientX - splitDrag.startX
    const movementY = event.clientY - splitDrag.startY
    let gestureDirection = splitDrag.gestureDirection
    let axisAnchorX = splitDrag.axisAnchorX
    let axisAnchorY = splitDrag.axisAnchorY
    if (!gestureDirection) {
      gestureDirection = classifySplitDirection(movementX, movementY)
      if (gestureDirection) {
        axisAnchorX = event.clientX
        axisAnchorY = event.clientY
      }
    } else {
      const sinceLockX = Math.abs(event.clientX - axisAnchorX)
      const sinceLockY = Math.abs(event.clientY - axisAnchorY)
      const perpendicularTravel = gestureDirection === 'horizontal' ? sinceLockY : sinceLockX
      if (perpendicularTravel >= 36) {
        gestureDirection = gestureDirection === 'horizontal' ? 'vertical' : 'horizontal'
        axisAnchorX = event.clientX
        axisAnchorY = event.clientY
      }
    }
    let ghost: SplitDrag['ghost']
    let joinDirection: SplitDrag['joinDirection']
    let sourceCenter: SplitDrag['sourceCenter']
    let targetPreviewRect: SplitDrag['targetRect']
    const ctrlKey = splitDrag.ctrlKey || event.ctrlKey
    const joinBlocked = !ctrlKey && !!target?.dataset.areaId && target.dataset.areaId !== splitDrag.panelId && !joinPanels(layout, splitDrag.panelId, target.dataset.areaId)
    if (target && bounds) {
      if (target.dataset.areaId === splitDrag.panelId && gestureDirection) {
        const ratio = splitRatioAtPointer(gestureDirection, bounds, event.clientX, event.clientY)
        ghost = gestureDirection === 'horizontal'
          ? { left: bounds.left + bounds.width * ratio, top: bounds.top, width: 2, height: bounds.height }
          : { left: bounds.left, top: bounds.top + bounds.height * ratio, width: bounds.width, height: 2 }
      } else if (target.dataset.areaId !== splitDrag.panelId) {
        const source = document.querySelector<HTMLElement>(`[data-area-id="${splitDrag.panelId}"]`)
        if (source) {
          const sourceBounds = source.getBoundingClientRect()
          const preview = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
          targetPreviewRect = preview
          const centerX = preview.left + preview.width / 2
          const centerY = preview.top + preview.height / 2
          const sourceX = sourceBounds.left + sourceBounds.width / 2
          const sourceY = sourceBounds.top + sourceBounds.height / 2
          const deltaX = centerX - sourceX
          const deltaY = centerY - sourceY
          sourceCenter = { left: sourceX, top: sourceY }
          joinDirection = Math.abs(deltaX) >= Math.abs(deltaY)
            ? deltaX < 0 ? 'left' : 'right'
            : deltaY < 0 ? 'up' : 'down'
        }
      }
    }
    setSplitDrag({
      ...splitDrag,
      x: event.clientX,
      y: event.clientY,
      ctrlKey,
      gestureDirection,
      axisAnchorX,
      axisAnchorY,
      joinDirection,
      joinBlocked,
      targetId: target?.dataset.areaId,
      ghost,
      targetRect: targetPreviewRect ?? (bounds ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } : undefined),
      sourceCenter,
    })
  }

  function onWorkspacePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!splitDrag || splitDrag.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.clientX - splitDrag.startX, event.clientY - splitDrag.startY)
    if (distance > 12) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-area-id]')
      const targetId = target?.dataset.areaId
      if (targetId) {
        if (targetId !== splitDrag.panelId) {
          const source = document.querySelector<HTMLElement>(`[data-area-id="${splitDrag.panelId}"]`)
          const swapping = splitDrag.ctrlKey || event.ctrlKey
          if (swapping && source && areasAreAdjacent(source.getBoundingClientRect(), target.getBoundingClientRect())) {
            setLayout((current) => swapPanelEditors(current, splitDrag.panelId, targetId))
          } else if (!swapping) {
            const joined = joinPanels(layout, splitDrag.panelId, targetId)
            if (joined) setLayout(joined)
          }
        } else {
          const dx = event.clientX - splitDrag.startX
          const dy = event.clientY - splitDrag.startY
          const direction = resolveSplitDirection(dx, dy, splitDrag.gestureDirection)
          const after = true
          const ratio = splitRatioAtPointer(direction, target.getBoundingClientRect(), event.clientX, event.clientY)
          setLayout((current) => splitPanel(current, targetId, direction, after, ratio))
        }
      }
    }
    setSplitDrag(null)
  }

  return (
    <main className="workbench" data-workspace={activeWorkspace} onPointerMove={onWorkspacePointerMove} onPointerUp={onWorkspacePointerUp}>
      <nav className="workspace-tabs" aria-label="Workspaces">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>{iconRegistry.brandMark}</span></div>
          <div><strong>9010</strong><span>GROCERY SYSTEM</span></div>
        </div>
        <div className="workspace-tab-list">
          <span className="tab-caption">WORKSPACES</span>
          {workspaceNames.map((workspace) => (
            <button key={workspace} className={activeWorkspace === workspace ? 'workspace-tab active' : 'workspace-tab'} onClick={() => selectWorkspace(workspace)}>
              {workspace}
            </button>
          ))}
          <button className="tab-add" title="Add workspace" aria-label="Add workspace" onClick={() => selectWorkspace('Dashboard')}>+</button>
        </div>
        <AccountMenu />
      </nav>

      <div className="workspace-titlebar">
        <div><span className="crumb">WORKSPACE</span><b>{activeWorkspace.toUpperCase()}</b><span className="crumb-separator">/</span><span className="title-detail">{workspaceDescription(activeWorkspace)}</span></div>
        <div className="title-actions"><span className="sync-status"><i /> ALL CHANGES SAVED</span><button className="quiet-button" onClick={() => setLayout(defaultLayout(activeWorkspace))}>Reset layout</button></div>
      </div>

      <section className={`area-canvas${dragging ? ' is-resizing' : ''}${splitDrag ? ' is-splitting' : ''}`}>
        <LayoutView
          node={layout}
          onLayoutChange={setLayout}
          onEditorChange={(id, editor) => setLayout((current) => replacePanel(current, id, editor))}
          onSplitDrag={beginSplitDrag}
          onResizeStart={() => setDragging(true)}
          onResizeEnd={() => setDragging(false)}
          onGutterSplit={(targetId, direction, after) => setLayout((current) => splitPanel(current, targetId, direction, after))}
          splitDrag={splitDrag}
          cartItems={cartItems}
          onAddProduct={addProduct}
          onChangeQuantity={changeQuantity}
          onClearCart={() => { setCartItems([]); setSaleComplete(false) }}
          onCompleteSale={completeSale}
          saleComplete={saleComplete}
        />
        {splitDrag?.ghost && <div className="split-ghost" style={splitDrag.ghost} />}
        {splitDrag?.targetRect && splitDrag.targetId !== splitDrag.panelId && <div className={splitDrag.ctrlKey ? 'area-drop-overlay swap-preview' : splitDrag.joinBlocked ? 'area-drop-overlay join-blocked' : 'area-drop-overlay'} style={splitDrag.targetRect} aria-hidden="true" />}
        {splitDrag?.sourceCenter && splitDrag.joinDirection && <div className={splitDrag.ctrlKey ? 'join-direction-indicator swap-preview' : splitDrag.joinBlocked ? 'join-direction-indicator join-blocked' : 'join-direction-indicator'} style={splitDrag.sourceCenter} aria-hidden="true"><span>{splitDrag.ctrlKey ? '↔' : splitDrag.joinBlocked ? '⊘' : ({ left: '←', right: '→', up: '↑', down: '↓' })[splitDrag.joinDirection]}</span></div>}
      </section>

      <footer className="status-bar"><span><i className="status-online" /> LOCAL MODE</span><span>MOCK DATA <b>•</b> LAST UPDATED JUST NOW</span><span className="status-right">9010 GROCERY <b>v1.0.4</b></span></footer>
    </main>
  )
}

function AccountMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  function openSettings() {
    window.dispatchEvent(new CustomEvent('workspace-navigate', { detail: 'Settings' }))
    setOpen(false)
  }

  function openCashier() {
    window.location.hash = '/cashier'
    setOpen(false)
  }

  return <div className="account-menu-wrap" ref={menuRef}>
    <button className="account-context" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
      <span className="account-clock">SHIFT 01 <b>08:42 AM</b></span><span className="avatar">JD</span><span className="account-person">John D.<small>STORE OWNER</small></span><span className="account-caret">⌄</span>
    </button>
    {open && <div className="account-dropdown" role="menu" aria-label="Account menu">
      <div className="account-menu-profile"><span className="avatar">JD</span><div><b>John Doe</b><small>STORE OWNER · FULL ACCESS</small></div></div>
      <button role="menuitem" onClick={openSettings}><span>⚙</span> Store settings</button>
      <button role="menuitem" onClick={openCashier}><span>▦</span> Cashier terminal</button>
    </div>}
  </div>
}

function workspaceDescription(workspace: WorkspaceName) {
  const descriptions: Record<WorkspaceName, string> = {
    Dashboard: 'Store overview', 'Point of Sale': 'Checkout terminal', Inventory: 'Stock control',
    'Insights & Reports': 'Forecasts, tax & operations', Waste: 'Loss tracking', Requests: 'Customer demand', Employees: 'Team access', Settings: 'Store configuration',
  }
  return descriptions[workspace]
}

interface LayoutViewProps {
  node: LayoutNode
  onLayoutChange: (update: (current: LayoutNode) => LayoutNode) => void
  onEditorChange: (id: string, editor: Editor) => void
  onSplitDrag: (event: PointerEvent<HTMLButtonElement>, id: string) => void
  onResizeStart: () => void
  onResizeEnd: () => void
  onGutterSplit: (targetId: string, direction: Direction, after: boolean) => void
  splitDrag: SplitDrag | null
  cartItems: CartItem[]
  onAddProduct: (product: Product) => void
  onChangeQuantity: (productName: string, amount: number) => void
  onClearCart: () => void
  onCompleteSale: () => void
  saleComplete: boolean
}

function LayoutView({ node, onLayoutChange, onEditorChange, onSplitDrag, onResizeStart, onResizeEnd, onGutterSplit, splitDrag, cartItems, onAddProduct, onChangeQuantity, onClearCart, onCompleteSale, saleComplete }: LayoutViewProps) {
  if (node.type === 'panel') {
    const highlighted = splitDrag?.panelId === node.id && splitDrag.targetId === node.id && Math.hypot(splitDrag.x - splitDrag.startX, splitDrag.y - splitDrag.startY) > 12
    return (
      <article className={`workspace-area${highlighted ? ' split-target' : ''}`} data-area-id={node.id}>
        <AreaPanel node={node} onEditorChange={onEditorChange} onSplitDrag={onSplitDrag} cartItems={cartItems} onAddProduct={onAddProduct} onChangeQuantity={onChangeQuantity} onClearCart={onClearCart} onCompleteSale={onCompleteSale} saleComplete={saleComplete} />
      </article>
    )
  }

  const splitStyle = node.direction === 'horizontal'
    ? { gridTemplateColumns: `minmax(0, ${node.ratio}fr) 8px minmax(0, ${1 - node.ratio}fr)` }
    : { gridTemplateRows: `minmax(0, ${node.ratio}fr) 8px minmax(0, ${1 - node.ratio}fr)` }

  function onGutterPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (node.type !== 'split') return
    const splitNode = node
    const resizeDirection: Direction = window.matchMedia('(max-width: 540px)').matches && splitNode.direction === 'horizontal' ? 'vertical' : splitNode.direction
    const container = event.currentTarget.parentElement
    if (!container) return
    const bounds = container.getBoundingClientRect()
    const dimension = resizeDirection === 'horizontal' ? bounds.width : bounds.height
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    let splittingGesture = false
    event.currentTarget.setPointerCapture(pointerId)
    onResizeStart()

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const position = resizeDirection === 'horizontal' ? moveEvent.clientX - bounds.left : moveEvent.clientY - bounds.top
      const alongAxisDistance = resizeDirection === 'horizontal' ? Math.abs(moveEvent.clientX - startX) : Math.abs(moveEvent.clientY - startY)
      const crossAxisDistance = resizeDirection === 'horizontal' ? Math.abs(moveEvent.clientY - startY) : Math.abs(moveEvent.clientX - startX)
      if (crossAxisDistance > 24 && crossAxisDistance > alongAxisDistance * 0.5) {
        if (!splittingGesture) onLayoutChange((current) => updateRatio(current, splitNode.id, splitNode.ratio))
        splittingGesture = true
        return
      }
      if (splittingGesture) return
      const rawRatio = position / dimension
      const ratio = Math.max(0.04, Math.min(0.96, rawRatio))
      onLayoutChange((current) => updateRatio(current, splitNode.id, ratio))
    }
    const end = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      const position = resizeDirection === 'horizontal' ? endEvent.clientX - bounds.left : endEvent.clientY - bounds.top
      const rawRatio = position / dimension
      const crossAxisDistance = resizeDirection === 'horizontal'
        ? Math.abs(endEvent.clientY - startY)
        : Math.abs(endEvent.clientX - startX)
      const alongAxisDistance = resizeDirection === 'horizontal'
        ? Math.abs(endEvent.clientX - startX)
        : Math.abs(endEvent.clientY - startY)
      const target = document.elementFromPoint(endEvent.clientX, endEvent.clientY)?.closest<HTMLElement>('[data-area-id]')
      if (crossAxisDistance > 24 && crossAxisDistance > alongAxisDistance * 0.5 && target?.dataset.areaId) {
        const targetBounds = target.getBoundingClientRect()
        const x = (endEvent.clientX - targetBounds.left) / targetBounds.width
        const y = (endEvent.clientY - targetBounds.top) / targetBounds.height
        const distances = [x, 1 - x, y, 1 - y]
        const nearest = distances.indexOf(Math.min(...distances))
        const direction: Direction = nearest < 2 ? 'horizontal' : 'vertical'
        onGutterSplit(target.dataset.areaId, direction, nearest === 1 || nearest === 3)
      } else if (rawRatio < 0.08) {
        onLayoutChange((current) => collapseSplit(current, splitNode.id, 'second'))
      } else if (rawRatio > 0.92) {
        onLayoutChange((current) => collapseSplit(current, splitNode.id, 'first'))
      } else {
        const ratio = Math.max(0.12, Math.min(0.88, rawRatio))
        onLayoutChange((current) => updateRatio(current, splitNode.id, ratio))
      }
      onResizeEnd()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  return (
    <div className={`area-split ${node.direction}`} style={splitStyle}>
      <LayoutView node={node.first} onLayoutChange={onLayoutChange} onEditorChange={onEditorChange} onSplitDrag={onSplitDrag} onResizeStart={onResizeStart} onResizeEnd={onResizeEnd} onGutterSplit={onGutterSplit} splitDrag={splitDrag} cartItems={cartItems} onAddProduct={onAddProduct} onChangeQuantity={onChangeQuantity} onClearCart={onClearCart} onCompleteSale={onCompleteSale} saleComplete={saleComplete} />
      <div className={`area-gutter ${node.direction}`} role="separator" aria-orientation={node.direction === 'horizontal' ? 'vertical' : 'horizontal'} onPointerDown={onGutterPointerDown}>
        <span className="gutter-grip" />
      </div>
      <LayoutView node={node.second} onLayoutChange={onLayoutChange} onEditorChange={onEditorChange} onSplitDrag={onSplitDrag} onResizeStart={onResizeStart} onResizeEnd={onResizeEnd} onGutterSplit={onGutterSplit} splitDrag={splitDrag} cartItems={cartItems} onAddProduct={onAddProduct} onChangeQuantity={onChangeQuantity} onClearCart={onClearCart} onCompleteSale={onCompleteSale} saleComplete={saleComplete} />
    </div>
  )
}

function AreaPanel({ node, onEditorChange, onSplitDrag, cartItems, onAddProduct, onChangeQuantity, onClearCart, onCompleteSale, saleComplete }: {
  node: Extract<LayoutNode, { type: 'panel' }>
  onEditorChange: (id: string, editor: Editor) => void
  onSplitDrag: (event: PointerEvent<HTMLButtonElement>, id: string) => void
  cartItems: CartItem[]
  onAddProduct: (product: Product) => void
  onChangeQuantity: (productName: string, amount: number) => void
  onClearCart: () => void
  onCompleteSale: () => void
  saleComplete: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setMenuOpen(false)
    }
    const closeOnViewportChange = () => setMenuOpen(false)
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [menuOpen])

  function toggleMenu() {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const bounds = triggerRef.current?.getBoundingClientRect()
    if (!bounds) return
    const menuWidth = Math.min(240, window.innerWidth - 16)
    const menuHeight = Math.min(window.innerHeight * 0.72, 560)
    const roomBelow = window.innerHeight - bounds.bottom - 8
    const roomAbove = bounds.top - 8
    const openAbove = roomBelow < 340 && roomAbove > roomBelow
    const top = openAbove
      ? Math.max(8, bounds.top - Math.min(menuHeight, roomAbove) - 5)
      : Math.min(bounds.bottom + 5, window.innerHeight - Math.min(menuHeight, roomBelow) - 8)
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - menuWidth - 8))
    setMenuPosition({ top, left })
    setMenuOpen(true)
  }

  return <>
    <header className="area-header">
      <div className="area-header-left">
        <div className="editor-menu-anchor">
          <button ref={triggerRef} className="editor-type-trigger" aria-haspopup="menu" aria-expanded={menuOpen} onClick={toggleMenu} onKeyDown={(event) => { if (event.key === 'Escape') setMenuOpen(false) }}>
            <span className="editor-type-icon">{iconRegistry.editors[node.editor]}</span><span>{node.editor}</span><span className="editor-type-caret">⌄</span>
          </button>
          {menuOpen && menuPosition && createPortal(<div ref={menuRef} className="editor-type-menu" style={menuPosition} role="menu" aria-label="Editor Type" onKeyDown={(event) => { if (event.key === 'Escape') setMenuOpen(false) }}>
            {editorGroups.map((group) => <section className="editor-menu-group" key={group.category} role="group" aria-label={group.category}>
              <h3>{group.category}</h3>
              {group.items.map((editor) => <button key={editor} role="menuitemradio" aria-checked={node.editor === editor} className={node.editor === editor ? 'editor-menu-item selected' : 'editor-menu-item'} onClick={() => { onEditorChange(node.id, editor); setMenuOpen(false) }}>
                <span className="editor-type-icon">{iconRegistry.editors[editor]}</span><span>{editor}</span>{node.editor === editor && <i>✓</i>}
              </button>)}
            </section>)}
          </div>, document.body)}
        </div>
        <span className="area-path">{node.editor === 'Dashboard' ? 'OVERVIEW' : 'EDITOR'}</span>
      </div>
    </header>
    <button className="area-corner-handle" title="Drag corner to split, join, or Ctrl-drag to swap" aria-label="Drag area corner to split, join, or swap" onPointerDown={(event) => onSplitDrag(event, node.id)}><span>◢</span></button>
    <div className="area-content"><EditorContent editor={node.editor} cartItems={cartItems} onAddProduct={onAddProduct} onChangeQuantity={onChangeQuantity} onClearCart={onClearCart} onCompleteSale={onCompleteSale} saleComplete={saleComplete} /></div>
  </>
}

function EditorContent({ editor, cartItems, onAddProduct, onChangeQuantity, onClearCart, onCompleteSale, saleComplete }: {
  editor: Editor
  cartItems: CartItem[]
  onAddProduct: (product: Product) => void
  onChangeQuantity: (productName: string, amount: number) => void
  onClearCart: () => void
  onCompleteSale: () => void
  saleComplete: boolean
}) {
  switch (editor) {
    case 'Dashboard': return <DashboardPanel />
    case 'Product Grid': return <ProductGrid onAddProduct={onAddProduct} />
    case 'Cart': return <CartPanel items={cartItems} onChangeQuantity={onChangeQuantity} onClear={onClearCart} onComplete={onCompleteSale} saleComplete={saleComplete} />
    case 'Inventory Metrics': return <InventoryMetrics />
    case 'Inventory Table': return <InventoryTable />
    case 'WMA Forecast': return <ForecastPanel />
    case 'Model Explanation': return <ModelPanel />
    case 'Purchasing': return <PurchasingPanel />
    case 'Waste Log': return <WastePanel />
    case 'Customer Requests': return <RequestsPanel />
    case 'Employees': return <EmployeesPanel />
    case 'Reports': return <ReportsPanel />
    case 'Settings Navigation': return <SettingsNav />
    case 'Business Settings': return <BusinessSettings />
  }
}

function DashboardPanel() {
  return <div className="dashboard-panel">
    <div className="alert-banner"><span className="alert-mark">!</span><div><b>2 items need attention</b><span>Review low stock and near-expiry products before end of shift.</span></div><button onClick={() => window.dispatchEvent(new CustomEvent('workspace-navigate', { detail: 'Inventory' }))}>REVIEW INVENTORY <span>↗</span></button></div>
    <div className="dashboard-heading"><div><span className="eyebrow">SUNDAY, OCTOBER 4, 2026</span><h1>Good morning, John.</h1><p>Here’s how Central Market is performing today.</p></div><span className="open-status"><i /> STORE OPEN</span></div>
    <div className="metric-grid">
      <Metric label="Today's sales" value="₱18,420" change="+12.8%" note="vs. yesterday" accent="green" />
      <Metric label="Transactions" value="143" change="+8.2%" note="since opening" accent="orange" />
      <Metric label="Low-stock items" value="06" change="2 urgent" note="below reorder point" accent="red" />
      <Metric label="Near expiry" value="12" change="next 7 days" note="across 4 products" accent="blue" />
    </div>
    <div className="dashboard-lower">
      <section className="dashboard-module"><SectionHeading title="QUICK ACCESS" action="ALL MODULES" /><div className="shortcut-grid">
        {(['Point of Sale', 'Inventory', 'Insights & Reports', 'Waste', 'Settings'] as (keyof typeof iconRegistry.shortcuts)[]).map((name, index) => <button key={name} className="shortcut" onClick={() => window.dispatchEvent(new CustomEvent('workspace-navigate', { detail: name }))}><span className={`shortcut-icon tone-${index}`}>{iconRegistry.shortcuts[name]}</span><span><b>{name}</b><small>{['Start a transaction', 'Manage stock and reorders', 'Forecasts and BIR reports', 'Track losses', 'Store preferences'][index]}</small></span><i>→</i></button>)}
      </div></section>
      <section className="dashboard-module attention-module"><SectionHeading title="NEEDS ATTENTION" action="VIEW ALL" /><div className="attention-item"><span className="attention-symbol warning">!</span><div><b>Datu Puti Vinegar 1L</b><small>6 units left · reorder point 10</small></div><span className="attention-count">LOW STOCK</span></div><div className="attention-item"><span className="attention-symbol expiry">◷</span><div><b>Fresh Milk 1L</b><small>8 units · expires in 2 days</small></div><span className="attention-count">EXPIRING</span></div><div className="attention-foot"><span>AI RECOMMENDATION</span><b>3 reorder suggestions ready</b><button onClick={() => window.dispatchEvent(new CustomEvent('workspace-navigate', { detail: 'Inventory' }))}>Review list →</button></div></section>
    </div>
  </div>
}

function Metric({ label, value, change, note, accent }: { label: string; value: string; change: string; note: string; accent: string }) {
  return <div className={`metric-card ${accent}`}><div className="metric-top"><span>{label}</span><i>↗</i></div><strong>{value}</strong><div className="metric-note"><b>{change}</b><span>{note}</span></div><div className="metric-spark"><span /></div></div>
}

function SectionHeading({ title, action }: { title: string; action?: string }) {
  return <div className="section-heading"><h2>{title}</h2>{action && <button>{action} <span>↗</span></button>}</div>
}

const products: Product[] = [
  { name: 'Jasmine Rice 5kg', category: 'Grains', price: 325, stock: 24, color: 'rice', symbol: 'R' },
  { name: 'Fresh Milk 1L', category: 'Dairy', price: 98, stock: 8, color: 'milk', symbol: 'M' },
  { name: 'Bananas 1kg', category: 'Produce', price: 82, stock: 31, color: 'banana', symbol: 'B' },
  { name: 'Eggs (12 pcs)', category: 'Dairy', price: 112, stock: 16, color: 'eggs', symbol: 'E' },
  { name: 'Instant Noodles', category: 'Pantry', price: 18, stock: 54, color: 'noodles', symbol: 'N' },
  { name: 'Cooking Oil 1L', category: 'Pantry', price: 145, stock: 12, color: 'oil', symbol: 'O' },
]

function ProductGrid({ onAddProduct }: { onAddProduct: (product: Product) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All items')
  const categories = ['All items', 'Produce', 'Dairy', 'Grains', 'Pantry']
  const filtered = products.filter((product) => (category === 'All items' || product.category === category) && product.name.toLowerCase().includes(query.toLowerCase()))
  return <div className="pos-products"><div className="panel-toolbar"><label className="search-field"><span>⌕</span><input placeholder="Search products or scan barcode" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></label><button className="scan-button" title="Scan barcode" aria-label="Scan barcode">▥</button></div><div className="category-pills">{categories.map((item) => <button key={item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="product-grid">{filtered.map((product) => <button className="product-card" key={product.name} onClick={() => onAddProduct(product)}><span className={`product-image ${product.color}`}><i>{product.symbol}</i><small>{product.category.toUpperCase()}</small></span><span className="product-info"><b>{product.name}</b><span>₱{product.price.toFixed(2)}</span><small className={product.stock < 10 ? 'stock-low' : ''}>{product.stock} in stock</small></span><span className="product-add">+</span></button>)}</div><div className="results-count">SHOWING {filtered.length} OF {products.length} PRODUCTS <button>MANAGE CATALOG ↗</button></div></div>
}

function CartPanel({ items, onChangeQuantity, onClear, onComplete, saleComplete }: {
  items: CartItem[]
  onChangeQuantity: (productName: string, amount: number) => void
  onClear: () => void
  onComplete: () => void
  saleComplete: boolean
}) {
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const vat = subtotal - subtotal / 1.12
  return <div className="cart-panel">
    <div className="cart-meta"><span>TRANSACTION <b>#POS-00482</b></span><button onClick={onClear}>CLEAR</button></div>
    <div className="cart-lines">
      {items.length > 0 ? items.map(({ product, quantity }, index) => <div className="cart-line" key={product.name}>
        <span className="cart-line-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="cart-item-name"><b>{product.name}</b><small>₱{product.price.toFixed(2)} / unit</small></div>
        <div className="quantity-control">
          <button aria-label={`Remove one ${product.name}`} onClick={() => onChangeQuantity(product.name, -1)}>−</button>
          <span>{quantity}</span>
          <button aria-label={`Add one ${product.name}`} onClick={() => onChangeQuantity(product.name, 1)}>+</button>
        </div>
        <strong>₱{(product.price * quantity).toFixed(2)}</strong>
      </div>) : <div className="empty-cart">{saleComplete ? 'Sale completed. Ready for the next transaction.' : 'Cart cleared. Add a product to begin.'}</div>}
    </div>
    <div className="cart-bottom">
      <div className="cart-totals">
        <div><span>Subtotal</span><b>₱{subtotal.toFixed(2)}</b></div>
        <div><span>VAT included (12%)</span><b>₱{vat.toFixed(2)}</b></div>
        <div className="total-due"><span>TOTAL DUE</span><strong>₱{subtotal.toFixed(2)}</strong></div>
      </div>
      <button className="complete-sale" disabled={items.length === 0} onClick={onComplete}>COMPLETE SALE <span>→</span></button>
      <div className="payment-hint">ENTER <span>·</span> CASH PAYMENT <span>·</span> EXACT CHANGE</div>
    </div>
  </div>
}

function InventoryMetrics() {
  return <div className="inventory-metrics"><div className="inventory-heading"><div><span className="eyebrow">STOCK OVERVIEW</span><h2>Inventory at a glance</h2></div><button className="outline-button">↓ EXPORT</button></div><div className="inventory-metric-grid"><Metric label="Total products" value="1,284" change="+18" note="this month" accent="green" /><Metric label="Inventory value" value="₱842k" change="+4.6%" note="vs. last month" accent="blue" /><Metric label="Low stock" value="06" change="2 urgent" note="below reorder level" accent="red" /><Metric label="Near expiry" value="12" change="next 7 days" note="across 4 products" accent="orange" /></div></div>
}

function InventoryTable() {
  const [query, setQuery] = useState('')
  const rows = [
    ['Jasmine Rice 5kg', 'Grains', '24 bags', '10 bags', 'In stock', 'Dec 18, 2026'],
    ['Datu Puti Vinegar 1L', 'Condiments', '6 bottles', '10 bottles', 'Low stock', 'Feb 12, 2027'],
    ['Fresh Milk 1L', 'Dairy', '8 cartons', '15 cartons', 'Near expiry', 'Oct 06, 2026'],
    ['Cooking Oil 1L', 'Pantry', '12 bottles', '10 bottles', 'In stock', 'Jan 23, 2027'],
    ['Eggs (12 pcs)', 'Dairy', '16 trays', '12 trays', 'In stock', 'Oct 13, 2026'],
  ].filter((row) => row[0].toLowerCase().includes(query.toLowerCase()))
  return <div className="table-panel"><div className="table-toolbar"><label className="search-field compact"><span>⌕</span><input placeholder="Filter products" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div><button className="outline-button">FILTER <span>⌄</span></button><button className="primary-button">＋ ADD PRODUCT</button></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr>{['PRODUCT', 'CATEGORY', 'ON HAND', 'REORDER AT', 'STATUS', 'EXPIRY'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row[0]}><td><b>{row[0]}</b><small>SKU · 90{rows.indexOf(row) + 1}84</small></td>{row.slice(1).map((cell, index) => index === 3 ? <td key={index}><span className={`status-pill ${cell.toLowerCase().replace(' ', '-')}`}>{cell}</span></td> : <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div><div className="table-foot"><span>SHOWING {rows.length} OF 1,284 PRODUCTS</span><div><button>‹</button><b>1</b><button>2</button><button>3</button><span>…</span><button>52</button><button>›</button></div></div></div>
}

function ForecastPanel() {
  const bars = [39, 53, 46, 63, 58, 71, 49, 78, 65, 83, 61, 74]
  return <div className="forecast-panel"><div className="forecast-heading"><div><span className="eyebrow">DEMAND FORECAST · JASMINE RICE 5KG</span><h2>Sales trend &amp; forecast</h2></div><button className="range-select">LAST 12 WEEKS⌄</button></div><div className="chart-legend"><span><i className="legend-sales" /> ACTUAL SALES</span><span><i className="legend-forecast" /> WMA FORECAST</span></div><div className="chart"><div className="chart-y-labels"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div className="chart-main"><div className="chart-gridlines"><i /><i /><i /><i /><i /></div><div className="chart-bars">{bars.map((height, index) => <div className="chart-column" key={index}><span className="chart-bar" style={{ height: `${height}%` }} /><small>W{index + 1}</small></div>)}</div><svg className="forecast-line" viewBox="0 0 600 180" preserveAspectRatio="none" aria-label="WMA forecast line"><polyline points="0,92 50,86 100,83 150,79 200,72 250,70 300,67 350,64 400,60 450,57 500,54 550,52 600,47" /></svg></div></div><div className="chart-insight"><span>↗</span><div><b>Demand is trending up</b><small>Average weekly sales increased 8.4% over the last 4 weeks.</small></div><strong>+8.4%</strong></div></div>
}

function ModelPanel() {
  return <div className="model-panel"><div className="model-title"><span className="model-symbol">∑</span><div><span className="eyebrow">MODEL DETAILS</span><h2>Weighted moving average</h2></div></div><p className="model-description">Recent sales are weighted more heavily to respond to changing demand while smoothing short-term fluctuations.</p><div className="forecast-callout"><span>NEXT WEEK FORECAST</span><strong>11.6 <small>units / week</small></strong><div><i /> HIGH CONFIDENCE <b>86%</b></div></div><SectionHeading title="WEIGHT CONFIGURATION" /><div className="weight-list">{[['W1', 'Most recent week', '0.50', '50%'], ['W2', 'Previous week', '0.30', '30%'], ['W3', 'Two weeks prior', '0.20', '20%']].map(([key, label, value, width]) => <div className="weight-row" key={key}><span>{key}</span><div><b>{label}</b><i><em style={{ width }} /></i></div><strong>{value}</strong></div>)}</div><div className="advisory-banner"><span>i</span><p><b>Reorder advisory</b><small>Projected demand is above current stock coverage. Consider adding 8 units to the next purchase order.</small></p></div><div className="model-foot"><span>MODEL UPDATED 06:00 AM</span><button>VIEW METHODOLOGY ↗</button></div></div>
}

const purchaseRows = [['Jasmine Rice 5kg', '24 bags', '11 bags', '8 bags', 'Rice & Grains'], ['Datu Puti Vinegar 1L', '6 bottles', '10 bottles', '12 bottles', 'Condiments'], ['Fresh Milk 1L', '8 cartons', '15 cartons', '10 cartons', 'Dairy'], ['Cooking Oil 1L', '12 bottles', '10 bottles', '6 bottles', 'Pantry']]

function PurchasingPanel() {
  return <div className="module-panel"><div className="module-intro"><div><span className="eyebrow">AI-ASSISTED REPLENISHMENT</span><h2>Suggested purchase orders</h2><p>Based on stock levels, lead times, and weighted moving average forecasts.</p></div><button className="primary-button">＋ CREATE PURCHASE ORDER</button></div><div className="data-table-wrap"><table className="data-table"><thead><tr>{['PRODUCT', 'ON HAND', 'REORDER AT', 'SUGGESTED QTY', 'SUPPLIER'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{purchaseRows.map((row) => <tr key={row[0]}><td><b>{row[0]}</b></td><td>{row[1]}</td><td>{row[2]}</td><td><span className="suggested-qty">{row[3]}</span></td><td>{row[4]}</td></tr>)}</tbody></table></div><div className="wma-evidence"><span className="evidence-icon">⌁</span><div><b>WMA evidence</b><small>4 products matched reorder thresholds · Demand model refreshed today at 06:00 AM</small></div><button>INSPECT FORECAST →</button></div></div>
}

function WastePanel() {
  const rows = [['Fresh Milk 1L', '4 cartons', 'Expired', '₱392.00', 'Today, 08:14'], ['Bananas 1kg', '2 kg', 'Damaged', '₱164.00', 'Today, 07:32'], ['White Bread', '3 loaves', 'Expired', '₱150.00', 'Yesterday'], ['Eggs (12 pcs)', '1 tray', 'Damaged', '₱112.00', 'Oct 02, 2026']]
  return <ModuleTable title="Waste & spoilage log" eyebrow="LOSS PREVENTION" action="＋ LOG WASTE" headers={['PRODUCT', 'QUANTITY', 'REASON', 'VALUE', 'DATE LOGGED']} rows={rows} />
}

function RequestsPanel() {
  const rows = [['Silver Swan Soy Sauce, 1 gal', 'Pantry', 'Maria Santos', 'Today, 08:22', 'New'], ['Oat Milk, Unsweetened', 'Dairy alternatives', 'R. Dela Cruz', 'Today, 07:56', 'Review'], ['Brown Sugar 2kg', 'Baking', 'Ana Reyes', 'Yesterday', 'Review'], ['Canned Sardines (spicy)', 'Canned goods', 'Walk-in', 'Oct 02, 2026', 'Ordered']]
  return <ModuleTable title="Customer item requests" eyebrow="CUSTOMER DEMAND" action="＋ ADD REQUEST" headers={['REQUESTED ITEM', 'CATEGORY', 'REQUESTED BY', 'DATE', 'STATUS']} rows={rows} />
}

function EmployeesPanel() {
  const rows = [['John Doe', 'john.doe@9010.store', 'Store Owner', 'Active', 'Today, 06:02'], ['Maria Santos', 'm.santos@9010.store', 'Cashier', 'Active', 'Today, 08:12'], ['Rafael Cruz', 'r.cruz@9010.store', 'Inventory Clerk', 'Active', 'Today, 07:48'], ['Ana Reyes', 'a.reyes@9010.store', 'Cashier', 'On leave', 'Oct 03, 2026']]
  return <ModuleTable title="Team members" eyebrow="PEOPLE & ACCESS" action="＋ ADD EMPLOYEE" headers={['EMPLOYEE', 'EMAIL', 'ROLE', 'STATUS', 'LAST ACTIVE']} rows={rows} />
}

function ModuleTable({ title, eyebrow, action, headers, rows }: { title: string; eyebrow: string; action: string; headers: string[]; rows: string[][] }) {
  return <div className="module-panel"><div className="module-intro"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>Store data is shown from the local demo dataset.</p></div><button className="primary-button">{action}</button></div><div className="table-toolbar"><label className="search-field compact"><span>⌕</span><input placeholder="Search records" /></label><button className="outline-button">FILTER⌄</button></div><div className="data-table-wrap"><table className="data-table"><thead><tr>{headers.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={index}>{index === 0 ? <b>{cell}</b> : index === row.length - 2 && ['New', 'Review', 'Ordered', 'Active', 'On leave'].includes(cell) ? <span className={`status-pill ${cell.toLowerCase().replace(' ', '-')}`}>{cell}</span> : cell}</td>)}</tr>)}</tbody></table></div><div className="table-foot"><span>SHOWING {rows.length} RECORDS</span><div><button>‹</button><b>1</b><button>2</button><button>3</button><button>›</button></div></div></div>
}

function ReportsPanel() {
  const reports = [['X-Reading', 'Mid-shift sales summary', 'SHIFT REPORT', '↗'], ['Z-Reading', 'End-of-day register close', 'DAILY CLOSE', '▥'], ['e-Journal', 'Electronic sales journal', 'BIR COMPLIANT', '≡'], ['VAT Summary', 'Output tax by period', 'TAX SUMMARY', '₱'], ['Sales by Item', 'Product performance breakdown', 'OPERATIONS', '▤'], ['Inventory Valuation', 'Stock value at cost', 'INVENTORY', '◫']]
  return <div className="module-panel reports-panel"><div className="module-intro"><div><span className="eyebrow">REPORT CENTER</span><h2>Reports &amp; compliance</h2><p>Operational summaries and BIR-aligned records for your store.</p></div><button className="outline-button">DATE RANGE⌄</button></div><div className="report-grid">{reports.map(([name, description, tag, icon]) => <button className="report-card" key={name}><span className="report-icon">{icon}</span><span className="report-tag">{tag}</span><b>{name}</b><small>{description}</small><i>OPEN REPORT ↗</i></button>)}</div></div>
}

function SettingsNav() {
  const categories = ['Business profile', 'Tax & receipts', 'Payment methods', 'Inventory rules', 'Notifications', 'Access & roles']
  return <div className="settings-nav"><span className="eyebrow">CONFIGURATION</span><h2>Store settings</h2>{categories.map((category, index) => <button className={index === 0 ? 'selected' : ''} key={category}>{category}<span>›</span></button>)}</div>
}

function BusinessSettings() {
  return <div className="settings-form"><span className="eyebrow">BUSINESS PROFILE</span><h2>Store information</h2><p>These details appear on receipts and generated reports.</p><label>REGISTERED BUSINESS NAME<input defaultValue="9010 Grocery Retail Inc." /></label><label>STORE DISPLAY NAME<input defaultValue="Central Market" /></label><div className="form-row"><label>BUSINESS TIN<input defaultValue="000-123-456-000" /></label><label>STORE CODE<input defaultValue="CM-001" /></label></div><label>REGISTERED ADDRESS<textarea defaultValue="123 Market Street, Quezon City, Metro Manila" /></label><div className="form-actions"><span>LAST SAVED TODAY, 08:20 AM</span><button className="primary-button">SAVE CHANGES</button></div></div>
}

export default Workspace