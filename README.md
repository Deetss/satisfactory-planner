# Satisfactory Factory Planner

A browser based factory planner for Satisfactory. Say what you want to come out
and how fast, and it works out the machines, the power and the raw resources,
then arranges them across floors with belts, pipes and lifts. It runs entirely
in the browser: no account, no server, and the plan lives in the URL.

![The Layout view with five machine blocks arranged on a 16 by 16 foundation floor and belt runs drawn between them](docs/screenshots/layout.png)

## What it does

**Setup.** Pick the items you want and the rate for each, set the tech tier,
switch alternate recipes on, cap individual resources, and choose what to
optimize for out of least ore, least power or fewest machines.

**Graph.** The production chain as a directed graph, raw resources through to
your targets, laid out automatically.

![The Graph view showing a Reinforced Iron Plate chain from Iron Ore through ingots, plates, rods and screws](docs/screenshots/graph.png)

**Layout.** Machines as to scale blocks on an 8 m foundation grid, across
multiple floors, with belt and pipe runs drawn between them and an auto arrange
that packs a floor or a whole stack. Congestion analysis finds crossings, runs
sharing a lane, and belts passing over blocks, then ranks the moves that would
clear them.

**Breakdown.** Machine counts with the clock speed each group needs, power drawn
and generated, the raw resources with the nodes and miners behind them, any
surplus you have to deal with, and the minimum extraction a plan needs before it
is worth attempting.

## Try it

The whole plan, layout included, rides in the URL fragment. Encoding happens as
you work, so the address bar is always a complete link with no button to press
first. Copy link in the Share & save panel compresses it to about half the
length, which is what makes a big plan sendable.

```
https://deetss.github.io/satisfactory-planner/#2.eyJ2IjoyLCJ0Ijp7Iklyb25QbGF0ZSI6MTIwfSwibyI6MCwiciI6OCwieiI6OCwiQSI6MCwiRiI6W1siR3JvdW5kIiwxMiwxMiwwLDAsMF1dLCJQIjpbXX0
```

Opening that gives you Iron Plate at 120 per minute: 12 machines, 48 MW draw.

The site is not deployed yet, so that link has nothing to resolve against until
the deploy phase lands.

## Development

Node and npm are the only prerequisites. The game data and the icons are
committed to the repo, so a fresh clone runs with no Satisfactory install
anywhere. You only need the game to refresh either of them, which is the next
section.

```bash
git clone "https://github.com/Deetss/satisfactory-planner.git"
cd "satisfactory-planner"
npm ci
npm run dev
```

`npm ci` rather than `npm install`, because the lockfile is committed and
`npm ci` installs exactly what it records. Reach for `npm install` only when you
are deliberately adding or bumping a dependency.

The rest of the scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server, printed address is usually `http://localhost:5173` |
| `npm run build` | Production build. It typechecks first: the script is `tsc --noEmit && vite build` |
| `npm run typecheck` | The typecheck on its own, without the build |
| `npm test` | The vitest suite, one run |
| `npm run test:watch` | The same suite, re-running as you edit |
| `npm run preview` | Serves the built `dist/`, for checking a production build |

Vitest reads the same `vite.config.ts` the app builds with, so module resolution
is identical in the tests and in the browser. There are five files in `test/`:
`solver` for machine counts, alternates, surplus rules and resource limits,
`layout` for belt and pipe choice, block packing, storage reserves and mining
node counts, `paths` for route shapes and congestion detection, `state` for plan
normalization and the v2 link codec, and `diagnose` for what the app reports
when a plan cannot be solved.

### Phone access

```bash
npm run dev -- --host
```

Then open the printed network address. On WSL2 with `networkingMode=mirrored`
the WSL IP is already the LAN IP, so no port forwarding is needed. Windows
Firewall may prompt for inbound on 5173 once.
