interface Option<T> {
  value: T
  label: string
  title?: string
}

interface Props<T> {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  /** Describes the choice for screen readers, since there's no visible label. */
  label: string
}

/**
 * One choice out of a few, joined into a single control.
 *
 * Separate buttons wrap unevenly (three options become 2 + 1) and read as three
 * unrelated actions rather than one setting.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: Props<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`segmented__option ${
            option.value === value ? 'segmented__option--active' : ''
          }`}
          title={option.title}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
