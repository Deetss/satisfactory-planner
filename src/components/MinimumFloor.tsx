import { useEffect, useState } from 'react'
import { itemName, rateUnit } from '../data/gameData'
import type { PlanResult } from '../solver/interpret'
import { miningSummary, planMining } from '../solver/mining'
import { MIN_VIABLE_RATE, solveMinimumFloor } from '../solver/solve'
import { selectPlanRequest, usePlannerStore } from '../state/plannerStore'
import { ItemIcon } from './Icon'
import { num } from '../format'


/**
 * The smallest resource commitment that can produce any of every selected item.
 * Useful as a go/no-go check before committing to a full build.
 */
export function MinimumFloor() {
  const state = usePlannerStore()
  const tier = state.tier
  const [floor, setFloor] = useState<PlanResult | null>(null)
  const [open, setOpen] = useState(false)
  const [includePower, setIncludePower] = useState(true)

  const targetCount = Object.values(state.targets).filter((r) => r > 0).length
  const hasGenerators = state.powerGenerators.length > 0

  useEffect(() => {
    if (!open || targetCount === 0) return
    let live = true
    const request = selectPlanRequest(state)
    void solveMinimumFloor({
      ...request,
      // Excluding generators shows the floor for production alone, without the
      // fuel and cooling water that self-powering drags in.
      powerGeneration: includePower ? request.powerGeneration : null,
    }).then((result) => {
      if (live) setFloor(result)
    })
    return () => {
      live = false
    }
  }, [
    open,
    includePower,
    targetCount,
    state.targets,
    state.tier,
    state.unlockedAlternates,
    state.objective,
    state.allowSurplus,
    state.powerGenerators,
    state.resourceCaps,
  ])

  if (targetCount === 0) return null

  return (
    <section className="section">
      <h2 className="section__title">Minimum to even attempt</h2>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        What you need to produce all {targetCount} selected item
        {targetCount === 1 ? '' : 's'} at just {MIN_VIABLE_RATE}/min each. The
        floor before scaling up.
      </p>

      <button type="button" className="btn" onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Work out the floor'}
      </button>

      {open && hasGenerators && (
        <label className="toggle" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={includePower}
            onChange={(e) => setIncludePower(e.target.checked)}
          />
          <span>
            Include power generation
            <small>
              {includePower
                ? 'Coal and water below are partly for the generators that power this.'
                : 'Production only. Ignores fuel and cooling water.'}
            </small>
          </span>
        </label>
      )}

      {open && !floor && (
        <p className="muted" style={{ marginTop: 8 }}>
          Solving…
        </p>
      )}

      {open && floor && floor.status !== 'optimal' && (
        <p className="bad" style={{ marginTop: 8 }}>
          Even at {MIN_VIABLE_RATE}/min this isn't possible:{' '}
          {floor.message ?? 'no solution'}
        </p>
      )}

      {open && floor && floor.status === 'optimal' && (
        <>
          <div className="chips" style={{ margin: '8px 0' }}>
            <span className="chip">{floor.totals.machines} machines</span>
            <span className="chip">
              {num(floor.totals.powerConsumedUnderclocked)} MW
            </span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Resource</th>
                <th className="num">Minimum</th>
                <th>Needs</th>
              </tr>
            </thead>
            <tbody>
              {floor.extraction.map((e) => {
                const mining = planMining(e.item, e.rate, tier)
                return (
                  <tr key={e.item}>
                    <td>
                      <span className="cell">
                        <ItemIcon item={e.item} size={16} />
                        {itemName(e.item)}
                      </span>
                    </td>
                    <td className="num">
                      {num(e.rate)}
                      <span className="muted">{rateUnit(e.item)}</span>
                    </td>
                    <td className={mining?.blocked ? 'bad' : 'muted'}>
                      {mining ? miningSummary(mining) : 'not extracted'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
