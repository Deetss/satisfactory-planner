import { expect, test } from 'vitest'

import { gameData } from '../src/data/gameData'
import { unknownTargets, type PlanRequest } from '../src/solver/model'
import { diagnoseInfeasible } from '../src/solver/solve'

/**
 * A target id the dataset doesn't carry is a damaged link, not an impossible
 * factory. The line between the two matters because the answers are opposite:
 * one says check the link, the other says raise the tier.
 *
 * Every id below is asserted against the real dataset, so a stale id fails
 * loudly here rather than making an assertion pass vacuously.
 */

test('a real item is recognised', () => {
  expect(unknownTargets({ Desc_IronIngot_C: 30 })).toEqual([])
})

test('a real item nothing can produce is still recognised', () => {
  // Leaves are foraged, so no recipe makes them. Infeasible is the honest
  // answer for that and unrecognised is not, which is the whole distinction.
  expect(gameData.items['Desc_Leaves_C']?.foraged).toBe(true)
  expect(unknownTargets({ Desc_Leaves_C: 10 })).toEqual([])
})

test('only the unrecognised id comes back from a mixed request', () => {
  expect(unknownTargets({ Desc_NotAThing_C: 10, Desc_IronIngot_C: 30 })).toEqual(
    ['Desc_NotAThing_C'],
  )
})

test('unrecognised ids keep the order they were asked for', () => {
  expect(unknownTargets({ Desc_NotAThing_C: 5, Desc_AlsoNot_C: 5 })).toEqual([
    'Desc_NotAThing_C',
    'Desc_AlsoNot_C',
  ])
})

test('a zero rate is not a request', () => {
  expect(unknownTargets({ Desc_NotAThing_C: 0 })).toEqual([])
})

/**
 * The rest of this request is never read. The check returns before the model
 * is built and before the solver loads, so nothing here has to be solvable.
 */
const request: PlanRequest = {
  targets: { Desc_NotAThing_C: 10 },
  enabledRecipes: new Set(),
  resourceCaps: {},
  objective: 'resources',
  allowSurplus: () => true,
  powerGeneration: null,
}

test('an unrecognised target is named, not called an impossible factory', async () => {
  const diagnosis = await diagnoseInfeasible(request)

  expect(diagnosis.kind).toBe('unknown')
  expect(diagnosis.shortfalls).toEqual([])
  // Naming the id is what proves the early return ran: neither of the other
  // two paths that also answer 'unknown' can mention it.
  expect(diagnosis.message).toContain('Desc_NotAThing_C')
  expect(diagnosis.message).not.toContain('tech tier')
})
