import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate } from 'react-router-dom'
import type { WorkspaceName } from '../data/types'
import { iconRegistry } from '../icons/iconRegistry'
import { initials, time } from '../lib/format'
import { useAnalytics, useCurrentUser, useStore } from '../store/StoreContext'
import { editorGroups, editors, type Editor } from '../workspace/editors'
import { Toasts } from '../workspace/ui'

type Direction = 'horizontal' | 'vertical'
type LayoutNode =
  | { type: 'panel'; id: string; editor: Editor }
  | { type: 'split'; id: string; direction: Direction; ratio: number; first: LayoutNode; second: LayoutNode }

const makePanel = (editor: Editor): LayoutNode => ({ type: 'panel', id: crypto.randomUUID(), editor })
const makeSplit = (direction: Direction, first: LayoutNode, second: LayoutNode, ratio = 0.5): LayoutNode => ({
  type: 'split', id: crypto.randomUUID(), direction, ratio, first, second,
})

function defaultLayout(workspace: WorkspaceName): LayoutNode {
  switch (workspace) {
    case 'Point of Sale': return makeSplit('horizontal', makePanel('Product Grid'), makePanel('Cart'), 0.64)
    case 'Transactions': return makeSplit('horizontal', makePanel('Transactions'), makeSplit('vertical', makePanel('Returns & Refunds'), makePanel('Shift & Cash Drawer'), 0.6), 0.6)
    case 'Inventory': return makeSplit('horizontal', makeSplit('vertical', makePanel('Inventory Metrics'), makePanel('Purchasing'), 0.3), makePanel('Inventory Table'), 0.45)
    case 'Purchasing': return makeSplit('horizontal', makePanel('Purchasing'), makePanel('Purchase Orders'), 0.58)
    case 'AI Insights': return makeSplit('horizontal', makeSplit('vertical', makePanel('WMA Forecast'), makePanel('Trend Analysis'), 0.52), makeSplit('vertical', makePanel('AI Insights'), makePanel('Model Explanation'), 0.5), 0.58)
    case 'Reports': return makeSplit('horizontal', makePanel('Reports'), makePanel('Basket Analysis'), 0.55)
    case 'Waste': return makePanel('Waste Log')
    case 'Requests': return makePanel('Customer Requests')
    case 'Employees': return makeSplit('horizontal', makePanel('Employees'), makePanel('Shift & Cash Drawer'), 0.6)
    case 'Settings': return makeSplit('horizontal', makePanel('Settings Navigation'), makePanel('Business Settings'), 0.3)
    default: return makePanel('Dashboard')
  }
}

