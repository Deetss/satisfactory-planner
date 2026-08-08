import { itemName, rateUnit } from '../data/gameData'
import type { Advice, Fix } from '../layout/advice'
import {
  linkKey,
  type FloorCongestion,
  type FloorLink,
  type ShaftClash,
} from '../layout/congestion'
import type { Floor } from '../layout/types'
import { ItemIcon } from './Icon'
import { Panel } from './Panel'
import { num } from '../format'

interface Props {
  /** One entry per floor, worst first. */
  floors: FloorCongestion[]
  links: FloorLink[]
  /** Lifts fouled by a machine or by another lift. */
  shaftClashes: ShaftClash[]
  allFloors: Floor[]
  activeFloorId: string
  onPickFloor: (floorId: string) => void
  /** Keys of the links the player will carry by hand. */
  manual: ReadonlySet<string>
  onToggleManual: (key: string) => void
  /** Ways to organise the stack better, best first. */
  advice: Advice[]
  onApplyFix: (fix: Fix) => void
  onClearAllLifts: () => void
}

/** Why each suggestion is being made, in the words the panel uses for it. */
const WHY: Record<Advice['kind'], string> = {
  floor: 'Wrong floor',
  skip: 'Skips a floor',
  blocked: 'Lift is blocked',
  landing: 'Lift lands away from what it feeds',
  tangle: 'Belts crossing',
}


