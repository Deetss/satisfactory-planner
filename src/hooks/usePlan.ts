import { useEffect, useMemo, useRef, useState } from 'react'
import { emptyResult, type PlanResult } from '../solver/interpret'
import { solvePlan } from '../solver/solve'
import { selectPlanRequest, usePlannerStore } from '../state/plannerStore'

/** Keeps typing in a rate field from firing a solve per keystroke. */
const DEBOUNCE_MS = 150

export function usePlan(): { result: PlanResult; solving: boolean } {
  const state = usePlannerStore()
  const [result, setResult] = useState<PlanResult>(() => emptyResult(''))
  const [solving, setSolving] = useState(false)

  // Only the fields the solver reads should retrigger it.
  const request = useMemo(
    () => selectPlanRequest(state),
    [
      state.targets,
      state.objective,
      state.tier,
      state.unlockedAlternates,
      state.resourceCaps,
      state.allowSurplus,
      state.powerGenerators,
      state.machineOverrides,
    ],
  )

  const runId = useRef(0)

  useEffect(() => {
    const id = ++runId.current
    setSolving(true)

    const timer = setTimeout(() => {
      solvePlan(request)
        .then((next) => {
          // A slower earlier solve must not overwrite a newer one.
          if (runId.current === id) setResult(next)
        })
        .catch((error: unknown) => {
          if (runId.current !== id) return
          setResult({
            ...emptyResult(''),
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          if (runId.current === id) setSolving(false)
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [request])

  return { result, solving }
}
