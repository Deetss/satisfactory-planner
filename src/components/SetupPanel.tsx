import { useMemo, useState } from 'react'
import {
  MAX_TIER,
  generators as allGenerators,
  itemName,
  rateUnit,
  recipes,
} from '../data/gameData'
import {
  resourceList,
  selectEnabledRecipes,
  selectPlanRequest,
  usePlannerStore,
} from '../state/plannerStore'
import type { Objective } from '../solver/model'
import { cleanRate } from '../solver/rates'
import {
  solveBalanced,
  solveEvenResourceSplit,
  solveMaxRate,
} from '../solver/solve'
import { Icon, ItemIcon } from './Icon'
import { ItemPicker } from './ItemPicker'
import { Panel } from './Panel'
import { Segmented } from './Segmented'
import { PlanFilePanel } from './PlanFilePanel'

const OBJECTIVE_CHOICES: {
  value: Objective
  label: string
  summary: string
  hint: string
}[] = [
  {
    value: 'resources',
    label: 'Ore',
    summary: 'least ore',
    hint: 'Use the least weighted raw resources',
  },
  {
    value: 'power',
    label: 'Power',
    summary: 'least power',
    hint: 'Draw the fewest MW',
  },
  {
    value: 'machines',
    label: 'Machines',
    summary: 'fewest machines',
    hint: 'Build the fewest machines',
  },
]

const alternates = Object.values(recipes)
  .filter((r) => r.isAlternate)
  .sort((a, b) => a.name.localeCompare(b.name))

interface Props {
  /** Resources the current plan actually draws on. */
  resourcesInUse: string[]
}

