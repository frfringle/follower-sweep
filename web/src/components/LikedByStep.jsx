import { useState } from 'react'
import { parseLikedByBlob } from '../lib/likedByParser.js'
import { postUrlToMediaId } from '../lib/mediaId.js'
import { buildLikersSnippet, buildAllPostsSnippet } from '../lib/snippets.js'

function SnippetHelper() {
  const [mode, setMode] = useState('all')
  const [postUrl, setPostUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const mediaId = postUrlToMediaId(postUrl)
  const snippet = mode === 'all' ? buildAllPostsSnippet(3) : buildLikersSnippet(mediaId)

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
  }

  const modeBtn = (value, label) => (
    <button
      onClick={() => setMode(value)}
      className={`flex-1 py-1.5 rounded-md font-semibold transition-colors ${
        mode === value ? 'bg-zinc-700 text-white' : 'text-zinc-500 active:bg-zinc-800'
      }`}
    >
      {label}
    </button>
  )

  return (
    <details open className="rounded-xl border border-fuchsia-900/60 bg-zinc-900/60 p-3 text-sm text-zinc-300">
      <summary className="cursor-pointer font-semibold text-zinc-200">
        Fastest: one console snippet, one paste
      </summary>
      <p className="mt-2 text-zinc-400">
        Open <b>your own profile</b> on instagram.com (so the post grid is on screen), then paste this into
        the DevTools <b>Console</b>. It reads your recent posts straight from the grid's links, fetches each
        “Liked by” list, and copies one combined blob to your clipboard — one paste in the box below covers
        all three posts. (Swipe-card photos come from the followers/following snippet on the Import step,
        which embeds them; this likes blob is just for the interaction signal.)
      </p>
      <div className="mt-2 flex rounded-lg bg-zinc-950 p-1 gap-1 text-xs">
        {modeBtn('all', 'Last 3 posts')}
        {modeBtn('single', 'Single post')}
      </div>
      {mode === 'single' && (
        <>
          <p className="mt-2 text-xs text-zinc-500">
            Run it on the post's page, or paste a post link here to hard-code the media ID (the shortcode in{' '}
            <code>/p/…</code> is the media ID in base64):
          </p>
          <input
            type="url"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://www.instagram.com/p/… (optional)"
            className="mt-2 w-full rounded-lg bg-zinc-950 border border-zinc-800 p-2 text-xs font-mono placeholder:text-zinc-600"
          />
          {postUrl.trim() && !mediaId && (
            <p className="mt-1 text-xs text-red-400">No shortcode found in that link — expected …/p/&lt;code&gt;/ or …/reel/&lt;code&gt;/</p>
          )}
          {mediaId && <p className="mt-1 text-xs text-emerald-400">✓ media ID {mediaId}</p>}
        </>
      )}
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-zinc-950 border border-zinc-800 p-2 text-[10px] leading-relaxed text-zinc-300 select-all">
        {snippet}
      </pre>
      <button
        onClick={copySnippet}
        className="mt-2 w-full py-2 rounded-lg bg-zinc-800 text-sm font-semibold active:bg-zinc-700"
      >
        {copied ? '✓ Copied' : 'Copy snippet'}
      </button>
      <p className="mt-2 text-xs text-amber-300/80">
        {mode === 'all'
          ? 'Makes 4 requests as you (your post list, then one “Liked by” per post) — the same calls Instagram’s own UI makes when you browse your posts.'
          : 'Makes one request as you — the same call the “Liked by” dialog makes when you open it.'}{' '}
        Prefer zero extra requests? Use the Network-tab copy route above.
      </p>
      <p className="mt-2 text-xs text-zinc-500">
        Getting a <b>403</b>? Some sessions also require an <code>x-ig-www-claim</code> token the snippet
        can't read. Replay Instagram's own request instead: Network tab → right-click the{' '}
        <code>likers/</code> request → Copy → <b>Copy as fetch</b> → paste into the Console. Or just copy
        that request's Response JSON and paste it below.
      </p>
    </details>
  )
}

function entryLabel(result, fileName, index) {
  if (result.postCount) return `Bundle · ${result.postCount} post${result.postCount === 1 ? '' : 's'}`
  if (fileName) return fileName
  return `Blob ${index + 1}`
}

