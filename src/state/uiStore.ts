/**
 * Where you were: the tab, the view of the layout, and what the canvas shows.
 *
 * Deliberately separate from the plan. None of this describes a factory, so it
 * has no business travelling in a shared link: opening someone else's plan
 * shouldn't move you to their tab. It does belong in this browser though, since
 * being thrown back to Setup on every reload loses your place in the middle of
 * whatever you were arranging.
 */

import { create } from 'zustand'
import type { ArrangeMode, Growth } from '../layout/bus'

const STORAGE_KEY = 'satisfactory-planner:ui:v1'

export type Tab = 'setup' | 'graph' | 'layout' | 'breakdown'

/** Plan view or elevation. */
export type LayoutView = 'top' | 'side'

/** How much of the belt and pipe network the canvas draws. */
export type RouteVisibility = 'off' | 'selected' | 'all'

interface Persisted {
  tab: Tab
  layoutView: LayoutView
  routeView: RouteVisibility
  showTangles: boolean
  /** Clear ground arranging keeps around each block, in metres. */
  lane: number
  arrangeMode: ArrangeMode
  growth: Growth
  /** Whether the layout controls are open. Only applies on a narrow screen. */
  sideOpen: boolean
}

interface UiState extends Persisted {
  setTab: (tab: Tab) => void
  setLayoutView: (view: LayoutView) => void
  setRouteView: (view: RouteVisibility) => void
  setShowTangles: (on: boolean) => void
  setLane: (metres: number) => void
  setArrangeMode: (mode: ArrangeMode) => void
  setGrowth: (growth: Growth) => void
  setSideOpen: (open: boolean) => void
}

const DEFAULTS: Persisted = {
  tab: 'setup',
  layoutView: 'top',
  routeView: 'selected',
  showTangles: true,
  // One foundation: room for a belt or a pipe on any face.
  lane: 8,
  // Flow columns beat the bus corridor on belt length and crossings for most
  // plans, so they are what you get without choosing anything.
  arrangeMode: 'compact',
  growth: 'east',
  // Closed, so a phone opens on as much floor as the screen will give. A wide
  // screen shows the controls regardless and never reads this.
  sideOpen: false,
}

const TABS: Tab[] = ['setup', 'graph', 'layout', 'breakdown']
const LAYOUT_VIEWS: LayoutView[] = ['top', 'side']
const ROUTE_VIEWS: RouteVisibility[] = ['off', 'selected', 'all']
const ARRANGE_MODES: ArrangeMode[] = ['compact', 'bus']
const GROWTHS: Growth[] = ['east', 'south']

/**
 * Anything stored that this build no longer recognises falls back to the
 * default, so a renamed tab can't leave the app on a view that doesn't exist.
 */
function readStorage(): Persisted {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULTS
    const p = JSON.parse(stored) as Partial<Persisted>
    const pick = <T,>(allowed: T[], value: unknown, fallback: T): T =>
      allowed.includes(value as T) ? (value as T) : fallback
    return {
      tab: pick(TABS, p.tab, DEFAULTS.tab),
      layoutView: pick(LAYOUT_VIEWS, p.layoutView, DEFAULTS.layoutView),
      routeView: pick(ROUTE_VIEWS, p.routeView, DEFAULTS.routeView),
      showTangles:
        typeof p.showTangles === 'boolean' ? p.showTangles : DEFAULTS.showTangles,
      lane:
        typeof p.lane === 'number' && p.lane >= 0 && p.lane <= 64
          ? p.lane
          : DEFAULTS.lane,
      arrangeMode: pick(ARRANGE_MODES, p.arrangeMode, DEFAULTS.arrangeMode),
      growth: pick(GROWTHS, p.growth, DEFAULTS.growth),
      sideOpen: typeof p.sideOpen === 'boolean' ? p.sideOpen : DEFAULTS.sideOpen,
    }
  } catch {
    return DEFAULTS
  }
}

export const useUiStore = create<UiState>((set, get) => {
  const commit = (patch: Partial<Persisted>) => {
    set(patch as Partial<UiState>)
    if (typeof window === 'undefined') return
    const s = get()
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          tab: s.tab,
          layoutView: s.layoutView,
          routeView: s.routeView,
          showTangles: s.showTangles,
          lane: s.lane,
          arrangeMode: s.arrangeMode,
          growth: s.growth,
          sideOpen: s.sideOpen,
        }),
      )
    } catch {
      // A full or blocked storage quota shouldn't cost you the app.
    }
  }

  return {
    ...readStorage(),
    setTab: (tab) => commit({ tab }),
    setLayoutView: (layoutView) => commit({ layoutView }),
    setRouteView: (routeView) => commit({ routeView }),
    setShowTangles: (showTangles) => commit({ showTangles }),
    setLane: (lane) => commit({ lane }),
    setArrangeMode: (arrangeMode) => commit({ arrangeMode }),
    setGrowth: (growth) => commit({ growth }),
    setSideOpen: (sideOpen) => commit({ sideOpen }),
  }
})
