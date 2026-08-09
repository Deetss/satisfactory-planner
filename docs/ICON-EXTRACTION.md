# Extracting icons with FModel

Only what this planner needs. The icons the app references are extracted from
your own game install and committed under `public/icons/`, which is standard
practice for community Satisfactory tools. Follow this to refresh them after a
game update, or to fill in the ones that aren't there yet: 143 of the 200 are in
the repo, and the `Buildable/Factory` folder is the big gap.

The app works without any of this; missing icons fall back to initials.

## 1. Install FModel

Download from [fmodel.app](https://fmodel.app). Windows only, .NET based. Run it
from Windows, not WSL, since it needs to read the game folder directly.

## 2. Point it at the game

**Directory** → your Satisfactory install's Paks folder:

```
D:\SteamLibrary\steamapps\common\Satisfactory\FactoryGame\Content\Paks
```

Leave the AES key blank. Satisfactory's paks aren't encrypted.

**UE Version** → `GAME_UE5_6` for 1.1.x. If assets fail to load after a game
update, this is the first thing to bump.

## 3. Load the two files Coffee Stain ships for this

Both live in `Satisfactory\CommunityResources\`, the same folder the recipe data
comes from. Without them FModel throws
*"Package has unversioned properties but mapping file is missing"*.

**Mappings**: in Directory settings, tick **Local Mapping File** and point it at:

```
D:\SteamLibrary\steamapps\common\Satisfactory\CommunityResources\FactoryGame.usmap
```

**Custom versions**: Settings → General → **Custom Versions** button. Clear the
box and paste the entire contents of:

```
D:\SteamLibrary\steamapps\common\Satisfactory\CommunityResources\CustomVersions.json
```

Load, and `FactoryGame-Windows.utoc` should appear in the Archives list.

## 4. Export these folders

Icons live in a `UI/` subfolder next to each asset, named `IconDesc_*` or just
the item name. Sulfur, for example, is at
`Resource/RawResources/Sulfur/UI/Sulfur_256.png`.

All 200 icons this app uses come from these paths. Right-click a folder in the
tree and choose **Export Folder Packages Raw Data** (or preview and export
individually):

| Folder | Icons | Needed for |
|---|---|---|
| `FactoryGame/Content/FactoryGame/Resource/Parts` | 124 | every crafted item |
| `FactoryGame/Content/FactoryGame/Buildable/Factory` | 33 | machines, generators, miners, belts, containers |
| `FactoryGame/Content/FactoryGame/Resource/RawResources` | 13 | ores, coal, water, oil |
| `FactoryGame/Content/FactoryGame/Resource/Environment` | 6 | a few fluids |
| `FactoryGame/Content/FactoryGame/Events/Christmas/Parts` | 12 | FICSMAS items, skip unless you want them |
| `FactoryGame/Content/FactoryGame/Equipment/RebarGun` + `Equipment/Rifle` | 7 | rebar and rifle ammo |

The first three cover 170 of 200 and are the ones worth doing.

Two of those paths are easy to pick wrong in the tree, because a similarly named
folder sits next to them:

- **`Equipment/` is at the top level**, a sibling of `Resource/`, not
  `Resource/Equipment/`. The one under `Resource/` holds the tools themselves
  (rebar gun, jetpack); the ammo icons are in the top-level one.
- **`Buildable/Factory`** is where every machine, generator, miner, belt and
  container icon lives. Without it the app falls back to initials for all 33 of
  them, which is most of what the layout view shows.

Exports land in FModel's output directory, which mirrors the game's tree:
`Exports/FactoryGame/Content/FactoryGame/...`

## 5. Import

Point the importer at whatever folder holds the export tree:

```bash
npm run icons -- ./Exports
```

It walks the tree, takes only the icons the app references, downscales them to
64 px, and reports anything it couldn't find. Re-run it any time you export
more; it's additive.

Two details it handles for you:

- **Size preference.** The game ships several resolutions and the data names one
  (say `Sulfur_256`). The importer takes the smallest published variant of the
  same art, then downscales anything still above 64 px using Pillow if
  `python3` has it. That's ~7 KB an icon instead of ~80 KB, which matters across
  200 files. Without Pillow it copies at source resolution and says so.
- **Naming.** Files are written under the stem the app looks up, which is a key
  rather than a claim about the pixels inside. Don't rename them.

## Why the mapping isn't guessed

Icon filenames don't track their class names. `Desc_IronPlate_C` uses
`IconDesc_IronPlate**s**_256` (plural), and water uses `LiquidWater_Pipe_256`,
which follows no pattern at all. The extractor reads the real `mSmallIcon` path
out of the game's own data, so all 200 resolve exactly.