export default function LikedByStep({ likedPosts, onSave }) {
  // One input, a growing list of added blobs. A "last 3 posts" bundle is a
  // single entry that already covers every post, so there's no need for the
  // old three fixed slots.
  const [entries, setEntries] = useState(() =>
    likedPosts.map((p, i) => ({
      id: `init-${i}`,
      label: p.label ?? entryLabel({ postCount: p.postCount }, p.source, i),
      usernames: p.usernames ?? [],
      profiles: p.profiles ?? {},
      method: p.method ?? 'json',
      postCount: p.postCount ?? null,
      source: p.source ?? null,
    })),
  )
  const [text, setText] = useState('')
  const [error, setError] = useState(null)

  function addBlob(raw, fileName = null) {
    try {
      const r = parseLikedByBlob(raw)
      setEntries((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          label: entryLabel(r, fileName, entries.length),
          usernames: r.usernames,
          profiles: r.profiles ?? {},
          method: r.method,
          postCount: r.postCount ?? null,
          source: fileName,
        },
      ])
      setText('')
      setError(null)
    } catch (e) {
      setError({ message: e.message, details: e.details ?? [] })
    }
  }

  function removeEntry(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  function save() {
    onSave(
      entries.map(({ label, usernames, method, profiles, postCount, source }) => ({
        label,
        usernames,
        method,
        profiles,
        postCount,
        source,
      })),
    )
  }

  const totalPeople = new Set(entries.flatMap((e) => e.usernames.map((u) => u.toLowerCase()))).size
  const totalAvatars = new Set(entries.flatMap((e) => Object.keys(e.profiles ?? {}))).size

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">“Liked by” data (optional)</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Paste the JSON your own browser fetched for the “Liked by” lists of your recent posts — one paste
          from the snippet below covers your last 3 posts. Anyone in these lists is marked{' '}
          <span className="text-emerald-400">Interacted</span>; everyone else is{' '}
          <span className="text-red-400">No interaction</span>. Skip this and everyone is just{' '}
          <span className="text-zinc-300">Unknown</span>.
        </p>
      </div>

      <details className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
        <summary className="cursor-pointer font-semibold text-zinc-200">How do I capture it?</summary>
        <ol className="mt-2 list-decimal pl-5 space-y-1 text-zinc-400">
          <li>Open instagram.com in a desktop browser, logged in as you</li>
          <li>Open DevTools → Network tab (filter: <code>likers</code> or <code>XHR</code>)</li>
          <li>Open one of your posts and click “Liked by …”</li>
          <li>Click the request that appears → Response tab → copy the whole JSON</li>
          <li>Paste it below (or save it as a .json file and upload it)</li>
        </ol>
        <p className="mt-2 text-xs text-zinc-500">
          The parser doesn't assume an exact structure — it collects every <code>"username"</code> field it
          finds, and shows you the raw keys if it finds none.
        </p>
      </details>

      <SnippetHelper />

      {/* Single paste box — parse as many blobs as you like; each adds to the list */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
        <div className="font-semibold text-sm">Paste “Liked by” JSON</div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          placeholder='Paste the bundle (or a single "Liked by" response) here…'
          rows={3}
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 p-2 text-xs font-mono placeholder:text-zinc-600"
        />
        <div className="flex gap-2">
          <button
            onClick={() => addBlob(text)}
            disabled={!text.trim()}
            className="flex-1 py-2 rounded-lg bg-zinc-800 text-sm font-semibold disabled:opacity-40 active:bg-zinc-700"
          >
            Parse &amp; add
          </button>
          <label className="flex-1 py-2 rounded-lg bg-zinc-800 text-sm font-semibold text-center cursor-pointer active:bg-zinc-700">
            Upload .json
            <input
              type="file"
              accept=".json,.txt,application/json,text/plain"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) addBlob(await file.text(), file.name)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 p-2 text-xs">
            <div className="font-semibold text-red-300">⚠ {error.message}</div>
            {error.details.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-red-200/80 break-all">
                {error.details.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3 space-y-2">
          <div className="text-sm text-emerald-300">
            ✓ {totalPeople} unique {totalPeople === 1 ? 'person' : 'people'}
            {totalAvatars > 0 && ` · ${totalAvatars} with avatars`}
          </div>
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-zinc-300 truncate">
                  {e.label} — {e.usernames.length} usernames
                  {e.method === 'text-scan' && <span className="text-amber-300"> (text scan)</span>}
                </span>
                <button
                  onClick={() => removeEntry(e.id)}
                  className="shrink-0 text-zinc-500 underline active:text-zinc-300"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
          {totalAvatars < totalPeople && (
            <p className="text-[11px] text-zinc-500">
              Cards show a photo only for people whose avatar is in this data. For avatars on{' '}
              <i>everyone</i> (not just likers), import your lists with the followers/following snippet on
              the Import step.
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <button
          onClick={save}
          disabled={entries.length === 0}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 font-bold text-white disabled:opacity-40 active:opacity-80"
        >
          Continue with {totalPeople} {totalPeople === 1 ? 'person' : 'people'} →
        </button>
        <button
          onClick={() => onSave([])}
          className="w-full py-3 rounded-xl border border-zinc-700 font-semibold text-zinc-300 active:bg-zinc-900"
        >
          Skip — no interaction data
        </button>
      </div>
    </div>
  )
}
