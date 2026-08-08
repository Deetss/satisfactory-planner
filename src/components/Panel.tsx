import type { ReactNode } from 'react'

interface Props {
  title: string
  /** Shown in the header so a collapsed panel still tells you its state. */
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * Collapsible section built on details/summary, so keyboard and screen-reader
 * behaviour comes for free and no state has to be threaded through.
 */
export function Panel({ title, summary, defaultOpen = false, children }: Props) {
  return (
    <details className="panel" open={defaultOpen}>
      <summary className="panel__head">
        <span className="panel__title">{title}</span>
        {summary !== undefined && <span className="panel__summary">{summary}</span>}
      </summary>
      <div className="panel__body">{children}</div>
    </details>
  )
}
