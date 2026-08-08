import { itemName, rateUnit } from '../data/gameData'
import type { PlanResult } from '../solver/interpret'
import { buildings, generators as allGenerators } from '../data/gameData'
import { miningSummary, planMining } from '../solver/mining'
import { usePlannerStore } from '../state/plannerStore'
import { Icon, ItemIcon } from './Icon'
import { Infeasible } from './Infeasible'
import { MinimumFloor } from './MinimumFloor'

const n = (v: number, digits = 1) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })

export function Breakdown({ result }: { result: PlanResult }) {
  const tier = usePlannerStore((s) => s.tier)
  const setMachineCount = usePlannerStore((s) => s.setMachineCount)
  const overrides = usePlannerStore((s) => s.machineOverrides)

  if (result.status === 'infeasible') return <Infeasible result={result} />

  if (result.status !== 'optimal') {
    return (
      <div className="section">
        <p className="bad">{result.message ?? 'No plan.'}</p>
      </div>
    )
  }

  if (result.machineGroups.length === 0) {
    return (
      <div className="section">
        <p className="muted">Nothing to build yet.</p>
      </div>
    )
  }

  return (
    <div>
      <section className="section">
        <h2 className="section__title">Machines</h2>
        {result.machineGroups.some((g) => !g.clockValid) && (
          <p className="bad" style={{ margin: '0 0 8px', fontSize: 12 }}>
            Some rows have too few machines to hit the target even at 250%.
            Raise those counts or fit power shards.
          </p>
        )}
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
          Edit a machine count to see the clock it needs. Fewer means
          overclocking (and shards); more means underclocking, which saves power.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Recipe</th>
              <th>Building</th>
              <th className="num">Machines</th>
              <th className="num">Clock</th>
              <th className="num">Shards</th>
              <th className="num">MW</th>
            </tr>
          </thead>
          <tbody>
            {result.machineGroups.map((g) => (
              <tr key={g.recipe}>
                <td>
                  <span className="cell">
                    <ItemIcon item={g.outputs[0]?.item ?? ''} size={18} />
                    {g.recipeName}
                  </span>
                </td>
                <td className="muted">
                  <span className="cell">
                    <Icon
                      icon={buildings[g.building]?.icon}
                      name={g.buildingName}
                      size={18}
                    />
                    {g.buildingName}
                  </span>
                </td>
                <td className="num">
                  <input
                    className="input input--count"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={g.wholeMachines}
                    title={`${n(g.machines, 3)} machines' worth of throughput`}
                    onChange={(e) => {
                      const raw = Number(e.target.value)
                      setMachineCount(
                        g.recipe,
                        Number.isFinite(raw) && raw >= 1 ? raw : null,
                      )
                    }}
                  />
                  {overrides[g.recipe] !== undefined && (
                    <button
                      type="button"
                      className="btn btn--reset"
                      title="Back to the fewest machines that fit"
                      onClick={() => setMachineCount(g.recipe, null)}
                    >
                      ↺
                    </button>
                  )}
                </td>
                <td
                  className={`num ${
                    !g.clockValid ? 'bad' : g.clock > 1 ? 'warn' : ''
                  }`}
                  title={
                    !g.clockValid
                      ? `Needs ${n(g.machines, 3)} machines' worth; ${g.wholeMachines} can't reach it even at 250%`
                      : g.clock > 1
                        ? 'Overclocked'
                        : 'Underclocked'
                  }
                >
                  {n(g.clock * 100)}%
                </td>
                <td className={`num ${g.clockValid ? 'muted' : 'bad'}`}>
                  {!g.clockValid
                    ? 'over max'
                    : g.shardsEach > 0
                      ? `${g.shardsEach} ea`
                      : 'none'}
                </td>
                <td className="num">{n(g.powerAtClock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {result.generatorGroups.length > 0 && (
        <section className="section">
          <h2 className="section__title">Power generation</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Generator</th>
                <th>Fuel</th>
                <th className="num">Count</th>
                <th className="num">Fuel rate</th>
                <th className="num">MW</th>
              </tr>
            </thead>
            <tbody>
              {result.generatorGroups.map((g) => (
                <tr key={`${g.generator}:${g.fuel}`}>
                  <td>
                    <span className="cell">
                      <Icon
                        icon={allGenerators[g.generator]?.icon}
                        name={g.generatorName}
                        size={18}
                      />
                      {g.generatorName}
                    </span>
                  </td>
                  <td className="muted">
                    <span className="cell">
                      <ItemIcon item={g.fuel} size={16} />
                      {itemName(g.fuel)}
                    </span>
                  </td>
                  <td className="num">{g.wholeCount}</td>
                  <td className="num">
                    {n(g.fuelRate)}
                    <span className="muted">{rateUnit(g.fuel)}</span>
                  </td>
                  <td className="num">{n(g.power)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">Raw resources</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Resource</th>
              <th className="num">Rate</th>
              <th className="num">Of limit</th>
              <th>Extract with</th>
            </tr>
          </thead>
          <tbody>
            {result.extraction.map((e) => {
              const pct = e.cap ? (e.rate / e.cap) * 100 : null
              const mining = planMining(e.item, e.rate, tier)
              return (
                <tr key={e.item}>
                  <td>
                    <span className="cell">
                      <ItemIcon item={e.item} size={18} />
                      {itemName(e.item)}
                    </span>
                  </td>
                  <td className="num">
                    {n(e.rate)}
                    <span className="muted">{rateUnit(e.item)}</span>
                  </td>
                  <td className={`num ${pct !== null && pct > 90 ? 'warn' : 'muted'}`}>
                    {pct === null ? 'no cap' : `${n(pct)}%`}
                  </td>
                  <td className={mining?.blocked ? 'bad' : 'muted'} style={{ fontSize: 12 }}>
                    {mining ? miningSummary(mining) : 'not extracted'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <MinimumFloor />

      {result.surplus.length > 0 && (
        <section className="section">
          <h2 className="section__title">Surplus to deal with</h2>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            These back up unless you sink, store or vent them.
          </p>
          <table className="table">
            <tbody>
              {result.surplus.map((s) => (
                <tr key={s.item}>
                  <td>
                    <span className="cell">
                      <ItemIcon item={s.item} size={18} />
                      {itemName(s.item)}
                    </span>
                  </td>
                  <td className="num">
                    {n(s.rate)}
                    <span className="muted">{rateUnit(s.item)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">Buildings needed</h2>
        <table className="table">
          <tbody>
            {Object.entries(result.totals.buildingCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([className, count]) => {
                const building = buildings[className] ?? allGenerators[className]
                const name = building?.name ?? className
                return (
                  <tr key={className}>
                    <td>
                      <span className="cell">
                        <Icon icon={building?.icon} name={name} size={18} />
                        {name}
                      </span>
                    </td>
                    <td className="num">{count}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </section>
    </div>
  )
}