function splitEditorFor(workspace: WorkspaceName): Editor {
  if (workspace === 'Point of Sale') return 'Cart'
  if (workspace === 'AI Insights') return 'Model Explanation'
  if (workspace === 'Transactions') return 'Returns & Refunds'
  return 'AI Insights'
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

function splitPanel(node: LayoutNode, id: string, direction: Direction, after: boolean, editor: Editor): LayoutNode {
  return updateNode(node, id, (item) => {
    if (item.type !== 'panel') return item
    const freshPanel = makePanel(editor)
    return makeSplit(direction, after ? item : freshPanel, after ? freshPanel : item)
  })
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

function removePanelAndCollapse(node: LayoutNode, id: string): LayoutNode {
  if (node.type === 'panel') return node
  if (node.first.type === 'panel' && node.first.id === id) return node.second
  if (node.second.type === 'panel' && node.second.id === id) return node.first
  return { ...node, first: removePanelAndCollapse(node.first, id), second: removePanelAndCollapse(node.second, id) }
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


interface SplitDrag {
  panelId: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  ctrlKey: boolean
  targetId?: string
  edge?: 'left' | 'right' | 'top' | 'bottom'
  ghost?: { left: number; top: number; width: number; height: number }
  targetRect?: { left: number; top: number; width: number; height: number }
}

function Workspace() {
  const { state } = useStore()
  const user = useCurrentUser()
  const allowed = user ? state.settings.rolePermissions[user.role] : []
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceName>('Dashboard')
  // Each workspace keeps its own arrangement while you switch tabs.
  const [layouts, setLayouts] = useState<Partial<Record<WorkspaceName, LayoutNode>>>({})
  const layout = layouts[activeWorkspace] ?? defaultLayout(activeWorkspace)
  const setLayout = (next: LayoutNode | ((current: LayoutNode) => LayoutNode)) => setLayouts((all) => {
    const current = all[activeWorkspace] ?? defaultLayout(activeWorkspace)
    return { ...all, [activeWorkspace]: typeof next === 'function' ? next(current) : next }
  })
  const [dragging, setDragging] = useState(false)
  const [splitDrag, setSplitDrag] = useState<SplitDrag | null>(null)
  const allowedRef = useRef(allowed)

  useEffect(() => { allowedRef.current = allowed })

  function selectWorkspace(workspace: WorkspaceName) {
    setActiveWorkspace(workspace)
    setSplitDrag(null)
  }

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const workspace = (event as CustomEvent<WorkspaceName>).detail
      if (allowedRef.current.includes(workspace)) selectWorkspace(workspace)
    }
    window.addEventListener('workspace-navigate', handleNavigate)
    return () => window.removeEventListener('workspace-navigate', handleNavigate)
  }, [])

  if (!user) return <Navigate to="/" replace />

  function beginSplitDrag(event: PointerEvent<HTMLButtonElement>, panelId: string) {
    event.preventDefault()
    event.stopPropagation()
    setSplitDrag({ panelId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, ctrlKey: event.ctrlKey })
  }

  function onWorkspacePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!splitDrag || splitDrag.pointerId !== event.pointerId) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-area-id]')
    const bounds = target?.getBoundingClientRect()
    let edge: SplitDrag['edge']
    let ghost: SplitDrag['ghost']
    if (target && bounds) {
      const x = (event.clientX - bounds.left) / bounds.width
      const y = (event.clientY - bounds.top) / bounds.height
      const distances = [x, 1 - x, y, 1 - y]
      const nearest = distances.indexOf(Math.min(...distances))
      edge = (['left', 'right', 'top', 'bottom'] as const)[nearest]
      ghost = edge === 'left' || edge === 'right'
        ? { left: event.clientX, top: bounds.top, width: 2, height: bounds.height }
        : { left: bounds.left, top: event.clientY, width: bounds.width, height: 2 }
    }
    setSplitDrag({
      ...splitDrag,
      x: event.clientX,
      y: event.clientY,
      ctrlKey: splitDrag.ctrlKey || event.ctrlKey,
      targetId: target?.dataset.areaId,
      edge,
      ghost,
      targetRect: bounds ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } : undefined,
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
          if (source && areasAreAdjacent(source.getBoundingClientRect(), target.getBoundingClientRect())) {
            setLayout((current) => splitDrag.ctrlKey || event.ctrlKey
              ? swapPanelEditors(current, splitDrag.panelId, targetId)
              : removePanelAndCollapse(current, splitDrag.panelId))
          }
        } else {
          const bounds = target.getBoundingClientRect()
          const x = (event.clientX - bounds.left) / bounds.width
          const y = (event.clientY - bounds.top) / bounds.height
          const distances = [x, 1 - x, y, 1 - y]
          const nearest = distances.indexOf(Math.min(...distances))
          const direction: Direction = nearest < 2 ? 'horizontal' : 'vertical'
          const after = nearest === 1 || nearest === 3
          setLayout((current) => splitPanel(current, targetId, direction, after, splitEditorFor(activeWorkspace)))
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
          {allowed.map((workspace) => (
            <button key={workspace} className={activeWorkspace === workspace ? 'workspace-tab active' : 'workspace-tab'} onClick={() => selectWorkspace(workspace)}>
              {workspace}
            </button>
          ))}
        </div>
        <AccountMenu />
      </nav>

      <div className="workspace-titlebar">
        <div><span className="crumb">WORKSPACE</span><b>{activeWorkspace.toUpperCase()}</b><span className="crumb-separator">/</span><span className="title-detail">{workspaceDescription(activeWorkspace)}</span></div>
        <div className="title-actions"><span className="sync-status"><i /> SAVED LOCALLY</span><button className="quiet-button" onClick={() => setLayout(defaultLayout(activeWorkspace))}>Reset layout</button></div>
      </div>

      <section className={`area-canvas${dragging ? ' is-resizing' : ''}${splitDrag ? ' is-splitting' : ''}`}>
        <LayoutView
          node={layout}
          onLayoutChange={setLayout}
          onEditorChange={(id, editor) => setLayout((current) => replacePanel(current, id, editor))}
          onSplitDrag={beginSplitDrag}
          onResizeStart={() => setDragging(true)}
          onResizeEnd={() => setDragging(false)}
          onGutterSplit={(targetId, direction, after) => setLayout((current) => splitPanel(current, targetId, direction, after, splitEditorFor(activeWorkspace)))}
          splitDrag={splitDrag}
        />
        {splitDrag?.ghost && <div className="split-ghost" style={splitDrag.ghost} />}
        {splitDrag?.targetRect && splitDrag.targetId !== splitDrag.panelId && <div className={splitDrag.ctrlKey ? 'area-drop-overlay swap-preview' : 'area-drop-overlay'} style={splitDrag.targetRect} aria-hidden="true"><span>{splitDrag.ctrlKey ? '↔' : '←'}</span></div>}
      </section>

      <StatusBar />
      <Toasts />
    </main>
  )
}

