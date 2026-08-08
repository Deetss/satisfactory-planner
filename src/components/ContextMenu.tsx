import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  /** Shown greyed to the right, for a shortcut or a note. */
  hint?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** A rule between groups of items. */
export type MenuEntry = MenuItem | 'separator'

export interface MenuAt {
  x: number
  y: number
  title: string
  entries: MenuEntry[]
}

/** Kept clear of the viewport edge, so a menu near a corner stays whole. */
const MARGIN = 8

/**
 * Right-click menu.
 *
 * Positioned in client coordinates and rendered fixed, so it doesn't care what
 * scrolls or transforms underneath it. It measures itself after mounting and
 * flips back over the pointer when it would otherwise run off the screen,
 * which is what the browser's own menu does.
 */
export function ContextMenu({
  at,
  onClose,
}: {
  at: MenuAt
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState({ left: at.x, top: at.y })

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setSpot({
      left:
        at.x + box.width > window.innerWidth - MARGIN
          ? Math.max(MARGIN, at.x - box.width)
          : at.x,
      top:
        at.y + box.height > window.innerHeight - MARGIN
          ? Math.max(MARGIN, at.y - box.height)
          : at.y,
    })
  }, [at])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // Capture, so the menu closes before whatever was clicked reacts to it.
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="menu"
      style={{ left: spot.left, top: spot.top }}
      role="menu"
      // The menu is its own thing: a click inside it isn't a click on the canvas.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="menu__title">{at.title}</div>
      {at.entries.map((entry, index) =>
        entry === 'separator' ? (
          <div className="menu__rule" key={`rule-${index}`} />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            className={`menu__item ${entry.danger ? 'menu__item--danger' : ''}`}
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect()
              onClose()
            }}
          >
            {entry.label}
            {entry.hint && <span className="menu__hint">{entry.hint}</span>}
          </button>
        ),
      )}
    </div>
  )
}
