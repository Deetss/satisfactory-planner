/**
 * The address bar as the save slot.
 *
 * Everything needed to rebuild a factory, layout included, rides in the
 * fragment, which browsers never send to a server. Two forms exist because they
 * answer different needs:
 *
 * - `2.<base64url>` is written as you work. Encoding is synchronous, so the
 *   address is always a complete link with no button to press first.
 * - `2z.<base64url>` is the same bytes deflated, built when you ask for a link.
 *   It's about half as long, which is what makes a big plan sendable.
 *
 * Both decode to the same thing. A fragment with no prefix is a link from
 * before this scheme, when only the plan travelled and the layout didn't.
 */

import { create } from 'zustand'
import { decodePlanCode, encodePlanCode } from './planCode'
import { applyPlan, buildPlanFile, type ImportReport } from './planFile'
import { normalizePlan } from './plannerStore'

const PLAIN = '2.'
const DEFLATED = '2z.'

/** Past this many characters a link starts getting cut by chat clients. */
export const LONG_LINK_CHARS = 8000

/** btoa can't take a spread of a large array, so feed it in chunks. */
function toBase64Url(bytes: Uint8Array): string {
  let ascii = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    ascii += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(ascii).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/** The plain fragment for the current state, cheap enough to write on an edit. */
export function currentFragment(): string {
  const code = encodePlanCode(buildPlanFile(''))
  return PLAIN + toBase64Url(encoder.encode(code))
}

/**
 * An absolute link to the current plan and layout, deflated so it stays short.
 * Falls back to the plain form where CompressionStream is missing.
 */
export async function buildShareUrl(): Promise<string> {
  const fragment =
    typeof CompressionStream === 'undefined'
      ? currentFragment()
      : DEFLATED +
        toBase64Url(await deflate(encodePlanCode(buildPlanFile(''))))

  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}#${fragment}`
}

const hashOf = () =>
  typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '')

interface ShareNotice {
  ok: boolean
  message: string
}

/**
 * What happened to a link the app opened. It lives in a store because a link
 * arrives either at startup or from a paste into the address bar of a running
 * app, and both need to reach the same banner.
 */
export const useShareStatus = create<{
  notice: ShareNotice | null
  show: (notice: ShareNotice) => void
  clear: () => void
}>((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  clear: () => set({ notice: null }),
}))

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

async function readFragment(fragment: string): Promise<ImportReport> {
  if (fragment.startsWith(DEFLATED)) {
    const code = await inflate(fromBase64Url(fragment.slice(DEFLATED.length)))
    return applyPlan(decodePlanCode(code))
  }

  if (fragment.startsWith(PLAIN)) {
    const code = new TextDecoder().decode(
      fromBase64Url(fragment.slice(PLAIN.length)),
    )
    return applyPlan(decodePlanCode(code))
  }

  // A link from before the layout travelled: plain base64 of the plan's own
  // JSON, no prefix and no layout. Still worth opening rather than rejecting.
  const json = decodeURIComponent(escape(atob(fragment)))
  return applyPlan({ plan: normalizePlan(JSON.parse(json)) })
}

/**
 * Opens whatever is in the address, if anything. Never rejects: a damaged link
 * is reported through the store so the app still starts on the plan this
 * browser already had.
 */
export async function consumePlanFragment(): Promise<void> {
  const fragment = hashOf()
  if (!fragment) return

  try {
    const report = await readFragment(fragment)
    const parts = [
      `Opened ${report.name} from a link`,
      `${count(report.floors, 'floor')}, ${count(report.placements, 'placed block')}`,
    ]
    if (report.warnings.length > 0) parts.push(report.warnings.join(', '))
    useShareStatus.getState().show({ ok: true, message: `${parts.join(': ')}.` })
  } catch (cause) {
    useShareStatus.getState().show({
      ok: false,
      message: `That link didn't open. ${
        cause instanceof Error ? cause.message : 'It looks damaged.'
      }`,
    })
  }
}