export function TanglePanel({
  floors,
  links,
  shaftClashes,
  allFloors,
  activeFloorId,
  onPickFloor,
  manual,
  onToggleManual,
  advice,
  onApplyFix,
  onClearAllLifts,
}: Props) {
  const total =
    floors.reduce((sum, f) => sum + f.score, 0) + shaftClashes.length * 3
  const floorName = (id: string) =>
    allFloors.find((f) => f.id === id)?.name ?? id

  return (
    <Panel
      title="Tangles"
      // Open only when there's something wrong, since a clean stack has nothing
      // to say and this is the longest panel on the page.
      defaultOpen={total > 0}
      summary={
        total === 0
          ? links.length === 0
            ? 'clean'
            : `clean · ${links.length} lift${links.length === 1 ? '' : 's'}`
          : `${total} to sort out`
      }
    >
      {total === 0 && links.length === 0 && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          No runs cross, share a lane, or pass over a block, and nothing moves
          between floors.
        </p>
      )}

      {/* One list of problems, worst first, each carrying the change that
          clears it. Splitting them into "what's wrong" and "what to do" meant
          reading the same tangle twice in two different vocabularies. */}
      {advice.length > 0 && (
        <div className="fixes">
          {advice.length > 1 && (
            <div className="row">
              <span className="row__grow fixes__title">
                {advice.length} to sort out
              </span>
              <button
                type="button"
                className="btn btn--tiny"
                onClick={onClearAllLifts}
                title="Take the first suggestion for each, in one step you can undo"
              >
                Fix them all
              </button>
            </div>
          )}

          {advice.slice(0, 8).map((entry) => (
            <div className="fixes__item" key={entry.id}>
              <span className="fixes__what">
                <span className={`fixes__kind fixes__kind--${entry.kind}`}>
                  {WHY[entry.kind]}
                  {entry.floorId && entry.floorId !== activeFloorId && (
                    <button
                      type="button"
                      className="fixes__where"
                      onClick={() => onPickFloor(entry.floorId as string)}
                      title="Go to this floor"
                    >
                      {floorName(entry.floorId)}
                    </button>
                  )}
                </span>
                {entry.what}
              </span>
              <div className="btngroup">
                {entry.fixes.map((fix) => (
                  <button
                    key={fix.kind + fix.label}
                    type="button"
                    className="btn btn--tiny"
                    onClick={() => onApplyFix(fix)}
                  >
                    {fix.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {advice.length > 8 && (
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              and {advice.length - 8} more, all covered by the button above.
            </p>
          )}
        </div>
      )}

      {/* Anything measured that no change would improve. Worth seeing, but it
          isn't a to-do list, so it sits under the things that are. */}
      {floors.some((f) => f.score > 0) && (
        <ul className="tangle__list" style={{ marginTop: 10 }}>
          {floors
            .filter((floor) => floor.score > 0)
            .map((floor) => (
              <li key={floor.floorId}>
                <button
                  type="button"
                  className={`tangle__floor ${
                    floor.floorId === activeFloorId ? 'tangle__floor--active' : ''
                  }`}
                  onClick={() => onPickFloor(floor.floorId)}
                >
                  {floor.floorName}
                  <span className="muted">
                    {[
                      floor.crossings.length > 0
                        ? `${floor.crossings.length} crossing${
                            floor.crossings.length === 1 ? '' : 's'
                          }`
                        : '',
                      floor.laneClashes.length > 0
                        ? `${floor.laneClashes.length} shared lane${
                            floor.laneClashes.length === 1 ? '' : 's'
                          }`
                        : '',
                      floor.overBlocks.length > 0
                        ? `${floor.overBlocks.length} belt${
                            floor.overBlocks.length === 1 ? '' : 's'
                          } over a block`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}

      {links.length > 0 && (
        <details className="tangle">
          <summary className="tangle__heading">
            {links.length} lift{links.length === 1 ? '' : 's'} between floors
          </summary>
          <table className="table">
            <tbody>
              {links.map((link, i) => {
                const key = linkKey(link)
                // A depot is filled by walking to a line, so it's hand-carried
                // by nature rather than by choice: no toggle to offer.
                const byHand = link.depot === true || manual.has(key)
                const climbed = Math.abs(link.rise)
                return (
                  <tr
                    key={`${link.item}-${link.fromFloorId}-${link.toFloorId}-${i}`}
                    className={byHand ? 'is-manual' : ''}
                  >
                    <td>
                      <span className="cell">
                        <ItemIcon item={link.item} size={16} />
                        {itemName(link.item)}
                        {link.depot && <span className="muted"> reserve</span>}
                      </span>
                    </td>
                    <td className="num">
                      {link.depot ? (
                        <span className="muted">as needed</span>
                      ) : (
                        <>
                          {num(link.rate)}
                          <span className="muted">{rateUnit(link.item)}</span>
                        </>
                      )}
                    </td>
                    <td className="muted">
                      {floorName(link.fromFloorId)} {link.rise > 0 ? '↑' : '↓'}{' '}
                      {floorName(link.toFloorId)}
                    </td>
                    <td>
                      {link.depot ? (
                        <span
                          className="muted"
                          title={`Walk it ${link.rise > 0 ? 'up' : 'down'} ${climbed} floor${
                            climbed === 1 ? '' : 's'
                          } from the line that makes it`}
                        >
                          by hand
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`btn btn--tiny ${byHand ? 'btn--active' : ''}`}
                          onClick={() => onToggleManual(key)}
                          title={
                            byHand
                              ? 'Belt it instead, with a lift at each end'
                              : `Carry it by hand ${
                                  link.rise > 0 ? 'up' : 'down'
                                } ${climbed} floor${climbed === 1 ? '' : 's'}, no lift built`
                          }
                        >
                          {byHand ? 'by hand' : 'lift'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {shaftClashes.length > advice.length && (
            <ul className="tangle__list">
              {shaftClashes
                .filter((clash) => clash.kind === 'shaft')
                .slice(0, 3)
                .map((clash, i) => (
                  <li className="tangle__bad" key={`${clash.shaftId}-${i}`}>
                    {clash.label}
                    <span className="muted"> on {floorName(clash.floorId)}</span>
                  </li>
                ))}
            </ul>
          )}
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
            {(() => {
              const belted = links.filter((l) => !manual.has(linkKey(l)))
              if (belted.length === 0) {
                return 'All carried by hand, so nothing is built between floors.'
              }
              const note = belted.some((l) => l.fluid)
                ? 'Fluids need a pump every 20 m of lift.'
                : 'Each of these needs a lift at both ends.'
              return links.length === belted.length
                ? note
                : `${note} The rest are carried by hand.`
            })()}
          </p>
        </details>
      )}
    </Panel>
  )
}
