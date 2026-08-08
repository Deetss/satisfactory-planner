import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Options {
  min?: number
  max?: number
  /** Called when a two-finger gesture starts, to abandon any drag in progress. */
  onPinchStart?: () => void
}

/**
 * Zoom for a scrolling canvas: buttons, wheel, and pinch.
 *
 * The point under the cursor or between the fingers stays put, which is what
 * makes zooming usable when the content is bigger than the viewport. That's
 * done by scrolling proportionally after the size changes, in pixels, so it
 * works whether the canvas maps metres to pixels one way or two.
 */
export function useCanvasZoom<Surface extends Element = HTMLDivElement>({
  min = 0.25,
  max = 4,
  onPinchStart,
}: Options = {}) {
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<Surface | null>(null)

  // The listeners read this instead of the state, so they never need zoom as a
  // dependency: re-subscribing mid-gesture would drop the pinch it was tracking.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  /** Where to re-anchor once the new size has been laid out. */
  const anchor = useRef<{
    fracX: number
    fracY: number
    width: number
    height: number
  } | null>(null)

  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, value)),
    [min, max],
  )

  const zoomAt = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const target = clamp(next)
      const surface = surfaceRef.current
      if (!surface || clientX === undefined || clientY === undefined) {
        setZoom(target)
        return
      }

      const rect = surface.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        anchor.current = {
          fracX: (clientX - rect.left) / rect.width,
          fracY: (clientY - rect.top) / rect.height,
          width: rect.width,
          height: rect.height,
        }
      }
      setZoom(target)
    },
    [clamp],
  )

  useLayoutEffect(() => {
    const pending = anchor.current
    const scroll = scrollRef.current
    const surface = surfaceRef.current
    if (!pending || !scroll || !surface) return
    anchor.current = null

    const rect = surface.getBoundingClientRect()
    scroll.scrollLeft += pending.fracX * (rect.width - pending.width)
    scroll.scrollTop += pending.fracY * (rect.height - pending.height)
  }, [zoom])

  // Held across renders so a pinch survives the re-render its own first move
  // triggers.
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)

  // Wheel and pinch are attached by hand because both need preventDefault, and
  // React registers those listeners as passive.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return

    const onWheel = (event: WheelEvent) => {
      // Shift-wheel is how you scroll sideways, so leave it alone.
      if (event.shiftKey) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.0015)
      zoomAt(zoomRef.current * factor, event.clientX, event.clientY)
    }

    const spread = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]]
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      // A finger already dragging a block would keep dragging through the
      // pinch, moving the block as well as the view.
      onPinchStart?.()
      pinch.current = {
        distance: spread(event.touches).distance,
        zoom: zoomRef.current,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const start = pinch.current
      if (event.touches.length !== 2 || !start || start.distance <= 0) return
      event.preventDefault()
      const { distance, x, y } = spread(event.touches)
      zoomAt(start.zoom * (distance / start.distance), x, y)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch.current = null
    }

    /**
     * Drag the background to pan, which is the only way to reach the rest of a
     * zoomed-in canvas with a mouse.
     *
     * Panning is opt-in, and only for the element pressed rather than any
     * ancestor of it. A draggable child calling stopPropagation cannot help
     * here: React listens at its root, which is an ancestor of this container,
     * so a tile's own handler runs after this one and the pan has already
     * started. Requiring the mark on the target itself means a new draggable
     * can never silently drag the view along with it.
     *
     * Touch is left to the browser: one finger already pans natively, and
     * competing with it makes the canvas feel like it's fighting back.
     */
    const pannable = (target: EventTarget | null) =>
      target === scroll ||
      (target instanceof Element && target.hasAttribute('data-pan'))

    let pan: { x: number; y: number; left: number; top: number } | null = null

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0) return
      if (!pannable(event.target)) return
      pan = {
        x: event.clientX,
        y: event.clientY,
        left: scroll.scrollLeft,
        top: scroll.scrollTop,
      }
      scroll.classList.add('is-panning')
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!pan) return
      scroll.scrollLeft = pan.left - (event.clientX - pan.x)
      scroll.scrollTop = pan.top - (event.clientY - pan.y)
    }

    const endPan = () => {
      pan = null
      scroll.classList.remove('is-panning')
    }

    scroll.addEventListener('wheel', onWheel, { passive: false })
    scroll.addEventListener('touchstart', onTouchStart, { passive: true })
    scroll.addEventListener('touchmove', onTouchMove, { passive: false })
    scroll.addEventListener('touchend', onTouchEnd)
    scroll.addEventListener('touchcancel', onTouchEnd)
    scroll.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endPan)
    window.addEventListener('pointercancel', endPan)

    return () => {
      scroll.removeEventListener('wheel', onWheel)
      scroll.removeEventListener('touchstart', onTouchStart)
      scroll.removeEventListener('touchmove', onTouchMove)
      scroll.removeEventListener('touchend', onTouchEnd)
      scroll.removeEventListener('touchcancel', onTouchEnd)
      scroll.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endPan)
      window.removeEventListener('pointercancel', endPan)
    }
  }, [zoomAt, onPinchStart])

  return {
    zoom,
    scrollRef,
    surfaceRef,
    /** Steps the zoom from the toolbar buttons, anchored on the view's centre. */
    step: (factor: number) => {
      const scroll = scrollRef.current
      if (!scroll) {
        setZoom(clamp(zoomRef.current * factor))
        return
      }
      const box = scroll.getBoundingClientRect()
      zoomAt(
        zoomRef.current * factor,
        box.left + box.width / 2,
        box.top + box.height / 2,
      )
    },
    zoomAt,
  }
}
