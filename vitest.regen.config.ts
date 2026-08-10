/**
 * Runs the golden regeneration and nothing else.
 *
 * The filename is deliberately not `vitest.config.ts`. That name is auto loaded
 * and would take over `npm test`, which `.github/workflows/deploy.yml` runs
 * before the build on every push to main.
 *
 * This file and `tools/` sit outside `tsconfig.json`'s include, which is the
 * same place `scripts/extract-game-data.mjs` and `scripts/import-icons.mjs`
 * have always sat: node tooling in this repo is proven by being run rather than
 * by `tsc`. Pulling `tools` into the include would require `@types/node`, and
 * D-12 permits one new package and it is not that one. `test/golden/round.ts`
 * is typechecked either way, because `test` is already in the include.
 */
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  // A standalone vitest config inherits nothing from vite.config.ts, and the
  // generator imports LayoutCanvas.tsx, so the React plugin has to come along.
  viteConfig,
  defineConfig({
    test: {
      // Exactly one file, and it is not a test file, so regeneration can never
      // happen as a side effect of a test run.
      include: ['tools/regen-goldens.ts'],
    },
  }),
)
