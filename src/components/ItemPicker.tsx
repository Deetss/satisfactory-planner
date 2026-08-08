import { useMemo, useState } from 'react'
import { itemName, producibleItems } from '../data/gameData'
import { ItemIcon } from './Icon'

interface Props {
  onPick: (item: string) => void
  exclude: string[]
  placeholder?: string
}

export function ItemPicker({ onPick, exclude, placeholder }: Props) {
  const [query, setQuery] = useState('')
  const excluded = useMemo(() => new Set(exclude), [exclude])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return []
    return producibleItems
      .filter((i) => !excluded.has(i) && itemName(i).toLowerCase().includes(q))
      .slice(0, 12)
  }, [query, excluded])

  return (
    <div className="picker">
      <input
        type="search"
        className="input"
        placeholder={placeholder ?? 'Search an item to produce…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        enterKeyHint="search"
      />
      {matches.length > 0 && (
        <ul className="picker__results">
          {matches.map((item) => (
            <li key={item}>
              <button
                type="button"
                className="picker__result"
                onClick={() => {
                  onPick(item)
                  setQuery('')
                }}
              >
                <ItemIcon item={item} />
                <span>{itemName(item)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
