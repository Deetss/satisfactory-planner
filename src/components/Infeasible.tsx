import { itemName, rateUnit } from '../data/gameData'
import type { PlanResult } from '../solver/interpret'
import { cleanRate } from '../solver/rates'
import { usePlannerStore } from '../state/plannerStore'
import { ItemIcon } from './Icon'
import { num } from '../format'


export function Infeasible({ result }: { result: PlanResult }) {
  const setResourceCap = usePlannerStore((s) => s.setResourceCap)
  const diagnosis = result.diagnosis

  if (!diagnosis) {
    return (
      <section className="section">
        <p className="bad">{result.message}</p>
      </section>
    )
  }

  return (
    <section className="section">
      <h2 className="section__title">Can't build that</h2>
      <p className="bad" style={{ marginTop: 0 }}>
        {diagnosis.message}
      </p>

      {diagnosis.shortfalls.length > 0 && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Resource</th>
                <th className="num">Needs</th>
                <th className="num">Limit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {diagnosis.shortfalls.map((s) => (
                <tr key={s.item}>
                  <td>
                    <span className="cell">
                      <ItemIcon item={s.item} size={16} />
                      {itemName(s.item)}
                    </span>
                  </td>
                  <td className="num warn">
                    {num(s.required)}
                    <span className="muted">{rateUnit(s.item)}</span>
                  </td>
                  <td className="num muted">
                    {Number.isFinite(s.limit) ? num(s.limit) : '∞'}
                    {s.mapLimited && <span className="muted"> (map)</span>}
                  </td>
                  <td>
                    {!s.mapLimited && (
                      <button
                        type="button"
                        className="btn btn--icon"
                        title={`Raise the limit to ${num(s.required)}`}
                        onClick={() =>
                          setResourceCap(s.item, cleanRate(s.required))
                        }
                      >
                        Raise
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {diagnosis.shortfalls.some((s) => s.mapLimited) && (
            <p className="muted" style={{ fontSize: 12 }}>
              Resources marked (map) are capped by every node on the map at full
              overclock. Lower the target rate or use alternate recipes that
              lean on something else.
            </p>
          )}
        </>
      )}
    </section>
  )
}
