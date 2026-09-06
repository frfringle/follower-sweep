import { useRef, useState } from 'react'
import { parseExportFiles, parseFollowSnippetBlob } from '../lib/instagramParser.js'
import { buildFollowSnippet } from '../lib/snippets.js'

function FollowSnippetPanel({ onParsed }) {
  const [blob, setBlob] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)
  const snippet = buildFollowSnippet()

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
  }

  function parseBlob() {
    try {
      onParsed(parseFollowSnippetBlob(blob))
      setBlob('')
      setError(null)
    } catch (e) {
      setError({ message: e.message, details: e.details ?? [] })
    }
  }

  return (
    <details className="rounded-xl border border-fuchsia-900/60 bg-zinc-900/60 p-3 text-sm text-zinc-300">
      <summary className="cursor-pointer font-semibold text-zinc-200">
        No export yet? Fetch lists with a console snippet
      </summary>
      <p className="mt-2 text-zinc-400">
        Instagram's export can take hours to arrive. Instead, paste this into the DevTools <b>Console</b> on
        any instagram.com tab (logged in as you): it pages through your followers and following — the same
        requests as scrolling the dialogs, just 200 people at a time — then downloads and embeds everyone's
        profile photo (fetched on instagram.com and shrunk to a thumbnail, so the swipe cards can show them
        without Instagram's cross-origin block), and copies one blob to your clipboard. The avatar step adds
        a bit of time and a “avatars N/N” progress log. Trade-off: no followed-since dates (only the official
        export has those; import both and they merge).
      </p>
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-zinc-950 border border-zinc-800 p-2 text-[10px] leading-relaxed text-zinc-300 select-all">
        {snippet}
      </pre>
      <button
        onClick={copySnippet}
        className="mt-2 w-full py-2 rounded-lg bg-zinc-800 text-sm font-semibold active:bg-zinc-700"
      >
        {copied ? '✓ Copied' : 'Copy snippet'}
      </button>
      <textarea
        value={blob}
        onChange={(e) => {
          setBlob(e.target.value)
          setError(null)
        }}
        placeholder="Then paste the copied blob here…"
        rows={3}
        className="mt-2 w-full rounded-lg bg-zinc-950 border border-zinc-800 p-2 text-xs font-mono placeholder:text-zinc-600"
      />
      <button
        onClick={parseBlob}
        disabled={!blob.trim()}
        className="mt-1 w-full py-2 rounded-lg bg-zinc-800 text-sm font-semibold disabled:opacity-40 active:bg-zinc-700"
      >
        Parse pasted blob
      </button>
      {error && (
        <div className="mt-2 rounded-lg border border-red-800 bg-red-950/50 p-2 text-xs">
          <div className="font-semibold text-red-300">⚠ {error.message}</div>
          {error.details.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-red-200/80 break-all">
              {error.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  )
}

export default function ImportStep({ data, onParsed, onContinue }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  async function handleFiles(fileList) {
    const files = [...fileList]
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const result = await parseExportFiles(files)
      onParsed(result)
    } catch (e) {
      setError({ message: e.message, details: e.details ?? [] })
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const mutualCount = data
    ? (() => {
        const f = new Set(data.followers.map((p) => p.username.toLowerCase()))
        return data.following.filter((p) => f.has(p.username.toLowerCase())).length
      })()
    : 0

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Import your Instagram export</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Drop the export <span className="text-zinc-200">.zip</span> here, or the extracted{' '}
          <span className="text-zinc-200">followers_1.json</span> and{' '}
          <span className="text-zinc-200">following.json</span> files. Everything is parsed on your device —
          nothing is uploaded anywhere.
        </p>
      </div>

      <details className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
        <summary className="cursor-pointer font-semibold text-zinc-200">How do I get this file?</summary>
        <ol className="mt-2 list-decimal pl-5 space-y-1 text-zinc-400">
          <li>Instagram → profile → ☰ → Accounts Center</li>
          <li>Your information and permissions → Download your information</li>
          <li>Some of your information → check <b>Followers and following</b></li>
          <li>Format: <b>JSON</b> (not HTML), date range: all time</li>
          <li>Download the zip Instagram emails you and drop it here</li>
        </ol>
      </details>

      <FollowSnippetPanel onParsed={onParsed} />

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={`block rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-zinc-700 bg-zinc-900/40 active:bg-zinc-900'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".zip,.json,application/zip,application/json"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="text-3xl">📦</div>
        <div className="mt-2 font-semibold">{busy ? 'Parsing…' : 'Tap to choose files'}</div>
        <div className="mt-1 text-xs text-zinc-500">.zip or .json · you can select several files at once</div>
      </label>

      {error && (
        <div className="rounded-xl border border-red-800 bg-red-950/50 p-3 text-sm">
          <div className="font-semibold text-red-300">⚠ {error.message}</div>
          {error.details.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-red-200/80 break-all">
              {error.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data && (
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 space-y-2">
          <div className="font-semibold text-emerald-300">✓ Import successful</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Followers" value={data.followers.length} />
            <Stat label="Following" value={data.following.length} />
            <Stat label="Mutuals" value={mutualCount} />
          </div>
          <ul className="text-xs text-zinc-400 break-all">
            {data.sources.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
            {Object.keys(data.profiles ?? {}).length > 0 && (
              <li>· avatars for {Object.keys(data.profiles).length} people</li>
            )}
          </ul>
          {data.warnings.length > 0 && (
            <ul className="text-xs text-amber-300/90 space-y-1">
              {data.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
          <button
            onClick={onContinue}
            className="w-full mt-1 py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 font-bold text-white active:opacity-80"
          >
            Continue → Likes data
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-zinc-900 py-2">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  )
}
