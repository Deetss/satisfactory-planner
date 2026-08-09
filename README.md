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
