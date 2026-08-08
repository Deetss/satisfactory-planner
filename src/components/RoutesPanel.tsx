import { itemName } from '../data/gameData'
import type { Route } from '../layout/routes'
import type { FactoryModule } from '../layout/types'
import { ItemIcon } from './Icon'
import { Panel } from './Panel'
import { num } from '../format'

interface Props {
  routes: Route[]
  modulesById: Map<string, FactoryModule>
  /** Restrict to runs touching this module, when one is selected. */
  focusModuleId: string | null
}


const endpointName = (
  moduleId: string | null,
  modulesById: Map<string, FactoryModule>,
  fallback: string,
) => (moduleId ? (modulesById.get(moduleId)?.label ?? moduleId) : fallback)

export function RoutesPanel({ routes, modulesById, focusModuleId }: Props) {
  const shown = focusModuleId
    ? routes.filter((r) => r.from === focusModuleId || r.to === focusModuleId)
    : routes

  const overCapacity = shown.filter((r) => r.transport.needsSplit)
  const blocked = shown.filter((r) => !r.transport.option)
  const totalLines = shown.reduce((sum, r) => sum + r.transport.lines, 0)

  if (shown.length === 0) {
    return (
      <Panel title="Belts &amp; pipes" summary="none yet">
        <p className="muted" style={{ margin: 0 }}>
          No material runs yet.
        </p>
      </Panel>
    )
  }

  // The heading carries the count and anything wrong with it, so a collapsed
  // panel still says whether the build list needs looking at.
  const trouble = [
    overCapacity.length > 0 ? `${overCapacity.length} need splitting` : '',
    blocked.length > 0 ? `${blocked.length} not unlocked` : '',
  ].filter(Boolean)

  return (
    <Panel
      title="Belts &amp; pipes"
      summary={[`${totalLines} lines`, ...trouble].join(' · ')}
    >

      {/* A list rather than a table: three columns in a 300px sidebar wrapped
          every cell onto three lines each. */}
      <ul className="runs">
        {shown
          .slice()
          .sort((a, b) => b.rate - a.rate)
          .map((route) => {
            const { option, lines, needsSplit } = route.transport
            return (
              <li className="run" key={route.id}>
                <ItemIcon item={route.item} size={20} />
                <div className="run__body">
                  <div className="run__head">
                    <span className="run__item">{itemName(route.item)}</span>
                    <span className="run__rate">
                      {num(route.rate)}
                      <span className="muted">
                        {route.fluid ? ' m³/min' : '/min'}
                      </span>
                    </span>
                  </div>
                  <div className="run__path">
                    {endpointName(route.from, modulesById, 'from outside')}
                    {' → '}
                    {endpointName(route.to, modulesById, 'output')}
                  </div>
                  <div
                    className={`run__carry ${
                      needsSplit ? 'warn' : !option ? 'bad' : 'muted'
                    }`}
                  >
                    {!option
                      ? `No ${route.fluid ? 'pipe' : 'belt'} unlocked yet`
                      : `${lines > 1 ? `${lines}x ` : ''}${option.name}${
                          needsSplit
                            ? `, ${num(option.throughput)} each over one line`
                            : ''
                        }`}
                  </div>
                </div>
              </li>
            )
          })}
      </ul>
    </Panel>
  )
}
