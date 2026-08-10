import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './perf',
  /**
   * A correctness rule, not a style one. Playwright's default testMatch is
   * `.*(test|spec).(js|ts|mjs)` and vitest's default include is
   * `**\/*.{test,spec}.?(c|m)[jt]s?(x)`; they overlap completely, and vitest 4
   * excludes only `node_modules` and `.git`. A file under `perf/` named the
   * Playwright default way would therefore be collected by `npm test`, fail on
   * its first `@playwright/test` import, and take the Pages deploy down with
   * it, because `.github/workflows/deploy.yml` runs `npm test` before
   * `npm run build`. The `.perf.ts` suffix matches neither vitest default.
   */
  testMatch: '**/*.perf.ts',
  /**
   * The target is a production preview, never the dev server. The dev server
   * serves an unbundled development React wrapped in StrictMode, which double
   * invokes render and so inflates exactly the re-render cost this baseline
   * exists to track. `vite preview` serves what `vite build` emitted, which is
   * what Pages serves.
   *
   * `npm run build` must have been run first: `vite preview` serves `dist/`
   * and does not build it.
   */
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:4173/',
    // Part of the baseline's identity rather than a machine default, so Phase
    // 12 can tell a viewport change from a regression.
    viewport: { width: 1440, height: 900 },
  },
  // Parallel workers contend for CPU while the CDP throttle is active.
  workers: 1,
  // A retry would silently record a second run's numbers over the first.
  retries: 0,
})
