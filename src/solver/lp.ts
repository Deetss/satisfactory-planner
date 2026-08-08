/**
 * Minimal CPLEX LP-format writer.
 *
 * Variables are referenced by short generated ids (v0, v1, ...) rather than
 * game class names so nothing in the game data can collide with LP syntax.
 */

export type Sense = '=' | '<=' | '>='

export interface Term {
  variable: string
  coefficient: number
}

export interface Constraint {
  name: string
  terms: Term[]
  sense: Sense
  rhs: number
}

export interface LpProblem {
  direction: 'min' | 'max'
  objective: Term[]
  constraints: Constraint[]
  /** Upper bounds; every variable is implicitly >= 0 in LP format. */
  upperBounds: Record<string, number>
}

/** Plain decimal with no exponent, so the LP text stays unambiguous. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`non-finite coefficient: ${n}`)
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

function writeTerms(terms: Term[]): string {
  const live = terms.filter((t) => t.coefficient !== 0)
  if (live.length === 0) return '0'

  return live
    .map((t, i) => {
      const abs = Math.abs(t.coefficient)
      const sign = t.coefficient < 0 ? '-' : '+'
      const lead = i === 0 ? (t.coefficient < 0 ? '-' : '') : ` ${sign} `
      // A bare coefficient of 1 is legal but noisy; keep it for clarity.
      return `${lead}${fmt(abs)} ${t.variable}`
    })
    .join('')
}

export function toLpFormat(problem: LpProblem): string {
  const lines: string[] = []

  lines.push(problem.direction === 'min' ? 'Minimize' : 'Maximize')
  lines.push(` obj: ${writeTerms(problem.objective)}`)
  lines.push('Subject To')

  for (const c of problem.constraints) {
    // A constraint with no live terms is either trivially true or
    // infeasible; emitting it as-is lets HiGHS make that call.
    lines.push(` ${c.name}: ${writeTerms(c.terms)} ${c.sense} ${fmt(c.rhs)}`)
  }

  const bounded = Object.entries(problem.upperBounds).filter(([, v]) =>
    Number.isFinite(v),
  )
  if (bounded.length > 0) {
    lines.push('Bounds')
    for (const [variable, ub] of bounded) {
      lines.push(` ${variable} <= ${fmt(ub)}`)
    }
  }

  lines.push('End')
  return lines.join('\n')
}

/** Hands out LP-safe variable ids and remembers what each one means. */
export class VariableRegistry<Meta> {
  private readonly metaById = new Map<string, Meta>()
  private next = 0

  add(meta: Meta, prefix = 'v'): string {
    const id = `${prefix}${this.next++}`
    this.metaById.set(id, meta)
    return id
  }

  meta(id: string): Meta | undefined {
    return this.metaById.get(id)
  }

  entries(): [string, Meta][] {
    return [...this.metaById.entries()]
  }
}
