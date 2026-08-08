import type { LayoutView } from '../state/uiStore'

export type { LayoutView }

interface Props {
  value: LayoutView
  onChange: (view: LayoutView) => void
}

const OPTIONS: { id: LayoutView; label: string; title: string }[] = [
  { id: 'top', label: 'Top', title: 'Plan view: arrange blocks on a floor' },
  { id: 'side', label: 'Side', title: 'Elevation: floor stack and headroom' },
]

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="btngroup">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`btn btn--icon ${value === option.id ? 'btn--active' : ''}`}
          title={option.title}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
