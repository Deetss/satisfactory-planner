import { useRef, useState } from 'react'
import {
  applyPlanFile,
  buildPlanFile,
  planFileStem,
  type ImportReport,
} from '../state/planFile'
import { usePlannerStore } from '../state/plannerStore'
import { buildShareUrl, LONG_LINK_CHARS } from '../state/shareLink'
import { Panel } from './Panel'

export function PlanFilePanel() {
  const targets = usePlannerStore((s) => s.targets)
  const fileRef = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Length of the link just copied, so an over-long one can be flagged. */
  const [copied, setCopied] = useState<number | null>(null)

  const download = () => {
    const savedAt = new Date().toISOString()
    const file = buildPlanFile(savedAt)
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${planFileStem(file.name, savedAt)}.factoryplan.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const load = async (file: File) => {
    setError(null)
    setReport(null)
    try {
      setReport(applyPlanFile(await file.text()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const copyLink = async () => {
    setError(null)
    setCopied(null)

    let url: string
    try {
      url = await buildShareUrl()
    } catch {
      setError("This browser couldn't build a link. Export a file instead.")
      return
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(url.length)
      window.setTimeout(() => setCopied(null), 4000)
    } catch {
      // Clipboard access needs a secure context, which the LAN address used for
      // testing on a phone isn't. Put the link somewhere it can still be copied
      // by hand rather than losing it.
      window.history.replaceState(null, '', url)
      setError('Copy blocked here. The address bar now holds the link.')
    }
  }

  const hasTargets = Object.keys(targets).length > 0

  return (
    <Panel title="Share & save" summary="link or file" defaultOpen={false}>
      <div className="btngroup">
        <button
          type="button"
          className="btn"
          onClick={() => void copyLink()}
          disabled={!hasTargets}
        >
          Copy link
        </button>
        <button
          type="button"
          className="btn"
          onClick={download}
          disabled={!hasTargets}
        >
          Export file
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => fileRef.current?.click()}
        >
          Import file
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void load(file)
          // Clearing the input lets the same file be re-imported.
          e.target.value = ''
        }}
      />

      <p className="muted panel__note">
        The address bar already holds a link to everything on screen, plan and
        floors both. Copy link compresses it to about half the length for
        sending; the file is what to use when even that is too long, or when you
        want it on disk.
      </p>

      {copied !== null && (
        <p
          className={`note ${copied > LONG_LINK_CHARS ? 'note--warn' : 'note--ok'}`}
        >
          Link copied, {(copied / 1000).toFixed(1)}k characters.
          {copied > LONG_LINK_CHARS &&
            ' Some chat apps cut links this long. Send the file if it arrives broken.'}
        </p>
      )}

      {error && <p className="note note--bad">{error}</p>}
      {report && (
        <p className="note note--ok">
          Loaded {report.name}: {report.floors} floor
          {report.floors === 1 ? '' : 's'}, {report.placements} placed block
          {report.placements === 1 ? '' : 's'}.
          {report.warnings.length > 0 && ` ${report.warnings.join(', ')}.`}
        </p>
      )}
    </Panel>
  )
}