function AccountMenu() {
  const { state, actions } = useStore()
  const user = useCurrentUser()
  const navigate = useNavigate()
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

  if (!user) return null
  const canSettings = state.settings.rolePermissions[user.role].includes('Settings')
  const shiftOpen = !state.shift.closedAt

  return <div className="account-menu-wrap" ref={menuRef}>
    <button className="account-context" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
      <span className="account-clock">{shiftOpen ? 'SHIFT OPEN' : 'SHIFT CLOSED'} <b>{time(state.shift.openedAt)}</b></span><span className="avatar">{initials(user.name)}</span><span className="account-person">{user.name.split(' ')[0]} {user.name.split(' ')[1]?.[0] ?? ''}.<small>{user.role.toUpperCase()}</small></span><span className="account-caret">⌄</span>
    </button>
    {open && <div className="account-dropdown" role="menu" aria-label="Account menu">
      <div className="account-menu-profile"><span className="avatar">{initials(user.name)}</span><div><b>{user.name}</b><small>{user.role.toUpperCase()} · {user.role === 'Owner' ? 'FULL ACCESS' : `${state.settings.rolePermissions[user.role].length} WORKSPACES`}</small></div></div>
      {canSettings && <button role="menuitem" onClick={() => { actions.navigate('Settings'); setOpen(false) }}><span>⚙</span> Store settings</button>}
      <button role="menuitem" onClick={() => { window.location.hash = '/cashier'; setOpen(false) }}><span>▦</span> Classic cashier menu</button>
      <button role="menuitem" onClick={() => { actions.logout(); navigate('/') }}><span>⎋</span> Switch user / sign out</button>
    </div>}
  </div>
}

function workspaceDescription(workspace: WorkspaceName) {
  const descriptions: Record<WorkspaceName, string> = {
    Dashboard: 'Store overview', 'Point of Sale': 'Checkout terminal', Transactions: 'Receipts, returns & cash drawer', Inventory: 'Stock control', Purchasing: 'AI replenishment & suppliers',
    'AI Insights': 'Forecasts, trends & recommendations', Reports: 'BIR readings, tax & operations', Waste: 'Loss tracking', Requests: 'Customer demand', Employees: 'Team access & shifts', Settings: 'Store configuration',
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
}

function LayoutView({ node, onLayoutChange, onEditorChange, onSplitDrag, onResizeStart, onResizeEnd, onGutterSplit, splitDrag }: LayoutViewProps) {
  if (node.type === 'panel') {
    const highlighted = splitDrag?.targetId === node.id && Math.hypot(splitDrag.x - splitDrag.startX, splitDrag.y - splitDrag.startY) > 12
    return (
      <article className={`workspace-area${highlighted ? ' split-target' : ''}`} data-area-id={node.id}>
        <AreaPanel node={node} onEditorChange={onEditorChange} onSplitDrag={onSplitDrag} />
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
      <LayoutView node={node.first} onLayoutChange={onLayoutChange} onEditorChange={onEditorChange} onSplitDrag={onSplitDrag} onResizeStart={onResizeStart} onResizeEnd={onResizeEnd} onGutterSplit={onGutterSplit} splitDrag={splitDrag} />
      <div className={`area-gutter ${node.direction}`} role="separator" aria-orientation={node.direction === 'horizontal' ? 'vertical' : 'horizontal'} onPointerDown={onGutterPointerDown}>
        <span className="gutter-grip" />
      </div>
      <LayoutView node={node.second} onLayoutChange={onLayoutChange} onEditorChange={onEditorChange} onSplitDrag={onSplitDrag} onResizeStart={onResizeStart} onResizeEnd={onResizeEnd} onGutterSplit={onGutterSplit} splitDrag={splitDrag} />
    </div>
  )
}

function AreaPanel({ node, onEditorChange, onSplitDrag }: {
  node: Extract<LayoutNode, { type: 'panel' }>
  onEditorChange: (id: string, editor: Editor) => void
  onSplitDrag: (event: PointerEvent<HTMLButtonElement>, id: string) => void
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
    <div className="area-content"><EditorContent editor={node.editor} /></div>
  </>
}

function EditorContent({ editor }: { editor: Editor }) {
  const Component = editors[editor]
  return <Component />
}

function StatusBar() {
  const { state } = useStore()
  const { insights } = useAnalytics()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const critical = insights.filter((i) => i.severity === 'critical').length
  return <footer className="status-bar">
    <span><i className="status-online" /> LOCAL MODE</span>
    <span>DEMO DATA <b>•</b> {state.transactions.length} RECEIPTS <b>•</b> AI MODEL {state.settings.forecastMethod}</span>
    {critical > 0 && <span className="status-alert">{critical} CRITICAL ALERT{critical > 1 ? 'S' : ''}</span>}
    <span className="status-right">{time(now)} <b>·</b> 9010 GROCERY <b>v1.1.0</b></span>
  </footer>
}

export default Workspace