import { useState } from 'react'
import { items } from '../data/gameData'

interface Props {
  /** Icon file stem, as recorded in the game data. */
  icon: string | null | undefined
  /** Used for the fallback initials and the alt text. */
  name: string
  size?: number
}

/** Base path so this keeps working under a subdirectory deploy. */
const ICON_BASE = `${import.meta.env.BASE_URL}icons/`

/**
 * Fallback tints. Icons are optional, so a plan with none of them still has to
 * be scannable: giving each name a stable colour lets you tell a Smelter row
 * from a Constructor row at a glance, the job the art would otherwise do.
 */
const TINTS = [
  { fg: '#7fb3d5', bg: '#1b2b38' },
  { fg: '#d5a17f', bg: '#332619' },
  { fg: '#9ecf8f', bg: '#1f2e1c' },
  { fg: '#c79ed5', bg: '#2b1f33' },
  { fg: '#d5cb7f', bg: '#302d19' },
  { fg: '#7fd5c4', bg: '#19302c' },
]

function tintFor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100000
  }
  return TINTS[hash % TINTS.length]
}

/** First letters of the first two words, which reads better than a truncation. */
function initialsOf(name: string) {
  const words = name.split(/[\s-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Renders an extracted game icon, falling back to initials.
 *
 * Only 143 of the roughly 200 icons the app references are present, so the
 * fallback is the normal path for the rest, not an error case.
 */
export function Icon({ icon, name, size = 20 }: Props) {
  const [failed, setFailed] = useState(false)

  if (!icon || failed) {
    const tint = tintFor(name)
    return (
      <span
        className="icon icon--fallback"
        style={{
          width: size,
          height: size,
          // Two characters need most of the box to stay legible at 16px.
          fontSize: Math.max(9, Math.round(size * 0.46)),
          color: tint.fg,
          background: tint.bg,
          borderColor: tint.fg,
        }}
        aria-hidden="true"
        title={name}
      >
        {initialsOf(name)}
      </span>
    )
  }

  return (
    <img
      className="icon"
      src={`${ICON_BASE}${icon}.png`}
      alt=""
      title={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

/** Convenience wrapper for an item class name. */
export function ItemIcon({ item, size }: { item: string; size?: number }) {
  const record = items[item]
  return <Icon icon={record?.icon} name={record?.name ?? item} size={size} />
}
