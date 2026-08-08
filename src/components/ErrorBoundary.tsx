import { Component, type ErrorInfo, type ReactNode } from 'react'

/** The plan, layout and UI stores all key off this. */
const STORAGE_PREFIX = 'satisfactory-planner:'

function dropFragmentAndReload() {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  window.history.replaceState(null, '', `${pathname}${search}`)
  window.location.reload()
}

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches a throw during render so a bad link fails like a bad link instead of
 * blanking the app. The three ways out differ in how much they discard.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The stack goes here and not on screen: it tells a player nothing and
    // names build internals the fallback has no business showing.
    console.error(error, info.componentStack)
  }

  private retry = () => {
    this.setState({ error: null })
  }

  private clearSavedPlan = () => {
    if (typeof window === 'undefined') return

    const store = window.localStorage
    // Removing while walking the store shifts the indexes and skips entries.
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)

    dropFragmentAndReload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <section className="crash">
        <h1 className="crash__title">Something broke while drawing this plan</h1>
        <p className="crash__message">{error.message}</p>
        <div className="crash__actions">
          <button type="button" className="btn btn--primary" onClick={this.retry}>
            Try again
          </button>
          <button type="button" className="btn" onClick={dropFragmentAndReload}>
            Open without the link
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={this.clearSavedPlan}
          >
            Clear the saved plan
          </button>
        </div>
      </section>
    )
  }
}
