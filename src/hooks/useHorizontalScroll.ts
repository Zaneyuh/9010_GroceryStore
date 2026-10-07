import { useCallback, useRef, useState } from 'react'

/**
 * For a row that scrolls sideways (workspace tabs, category pills): a vertical mouse wheel scrolls it
 * horizontally, and it reports whether there is more content to the left/right so arrow buttons can show.
 * React's onWheel is passive, so the wheel listener is attached here to be allowed to preventDefault.
 */
export function useHorizontalScroll<T extends HTMLElement>() {
  const element = useRef<T | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })

  const attach = useCallback((el: T | null) => {
    cleanup.current?.()
    cleanup.current = null
    element.current = el
    if (!el) return

    const measure = () => {
      const left = el.scrollLeft > 1
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setOverflow((current) => (current.left === left && current.right === right ? current : { left, right }))
    }
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      el.scrollLeft += event.deltaY
    }
    // Watches the row and its items, so adding or resizing a tab also updates the arrows.
    const resize = new ResizeObserver(measure)
    resize.observe(el)
    const children = new MutationObserver(() => {
      resize.disconnect()
      resize.observe(el)
      for (const child of Array.from(el.children)) resize.observe(child)
      measure()
    })
    children.observe(el, { childList: true })
    for (const child of Array.from(el.children)) resize.observe(child)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', measure, { passive: true })
    measure()

    cleanup.current = () => {
      resize.disconnect()
      children.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', measure)
    }
  }, [])

  const scrollBy = useCallback((direction: -1 | 1) => {
    const el = element.current
    if (el) el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' })
  }, [])

  return { attach, element, overflow, scrollBy }
}
