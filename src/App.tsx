import { Breakdown } from './components/Breakdown'
import { FactoryGraph } from './components/FactoryGraph'
import { LayoutPanel } from './components/LayoutPanel'
import { SetupPanel } from './components/SetupPanel'
import { mw } from './format'
import { usePlan } from './hooks/usePlan'
import { useIsDesktop } from './hooks/useMediaQuery'
import { usePlannerStore } from './state/plannerStore'
import { useShareStatus } from './state/shareLink'
import { useUiStore, type Tab as View } from './state/uiStore'

const TABS: { id: View; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'graph', label: 'Graph' },
  { id: 'layout', label: 'Layout' },
  { id: 'breakdown', label: 'Breakdown' },
]


export function App() {
  // Kept in a store rather than component state so a reload, or anything that
  // remounts the app, comes back to the tab you were on.
  const view = useUiStore((s) => s.tab)
  const setView = useUiStore((s) => s.setTab)
  const isDesktop = useIsDesktop()
  const targets = usePlannerStore((s) => s.targets)
  const shared = useShareStatus((s) => s.notice)
  const dismissShared = useShareStatus((s) => s.clear)
  const { result, solving } = usePlan()

  // On desktop the setup panel is always visible, so "setup" isn't a main
  // view; fall back to the graph rather than showing an empty pane.
  const mainView: View = isDesktop && view === 'setup' ? 'graph' : view

  const powerShortfall =
    result.totals.powerProduced > 0 &&
    result.totals.powerProduced < result.totals.powerConsumed - 1e-6

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">Factory Planner</span>
        <div className="chips">
          {solving && <span className="chip">solving…</span>}
          {result.status === 'infeasible' && (
            <span className="chip chip--bad">{result.message}</span>
          )}
          {result.status === 'error' && (
            <span className="chip chip--bad">Error: {result.message}</span>
          )}
          {result.status === 'optimal' && result.machineGroups.length > 0 && (
            <>
              <span className="chip">{result.totals.machines} machines</span>
              <span className="chip">
                {mw(result.totals.powerConsumedUnderclocked)} draw
              </span>
              {result.totals.powerProduced > 0 && (
                <span className={`chip ${powerShortfall ? 'chip--bad' : ''}`}>
                  {mw(result.totals.powerProduced)} generated
                </span>
              )}
              {result.surplus.length > 0 && (
                <span className="chip chip--warn">
                  {result.surplus.length} surplus
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {shared && (
        <div className={`banner ${shared.ok ? '' : 'banner--bad'}`}>
          <span>{shared.message}</span>
          <button
            type="button"
            className="banner__close"
            onClick={dismissShared}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="app__body">
        <div
          className={`app__panel app__panel--setup ${
            view === 'setup' ? 'app__panel--active' : ''
          }`}
        >
          <SetupPanel
            resourcesInUse={result.extraction.map((e) => e.item)}
          />
        </div>

        {/* Only the visible panel is mounted: React Flow measures its
            container on mount, and a hidden one has no size, which leaves the
            graph fitted to nothing. */}
        {mainView === 'graph' && (
          <div className="app__panel app__panel--graph app__panel--active">
            <FactoryGraph result={result} targets={targets} />
          </div>
        )}

        {mainView === 'layout' && (
          <div className="app__panel app__panel--layout app__panel--active">
            <LayoutPanel result={result} />
          </div>
        )}

        {mainView === 'breakdown' && (
          <div className="app__panel app__panel--breakdown app__panel--active">
            <Breakdown result={result} />
          </div>
        )}
      </div>

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tabs__tab tabs__tab--${tab.id} ${
              view === tab.id ? 'tabs__tab--active' : ''
            }`}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
