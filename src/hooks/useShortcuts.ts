import { useEffect } from 'react'
import { useLayoutStore } from '../layout/layoutStore'
import { applyPlanFile, buildPlanFile } from '../state/planFile'

interface Options {
  /** Blocks the keyboard acts on. */
  selection: string[]
  onDeselect: () => void
  /** Told what happened, so the UI can say so. */
  onNotice: (message: string) => void
}

/** Nudge distance when no snap step is set, in metres. */
const FREE_NUDGE_M = 1

const isTyping = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * Editing keys for the layout: undo, redo, clipboard, nudge, unplace.
 *
 * Copy and paste work on the whole plan rather than a single block. A block
 * isn't a free-standing object here: there's exactly one per recipe in the
 * solve, so pasting a second Iron Plate block would describe a factory the
 * solver never produced. Copying the plan is the operation that means something,
 * and it's the one that makes a layout shareable.
 */
export function useShortcuts({ selection, onDeselect, onNotice }: Options) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a key from a field the user is typing in.
      if (isTyping(event.target)) return

      const store = useLayoutStore.getState()
      const meta = event.ctrlKey || event.metaKey

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          store.redo()
          onNotice('Redone')
        } else {
          store.undo()
          onNotice('Undone')
        }
        return
      }

      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        store.redo()
        onNotice('Redone')
        return
      }

      if (meta && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        const file = buildPlanFile(new Date().toISOString())
        void navigator.clipboard
          .writeText(JSON.stringify(file, null, 2))
          .then(() => onNotice('Plan and layout copied'))
          .catch(() => onNotice('Copy blocked by the browser'))
        return
      }

      if (meta && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void navigator.clipboard
          .readText()
          .then((text) => {
            const report = applyPlanFile(text)
            onNotice(`Pasted ${report.name}`)
          })
          .catch((cause: unknown) => {
            onNotice(
              cause instanceof Error
                ? cause.message
                : "Nothing pasteable on the clipboard",
            )
          })
        return
      }

      if (selection.length === 0) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        store.removeMany(selection)
        onDeselect()
        onNotice(
          selection.length === 1 ? 'Unplaced' : `Unplaced ${selection.length}`,
        )
        return
      }

      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        store.rotateMany(selection)
        return
      }

      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        store.flipMany(selection)
        onNotice('Flipped')
        return
      }

      const step = store.snapMetres > 0 ? store.snapMetres : FREE_NUDGE_M
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const nudge = nudges[event.key]
      if (nudge) {
        event.preventDefault()
        store.nudge(selection, nudge[0], nudge[1])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selection, onDeselect, onNotice])
}
