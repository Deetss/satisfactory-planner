# Satisfactory Factory Planner

Production calculator, flow graph and multi-floor layout planner, driven by the
game's own data rather than a hand-maintained recipe list.

- **Calculator** — LP optimizer over every automatable recipe. Set output rates,
  get machine counts, clocks, power and the minimum raw resources. Optimize for
  least ore, least power or fewest machines.
- **Graph** — production DAG, raw resources on the left through to your target.
- **Layout** — machines as to-scale blocks on an 8 m foundation grid, across
  multiple floors, with belt and pipe runs validated against tier throughput.
- **Breakdown** — machines, power, resources with the nodes and miners needed,
  surplus, and the minimum floor to even attempt a plan.

## Setup

```bash
npm install
npm run extract     # reads recipe data from your game install
npm run dev
```

`npm run extract` finds the game's `CommunityResources/Docs/en-US.json`
automatically on a standard Steam or Epic install. Pass the path if it can't:

```bash
npm run extract -- "/mnt/d/SteamLibrary/steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json"
```

Re-run it after a game update. The generated `src/data/game-data.json` is
gitignored — it's derived from the game, so it isn't checked in.

### Phone access

```bash
npm run dev -- --host
```

Then open the printed network address. On WSL2 with
`networkingMode=mirrored`, the WSL IP is already the LAN IP and no port
forwarding is needed; Windows Firewall may prompt for inbound on 5173 once.

## Icons (optional)

Icons are **not** included: the art belongs to Coffee Stain Studios. The app
falls back to initials without them, so this step is optional.

To use your own copy, extract the UI icons from your install following the
[official wiki tutorial](https://satisfactory.wiki.gg/wiki/Tutorial:Extracting_UI_icons)
(FModel for 0.8.0+, which needs `CommunityResources/FactoryGame.usmap` from your
game folder), then point the importer at the export:

```bash
npm run icons -- "/path/to/FModelExport"
```

It walks the export, copies only the icons this app references, and reports
anything it couldn't find. `public/icons/` is gitignored.

The mapping comes from the game data, not from guessing filenames — it has to,
because the names don't always line up: `Desc_IronPlate_C`'s icon is
`IconDesc_IronPlate**s**_256`.

## Tests

```bash
npm test
```

Vitest, sharing Vite's module resolution. Covers the solver against
hand-verified factory ratios, byproduct balancing, resource-limit
infeasibility, the coal power loop, belt and pipe selection, block packing,
mining node counts and storage capacity.

```bash
npm run typecheck
```

## Notes on the data

Everything in `src/data/game-data.json` is derived from the game's Docs export
by `scripts/extract-game-data.mjs`. A few things are worth knowing:

- Fluid amounts **and energy values** are stored in cm³ and scaled to m³.
- Building footprints come from clearance boxes, unioned with rotation applied
  and `ExcludeForSnapping` volumes ignored.
- Recipe names don't reliably track their buildable, so unlock tiers are matched
  by product descriptor. `Recipe_SmelterMk1_C` actually builds the Foundry.
- Node purity multipliers (0.5 / 1 / 2), the 250% overclock ceiling and map-wide
  resource totals aren't in the export and are constants in the script, with
  sources noted in comments.