export function SetupPanel({ resourcesInUse }: Props) {
  const state = usePlannerStore()
  const [altQuery, setAltQuery] = useState('')
  const [maxing, setMaxing] = useState<string | null>(null)
  const [showAllResources, setShowAllResources] = useState(false)
  const [balancing, setBalancing] = useState(false)

  const hasCaps = Object.keys(state.resourceCaps).length > 0

  const enabledCount = useMemo(
    () => selectEnabledRecipes(state).size,
    [state.tier, state.unlockedAlternates],
  )

  const visibleAlternates = useMemo(() => {
    const q = altQuery.trim().toLowerCase()
    if (q === '') return alternates
    return alternates.filter((r) => r.name.toLowerCase().includes(q))
  }, [altQuery])

  const targetItems = Object.keys(state.targets)

  /** Sets a target to the most the current resource limits can sustain. */
  const applyMaxRate = async (item: string) => {
    setMaxing(item)
    try {
      const max = await solveMaxRate(
        selectPlanRequest(usePlannerStore.getState()),
        item,
      )
      if (max !== null) state.setTarget(item, Math.max(0, cleanRate(max)))
    } finally {
      setMaxing(null)
    }
  }

  /**
   * Scales every target together until the resource limits bind, so limited ore
   * is divided across the products instead of the first one eating it all.
   */
  const balanceTargets = async (mode: 'ratio' | 'evenOutput' | 'evenOre') => {
    setBalancing(true)
    try {
      const current = usePlannerStore.getState()
      const request = selectPlanRequest(current)
      const items = Object.keys(current.targets)

      const rates =
        mode === 'evenOre'
          ? await solveEvenResourceSplit(request, items)
          : await solveBalanced(
              request,
              Object.fromEntries(
                items.map((item) => [
                  item,
                  // Equal shares give equal output; the current rates keep the
                  // mix you already asked for.
                  mode === 'evenOutput' ? 1 : current.targets[item] || 1,
                ]),
              ),
            )

      if (rates) {
        for (const [item, rate] of Object.entries(rates)) {
          current.setTarget(item, Math.max(0, cleanRate(rate)))
        }
      }
    } finally {
      setBalancing(false)
    }
  }

  // Showing all 13 resources buries the handful a plan touches.
  const inUse = new Set(resourcesInUse)
  const shownResources = showAllResources
    ? resourceList
    : resourceList.filter((r) => inUse.has(r.item) || state.resourceCaps[r.item] !== undefined)

  return (
    <div>
      <Panel
        title="Produce"
        defaultOpen
        summary={targetItems.length > 0 ? `${targetItems.length} item${targetItems.length === 1 ? '' : 's'}` : 'nothing yet'}
      >
        <ItemPicker
          onPick={(item) => {
            state.setTarget(item, 60)
            // With limits set, the useful default is the most they can sustain.
            if (hasCaps) void applyMaxRate(item)
          }}
          exclude={targetItems}
        />

        {targetItems.length > 1 && (
          <div className="btngroup">
            <button
              type="button"
              className="btn"
              disabled={balancing}
              title="Scale every target together until your resource limits bind, keeping the ratio between them"
              onClick={() => void balanceTargets('ratio')}
            >
              {balancing ? '…' : 'Fit all to limits'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={balancing}
              title="Every item comes out at the same rate. Costlier items eat more of the ore."
              onClick={() => void balanceTargets('evenOutput')}
            >
              Even output
            </button>
            <button
              type="button"
              className="btn"
              disabled={balancing}
              title="Every item gets an equal share of each resource limit. Cheaper items come out faster."
              onClick={() => void balanceTargets('evenOre')}
            >
              Even resources
            </button>
          </div>
        )}

        {targetItems.map((item) => (
          <div className="produce" key={item}>
            <div className="produce__name">
              <ItemIcon item={item} />
              <span>{itemName(item)}</span>
            </div>
            <div className="produce__controls">
              <input
                className="input input--rate"
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                value={state.targets[item]}
                onChange={(e) =>
                  state.setTarget(item, Math.max(0, Number(e.target.value) || 0))
                }
              />
              <span className="muted unit">{rateUnit(item)}</span>
              <button
                type="button"
                className="btn"
                title="Set to the most your resource limits allow"
                disabled={maxing === item}
                onClick={() => void applyMaxRate(item)}
              >
                {maxing === item ? '…' : 'Max'}
              </button>
              <button
                type="button"
                className="btn btn--icon btn--danger"
                aria-label={`Remove ${itemName(item)}`}
                onClick={() => state.removeTarget(item)}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </Panel>

      <Panel
        title="Optimize for"
        defaultOpen
        summary={
          OBJECTIVE_CHOICES.find((o) => o.value === state.objective)?.summary
        }
      >
        <Segmented
          label="What the solver should minimize"
          value={state.objective}
          onChange={state.setObjective}
          options={OBJECTIVE_CHOICES.map((o) => ({
            value: o.value,
            label: o.label,
            title: o.hint,
          }))}
        />

        <label className="toggle">
          <input
            type="checkbox"
            checked={!state.allowSurplus}
            onChange={(e) => state.setAllowSurplus(!e.target.checked)}
          />
          <span>
            Force byproducts to be consumed
            <small>No leftovers except water. Harder to satisfy.</small>
          </span>
        </label>
      </Panel>

      <Panel title="Unlocked tech" summary={`Tier ${state.tier} · ${enabledCount} recipes`}>
        <div className="row">
          <input
            type="range"
            min={0}
            max={MAX_TIER}
            value={state.tier}
            onChange={(e) => state.setTier(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span className="muted" style={{ flex: 'none', width: 48, textAlign: 'right' }}>
            T{state.tier}
          </span>
        </div>
        <p className="muted panel__note">
          Gates recipes, machines, miners, belts and containers.
        </p>
      </Panel>

      <Panel
        title="Alternate recipes"
        summary={`${state.unlockedAlternates.length} of ${alternates.length}`}
      >
        <div className="btngroup">
          <button
            type="button"
            className="btn"
            onClick={() => state.setAlternates(alternates.map((r) => r.className))}
          >
            All
          </button>
          <button type="button" className="btn" onClick={() => state.setAlternates([])}>
            None
          </button>
        </div>
        <input
          type="search"
          className="input"
          placeholder="Filter alternates…"
          value={altQuery}
          onChange={(e) => setAltQuery(e.target.value)}
          autoComplete="off"
          style={{ marginTop: 8 }}
        />
        <div className="checklist">
          {visibleAlternates.map((r) => (
            <label className="checklist__item" key={r.className}>
              <input
                type="checkbox"
                checked={state.unlockedAlternates.includes(r.className)}
                onChange={() => state.toggleAlternate(r.className)}
              />
              <ItemIcon item={r.products[0]?.item ?? ''} size={16} />
              <span className="row__grow">{r.name.replace(/^Alternate: /, '')}</span>
            </label>
          ))}
        </div>
      </Panel>

      <Panel
        title="Power generation"
        summary={
          state.powerGenerators.length === 0
            ? 'from the grid'
            : `${state.powerGenerators.length} selected`
        }
      >
        <p className="muted panel__note">
          Pick generators to make the plan power itself. Their fuel and cooling
          water fold into the same solve.
        </p>
        {Object.values(allGenerators).map((g) => (
          <label className="toggle" key={g.className}>
            <input
              type="checkbox"
              checked={state.powerGenerators.includes(g.className)}
              onChange={() => state.togglePowerGenerator(g.className)}
            />
            <Icon icon={g.icon} name={g.name} size={18} />
            <span>
              {g.name}
              <small>{g.power} MW each</small>
            </span>
          </label>
        ))}
      </Panel>

      <Panel
        title="Resource limits"
        summary={hasCaps ? `${Object.keys(state.resourceCaps).length} capped` : 'whole map'}
      >
        <p className="muted panel__note">
          Blank means every node on the map. Set a limit to plan around the
          nodes you actually have.
        </p>
        {shownResources.map((r) => (
          <div className="row" key={r.item}>
            <span className="row__grow">{r.name}</span>
            <input
              className="input input--rate"
              type="number"
              inputMode="decimal"
              min={0}
              placeholder={r.maxExtraction === null ? '∞' : String(r.maxExtraction)}
              value={state.resourceCaps[r.item] ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                state.setResourceCap(r.item, raw === '' ? null : Number(raw))
              }}
            />
            <span className="muted unit">{rateUnit(r.item)}</span>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          style={{ marginTop: 8 }}
          onClick={() => setShowAllResources(!showAllResources)}
        >
          {showAllResources
            ? 'Show only what this plan uses'
            : `Show all ${resourceList.length} resources`}
        </button>
      </Panel>

      <PlanFilePanel />

      <div className="panel__footer">
        <button type="button" className="btn" onClick={state.reset}>
          Reset everything
        </button>
      </div>
    </div>
  )
}
