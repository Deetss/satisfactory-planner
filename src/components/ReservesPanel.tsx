import { itemName, rateUnit } from '../data/gameData'
import { useLayoutStore } from '../layout/layoutStore'
import { planReserve, type Reserve } from '../layout/storage'
import type { PlanResult } from '../solver/interpret'
import { ItemPicker } from './ItemPicker'
import { ItemIcon } from './Icon'
import { Panel } from './Panel'
import { num } from '../format'


interface Props {
  result: PlanResult
  tier: number
}

export function ReservesPanel({ result, tier }: Props) {
  const reserves = useLayoutStore((s) => s.reserves)
  const setReserve = useLayoutStore((s) => s.setReserve)
  const removeReserve = useLayoutStore((s) => s.removeReserve)

  const surplusByItem: Record<string, number> = {}
  for (const s of result.surplus) surplusByItem[s.item] = s.rate

  const unbuffered = result.surplus.filter(
    (s) => !reserves.some((r) => r.item === s.item),
  )

  const plans = reserves.map((reserve) =>
    planReserve(reserve, tier, surplusByItem[reserve.item] ?? 0),
  )
  const totalContainers = plans.reduce((sum, p) => sum + p.containers, 0)
  const totalArea = plans.reduce(
    (sum, p) => sum + p.containers * p.footprint.width * p.footprint.depth,
    0,
  )

  return (
    <Panel
      title="Reserves"
      summary={
        reserves.length === 0
          ? unbuffered.length > 0
            ? `${unbuffered.length} surplus unbuffered`
            : 'none'
          : `${totalContainers} container${
              totalContainers === 1 ? '' : 's'
            }, ${num(totalArea)} m²`
      }
    >
      <ItemPicker
        placeholder="Add an item to stockpile…"
        onPick={(item) =>
          setReserve(item, {
            // Surplus items default to buffering that surplus; anything else
            // is a deliberate stockpile for building.
            mode: surplusByItem[item] ? 'excess' : 'fixed',
            quantity: surplusByItem[item] ? 0 : 1000,
          })
        }
        exclude={reserves.map((r) => r.item)}
      />

      {unbuffered.length > 0 && (
        <button
          type="button"
          className="btn"
          style={{ marginTop: 8 }}
          onClick={() => {
            for (const s of unbuffered) setReserve(s.item, { mode: 'excess' })
          }}
        >
          Buffer all {unbuffered.length} surplus item
          {unbuffered.length === 1 ? '' : 's'}
        </button>
      )}

      {/* The totals live in the panel heading now, where they're readable with
          this open or shut. */}
      {plans.map((plan) => {
        const reserve: Reserve = plan.reserve
        const surplus = surplusByItem[reserve.item] ?? 0
        return (
          <div
            key={reserve.item}
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 8,
              marginTop: 8,
            }}
          >
            <div className="row">
              <span className="row__grow">
                <ItemIcon item={reserve.item} size={16} />
                {itemName(reserve.item)}
              </span>
              <button
                type="button"
                className="btn btn--icon btn--danger"
                aria-label={`Remove ${itemName(reserve.item)} reserve`}
                onClick={() => removeReserve(reserve.item)}
              >
                ✕
              </button>
            </div>

            <div className="btngroup" style={{ marginTop: 6 }}>
              <button
                type="button"
                className={`btn ${reserve.mode === 'fixed' ? 'btn--active' : ''}`}
                onClick={() => setReserve(reserve.item, { mode: 'fixed' })}
              >
                Fixed amount
              </button>
              <button
                type="button"
                className={`btn ${reserve.mode === 'excess' ? 'btn--active' : ''}`}
                title="Size the buffer from what this plan overproduces"
                onClick={() => setReserve(reserve.item, { mode: 'excess' })}
              >
                Excess only
              </button>
            </div>

            {reserve.mode === 'fixed' ? (
              <div className="row" style={{ marginTop: 6 }}>
                <span className="row__grow muted">Hold</span>
                <input
                  className="input input--rate"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  value={reserve.quantity}
                  onChange={(e) =>
                    setReserve(reserve.item, {
                      quantity: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            ) : (
              <div className="row" style={{ marginTop: 6 }}>
                <span className="row__grow muted">Minutes of surplus</span>
                <input
                  className="input input--rate"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={15}
                  value={reserve.bufferMinutes}
                  onChange={(e) =>
                    setReserve(reserve.item, {
                      bufferMinutes: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            )}

            <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
              {reserve.mode === 'excess' && surplus <= 0 ? (
                <span className="warn">
                  This plan has no surplus of {itemName(reserve.item)}, so
                  nothing would accumulate.
                </span>
              ) : plan.blocked ? (
                <span className="bad">{plan.blocked}</span>
              ) : (
                <>
                  {reserve.mode === 'excess' && (
                    <>
                      {num(surplus)}
                      {rateUnit(reserve.item)} surplus →{' '}
                    </>
                  )}
                  Hold {num(plan.target)} → <strong>{plan.containers}x</strong>{' '}
                  {plan.containerName} ({num(plan.perContainer)} each,{' '}
                  {num(plan.actualCapacity)} total)
                </>
              )}
            </p>
          </div>
        )
      })}

      {reserves.length === 0 && (
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
          Add items to plan depot space. Reserves become blocks you can place on
          any floor.
        </p>
      )}
    </Panel>
  )
}
