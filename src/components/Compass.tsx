/**
 * Which way is which.
 *
 * The app names directions constantly: a block feeds from its west face, a bus
 * grows east, a suggestion moves a block 8 m south, an elevation is drawn from
 * the west. None of that means anything without somewhere to check, and screen
 * up being north is a convention rather than something you can see.
 *
 * The dial turns to match the view, so whatever is at its top is the direction
 * you are looking, and the two sides of the dial are the two sides of the
 * screen. The letters counter-rotate to stay upright, the way they would on a
 * real one.
 */

/** Where the view is looking from, named as an elevation is named. */
export type Viewpoint = 'south' | 'west'

/**
 * Heading of the camera, clockwise from north.
 *
 * An elevation named for a side is the view *of* that side, so it looks back the
 * other way: the south elevation is seen from the south, looking north. The plan
 * view looks straight down with north up, which is the same heading.
 */
const HEADING: Record<Viewpoint, number> = {
  south: 0,
  west: 90,
}

const MARKS: { label: string; bearing: number }[] = [
  { label: 'N', bearing: 0 },
  { label: 'E', bearing: 90 },
  { label: 'S', bearing: 180 },
  { label: 'W', bearing: 270 },
]

/** Distance from the dial's centre to a letter, in its own viewBox units. */
const RING = 8.6

export function Compass({ facing }: { facing?: Viewpoint }) {
  const heading = facing ? HEADING[facing] : 0

  return (
    <div className="compass" aria-hidden="true">
      <svg viewBox="-12 -12 24 24" className="compass__dial">
        {/* Turned so the way you're looking is up, which puts the dial's own
            left and right on the screen's left and right. */}
        <g transform={`rotate(${-heading})`}>
          <path className="compass__needle" d="M 0 -7 L 2.6 0 L 0 7 L -2.6 0 z" />
          <circle className="compass__pin" r={1.3} />
          {MARKS.map(({ label, bearing }) => {
            const radians = ((bearing - 90) * Math.PI) / 180
            const x = Math.cos(radians) * RING
            const y = Math.sin(radians) * RING
            return (
              <text
                key={label}
                className={`compass__mark ${
                  label === 'N' ? 'compass__mark--n' : ''
                }`}
                x={x}
                y={y}
                // Back the other way by the same amount, so the letter reads
                // level however far the dial has turned.
                transform={`rotate(${heading} ${x} ${y})`}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {label}
              </text>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
