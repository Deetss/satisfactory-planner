// Copies the icons this planner needs out of an FModel/umodel export.
//
// The imported icons are committed and shipped with the repo, which is
// standard practice for community Satisfactory tools. Re-run this script
// after a game update to refresh them.
//
// Usage: node scripts/import-icons.mjs "<path to export folder>"

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const OUT_DIR = path.join(ROOT, 'public/icons')
const DATA = path.join(ROOT, 'src/data/game-data.json')

/** Icon stems the app can actually display, and what each one is for. */
function wantedIcons() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'))
  const wanted = new Map()

  const add = (icon, label) => {
    if (!icon) return
    if (!wanted.has(icon)) wanted.set(icon, label)
  }

  for (const item of Object.values(data.items)) add(item.icon, item.name)
  for (const b of Object.values(data.buildings)) add(b.icon, b.name)
  for (const g of Object.values(data.generators)) add(g.icon, g.name)
  for (const e of data.extractors) add(e.icon, e.name)
  for (const b of data.transport.belts) add(b.icon, b.name)
  for (const p of data.transport.pipes) add(p.icon, p.name)
  for (const s of [...data.storage.solid, ...data.storage.fluid]) {
    add(s.icon, s.name)
  }

  return wanted
}

/**
 * Resolutions to take, smallest first. The game ships several sizes of most
 * icons and we display them at 16-20 px, so the 64 px art is plenty and about
 * 13x smaller on disk (7 KB against 91 KB for a 256 px source).
 */
const PREFERRED_SIZES = [64, 128, 256, 512]

/** Every image file under a directory, keyed by filename stem. */
function indexExport(dir) {
  const found = new Map()
  const stack = [dir]

  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (ext !== '.png' && ext !== '.webp') continue

      const stem = path.basename(entry.name, path.extname(entry.name))
      // Prefer PNG when both formats exist for the same stem.
      if (!found.has(stem) || ext === '.png') found.set(stem, full)
    }
  }

  return found
}

const exportDir = process.argv[2]
if (!exportDir) {
  console.error(
    'Usage: node scripts/import-icons.mjs "<path to FModel/umodel export>"\n\n' +
      'Extract icons first, following the official wiki tutorial:\n' +
      '  https://satisfactory.wiki.gg/wiki/Tutorial:Extracting_UI_icons\n' +
      'FModel needs CommunityResources/FactoryGame.usmap from your game install.',
  )
  process.exit(1)
}
if (!fs.existsSync(exportDir)) {
  console.error(`No such folder: ${exportDir}`)
  process.exit(1)
}

const wanted = wantedIcons()
const available = indexExport(exportDir)

fs.mkdirSync(OUT_DIR, { recursive: true })

/**
 * Best source for an icon: the smallest published resolution of the same art.
 * The game data names one size (say Sulfur_256) but a Sulfur_64 alongside it is
 * the same image and far lighter.
 */
function pickSource(stem) {
  const base = stem.replace(/_\d+$/, '')
  if (base !== stem) {
    for (const size of PREFERRED_SIZES) {
      const candidate = available.get(`${base}_${size}`)
      if (candidate) return { file: candidate, size }
    }
  }
  const exact = available.get(stem)
  return exact ? { file: exact, size: null } : null
}

/** Icons render at 16-20 px, so this is generous even on a 2x display. */
const TARGET_PX = 64

/**
 * Shrinks oversized icons in one pass with Pillow, if it's available. Some
 * icons only ship at 256 or 512 px, which is ~80 KB each and adds up badly
 * across 200 files. Falling back to a plain copy keeps this optional.
 */
function shrinkAll(jobs) {
  if (jobs.length === 0) return false
  const script = `
import sys, json
from PIL import Image
for src, dest in json.load(sys.stdin):
    with Image.open(src) as im:
        im = im.convert("RGBA")
        if max(im.size) > ${TARGET_PX}:
            im.thumbnail((${TARGET_PX}, ${TARGET_PX}), Image.LANCZOS)
        im.save(dest, "PNG", optimize=True)
`
  try {
    execFileSync('python3', ['-c', script], {
      input: JSON.stringify(jobs),
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

let copied = 0
const sizeCounts = new Map()
const missing = []
const shrinkJobs = []

for (const [stem, label] of wanted) {
  const source = pickSource(stem)
  if (!source) {
    missing.push(`${stem} (${label})`)
    continue
  }

  // Named by the stem the app looks up, which is a key rather than a claim
  // about the pixel dimensions inside.
  const dest = path.join(OUT_DIR, `${stem}.png`)
  shrinkJobs.push([source.file, dest])
  copied++

  const key = source.size ? `${source.size}px` : 'as-named'
  sizeCounts.set(key, (sizeCounts.get(key) ?? 0) + 1)
}

const shrank = shrinkAll(shrinkJobs)
if (!shrank) {
  for (const [source, dest] of shrinkJobs) fs.copyFileSync(source, dest)
}

const bytes = shrinkJobs.reduce(
  (sum, [, dest]) => sum + (fs.existsSync(dest) ? fs.statSync(dest).size : 0),
  0,
)

console.log(`scanned ${available.size} images in ${exportDir}`)
console.log(
  `copied ${copied}/${wanted.size} icons into public/icons/ ` +
    `(${(bytes / 1024).toFixed(0)} KB total)`,
)
console.log(
  shrank
    ? `downscaled to ${TARGET_PX}px with Pillow`
    : 'copied at source resolution (install python3 + Pillow to downscale)',
)
if (sizeCounts.size > 0) {
  const summary = [...sizeCounts.entries()]
    .map(([size, count]) => `${count} at ${size}`)
    .join(', ')
  console.log(`resolutions used: ${summary}`)
}

if (missing.length > 0) {
  console.log(`\n${missing.length} not found in the export:`)
  for (const m of missing.slice(0, 20)) console.log(`  ${m}`)
  if (missing.length > 20) console.log(`  ...and ${missing.length - 20} more`)
  console.log(
    '\nThe app falls back to initials for anything missing, so a partial ' +
      'import is fine. docs/ICON-EXTRACTION.md lists which folder each group ' +
      'comes from.',
  )
}
