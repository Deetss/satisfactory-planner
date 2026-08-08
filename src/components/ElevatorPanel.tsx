/**
 * What the Space Elevator wants, and how long this factory takes to make it.
 *
 * Elevator parts are the one thing in the game measured as a total rather than
 * a rate: a phase wants 500 Versatile Framework, not 500 a minute. So the
 * question a rate table can't answer is the only one worth asking here, which
 * is how long you have to leave the factory running, and how much depot you
 * need to hold what it makes in the meantime.
 */

import {
  ELEVATOR_PARTS,
  elevatorPhases,
  itemName,
  items,
} from '../data/gameData'
import { useLayoutStore } from '../layout/layoutStore'
import { planReserve } from '../layout/storage'
import type { PlanResult } from '../solver/interpret'
import { ItemIcon } from './Icon'
import { Panel } from './Panel'
import { num } from '../format'

interface Props {
  result: PlanResult
  tier: number
}

/** Minutes as something you can plan an evening around. */
function spell(minutes: number): string {
  if (!Number.isFinite(minutes)) return 'never at this rate'
  if (minutes < 1) return 'under a minute'
  if (minutes < 90) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 48) return `${num(hours, 1)} h`
  return `${num(hours / 24, 1)} days`
}

export function ElevatorPanel({ result, tier }: Props) {
  const reserves = useLayoutStore((s) => s.reserves)
  const setReserve = useLayoutStore((s) => s.setReserve)

  // What the plan makes of each part, net of anything consumed downstream. A
  // part fed into another recipe isn't going up the elevator.
  const rateOf = (item: string) => {
    const made = result.machineGroups.reduce(
      (sum, group) =>
        sum +
        (group.outputs.find((o) => o.item === item)?.rate ?? 0),
      0,
    )
    const used = result.machineGroups.reduce(
      (sum, group) =>
        sum +
        (group.inputs.find((i) => i.item === item)?.rate ?? 0),
      0,
    )
    return Math.max(0, made - used)
  }

  const making = ELEVATOR_PARTS.map((item) => ({
    item,
    rate: rateOf(item),
  })).filter((entry) => entry.rate > 1e-9)

  const phases = elevatorPhases()

  if (making.length === 0 && phases.length === 0) {
    return (
      <Panel title="Space Elevator" summary="nothing for it yet">
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Produce a Space Elevator part and this works out how long a delivery
          takes and how much depot it needs on the way.
        </p>
      </Panel>
    )
  }

  /** Containers a delivery needs while it accumulates, at this tier. */
  const depotFor = (item: string, units: number) =>
    planReserve(
      { item, mode: 'fixed', quantity: units, bufferMinutes: 0 },
      tier,
    )

  return (
    <Panel
      title="Space Elevator"
      summary={
        making.length === 0
          ? `${phases.length} phases`
          : `${making.length} part${making.length === 1 ? '' : 's'} in the plan`
      }
    >
      {making.length > 0 && (
        <table className="table">
          <tbody>
            {making.map(({ item, rate }) => (
              <tr key={item}>
                <td>
                  <span className="cell">
                    <ItemIcon item={item} size={16} />
                    {itemName(item)}
                  </span>
                </td>
                <td className="num">
                  {num(rate)}
                  <span className="muted">/min</span>
                </td>
                <td className="muted" title="How long 100 of them takes">
                  100 in {spell(100 / rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {phases.length === 0 ? (
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
          Phase requirements aren't in the extracted data. Re-run{' '}
          <code>node scripts/extract-game-data.mjs</code> against your game's
          docs to pull them in, and each phase gets its own delivery estimate.
        </p>
      ) : (
        phases.map((phase) => {
          const lines = phase.parts.map((part) => {
            const rate = rateOf(part.item)
            return {
              ...part,
              rate,
              minutes: rate > 0 ? part.amount / rate : Number.POSITIVE_INFINITY,
              depot: depotFor(part.item, part.amount),
            }
          })
          // The phase is done when its slowest part is, since they all have to
          // be delivered before it counts.
          const slowest = Math.max(...lines.map((l) => l.minutes))
          const containers = lines.reduce(
            (sum, l) => sum + l.depot.containers,
            0,
          )

          return (
            <div className="tangle" key={phase.schematic}>
              <span className="tangle__heading">
                {phase.name}
                <span className="muted"> · {spell(slowest)}</span>
              </span>
              <table className="table">
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.item}>
                      <td>
                        <span className="cell">
                          <ItemIcon item={line.item} size={16} />
                          {itemName(line.item)}
                        </span>
                      </td>
                      <td className="num">{num(line.amount)}</td>
                      <td className={line.rate > 0 ? 'muted' : 'tangle__bad'}>
                        {line.rate > 0 ? spell(line.minutes) : 'not produced'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--tiny"
                          title={`Plan depot space for ${num(
                            line.amount,
                          )} ${itemName(line.item)} while it builds up`}
                          onClick={() =>
                            setReserve(line.item, {
                              mode: 'fixed',
                              quantity: line.amount,
                              bufferMinutes: 0,
                            })
                          }
                        >
                          stock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
                {containers} container{containers === 1 ? '' : 's'} to hold the
                whole phase
                {reserves.some((r) =>
                  phase.parts.some((p) => p.item === r.item),
                ) && ', some already reserved'}
                . Stack size caps what one holds:{' '}
                {num(items[phase.parts[0].item]?.stackSize ?? 0)} a slot.
              </p>
            </div>
          )
        })
      )}
    </Panel>
  )
}
