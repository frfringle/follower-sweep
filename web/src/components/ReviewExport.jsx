import { useMemo, useState } from 'react'
import { buildTxt, downloadTxt, today } from '../lib/exportTxt.js'
import { buildListRemovalSnippet } from '../lib/snippets.js'

// rows: [{ username, unfollow, removeFollower }] from the removal decisions
function AssistedActionPanel({ rows }) {
  const [action, setAction] = useState('remove')
  const [copied, setCopied] = useState(false)

  const lists = useMemo(
    () => ({
      unfollow: rows.filter((r) => r.unfollow).map((r) => r.username),
      remove: rows.filter((r) => r.removeFollower).map((r) => r.username),
    }),
    [rows],
  )
  const tabs = [
    { value: 'remove', label: `Remove follower (${lists.remove.length})`, list: 'followers' },
    { value: 'unfollow', label: `Unfollow (${lists.unfollow.length})`, list: 'following' },
  ]
  const active = tabs.find((t) => t.value === action)
  const snippet = buildListRemovalSnippet(action, lists[action])

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
  }

  return (
    <details className="rounded-xl border border-amber-900/60 bg-zinc-900/40 p-3 text-sm text-zinc-300">
      <summary className="cursor-pointer font-semibold text-zinc-200">Assisted removal (console snippet)</summary>
      <p className="mt-2 text-zinc-400">
        The one snippet that <b>changes your account</b>. Your removal picks are baked in. Open your own{' '}
        <b>{active.list}</b> list on instagram.com, paste this into the DevTools <b>Console</b> once, and it
        works through the whole list on its own — pausing a random few seconds between each (with a longer
        breather every dozen) to look human. It resolves IDs from your own list and reuses Instagram's own
        request headers, so no 403 and no per-profile lookup. Progress is saved after every removal; reload
        the tab to stop, and re-run to resume exactly where it left off.
      </p>
      <p className="mt-2 rounded-lg border border-amber-800/60 bg-amber-950/30 p-2 text-xs text-amber-300/90">
        ⚠ This is bulk automation — the behavior Instagram most aggressively “action blocks”. There's no
        guaranteed-safe speed, so the snippet paces itself, caps each run (default 80), and <b>stops the
        instant a removal returns 400/429</b>. If that happens, don't push it — wait several hours to a day,
        then re-run. Edit the pacing constants at the top of the snippet to go slower.
      </p>
      <div className="mt-2 flex rounded-lg bg-zinc-950 p-1 gap-1 text-xs">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setAction(t.value)}
            className={`flex-1 py-1.5 rounded-md font-semibold transition-colors ${
              action === t.value ? 'bg-zinc-700 text-white' : 'text-zinc-500 active:bg-zinc-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {lists[action].length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          No one is marked to {action === 'remove' ? 'remove as follower' : 'unfollow'} yet — swipe some cards
          left first.
        </p>
      ) : (
        <>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-zinc-950 border border-zinc-800 p-2 text-[10px] leading-relaxed text-zinc-300 select-all">
            {snippet}
          </pre>
          <button
            onClick={copySnippet}
            className="mt-2 w-full py-2 rounded-lg bg-zinc-800 text-sm font-semibold active:bg-zinc-700"
          >
            {copied ? '✓ Copied' : `Copy ${active.label.replace(/ \(\d+\)$/, '')} snippet`}
          </button>
        </>
      )}
    </details>
  )
}

export default function ReviewExport({
  people,
  decisions,
  onRedoSkipped,
  onClearDecisions,
  onBackToFilters,
  onBackToSwipe,
}) {
  const [msg, setMsg] = useState(null)

  const { removals, keeps, skips, rows } = useMemo(() => {
    const removals = []
    const keeps = []
    const skips = []
    for (const p of people) {
      const d = decisions[p.key]
      if (!d) continue
      if (d.verdict === 'remove') removals.push(p)
      else if (d.verdict === 'keep') keeps.push(p)
      else if (d.verdict === 'skip') skips.push(p)
    }
    const rows = removals.map((p) => {
      const d = decisions[p.key]
      let unfollow = !!d.unfollow && p.isFollowing
      let removeFollower = !!d.removeFollower && p.isFollower
      if (!unfollow && !removeFollower) {
        unfollow = p.isFollowing
        removeFollower = p.isFollower
      }
      return { username: p.username, href: p.href, unfollow, removeFollower }
    })
    return { removals, keeps, skips, rows }
  }, [people, decisions])

  const unfollowCount = rows.filter((r) => r.unfollow).length
  const removeFollowerCount = rows.filter((r) => r.removeFollower).length

  function download() {
    downloadTxt(`follower-sweep-decisions-${today()}.txt`, buildTxt(rows))
    setMsg(`Saved ${unfollowCount} to unfollow + ${removeFollowerCount} to remove as follower.`)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Review &amp; export</h2>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-red-950/60 border border-red-800 py-3">
          <div className="text-2xl font-extrabold text-red-300">{removals.length}</div>
          <div className="text-[10px] uppercase tracking-wide text-red-400/80">Remove</div>
        </div>
        <div className="rounded-xl bg-emerald-950/60 border border-emerald-800 py-3">
          <div className="text-2xl font-extrabold text-emerald-300">{keeps.length}</div>
          <div className="text-[10px] uppercase tracking-wide text-emerald-400/80">Keep</div>
        </div>
        <div className="rounded-xl bg-zinc-900 border border-zinc-700 py-3">
          <div className="text-2xl font-extrabold text-zinc-300">{skips.length}</div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Skipped</div>
        </div>
      </div>

      <button
        onClick={download}
        disabled={rows.length === 0}
        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 font-bold text-white disabled:opacity-40 active:opacity-80"
      >
        Download .txt ({unfollowCount} unfollow · {removeFollowerCount} remove follower)
      </button>
      {msg && <p className="text-xs text-emerald-400 text-center">{msg}</p>}
      <p className="text-xs text-zinc-500 text-center">
        Feed this file to <code className="text-zinc-400">queue_runner.py</code> to work through it one
        profile at a time.
      </p>

      <AssistedActionPanel rows={rows} />

      <details className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3" open={removals.length > 0 && removals.length <= 15}>
        <summary className="cursor-pointer text-sm font-semibold">Marked for removal ({removals.length})</summary>
        <ul className="mt-2 max-h-56 overflow-y-auto space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.username} className="flex items-center justify-between gap-2">
              <span className="break-all">@{r.username}</span>
              <span className="shrink-0 text-[10px] text-zinc-500">
                {[r.unfollow && 'unfollow', r.removeFollower && 'remove follower'].filter(Boolean).join(' + ')}
              </span>
            </li>
          ))}
          {rows.length === 0 && <li className="text-zinc-600">none yet</li>}
        </ul>
      </details>

      <details className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Kept ({keeps.length})</summary>
        <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 text-sm text-zinc-400">
          {keeps.map((p) => (
            <li key={p.key} className="break-all">@{p.username}</li>
          ))}
          {keeps.length === 0 && <li className="text-zinc-600">none yet</li>}
        </ul>
      </details>

      <details className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Skipped ({skips.length})</summary>
        <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 text-sm text-zinc-400">
          {skips.map((p) => (
            <li key={p.key} className="break-all">@{p.username}</li>
          ))}
          {skips.length === 0 && <li className="text-zinc-600">none</li>}
        </ul>
      </details>

      <div className="space-y-2">
        {skips.length > 0 && (
          <button
            onClick={onRedoSkipped}
            className="w-full py-3 rounded-xl border border-zinc-700 font-semibold text-zinc-200 active:bg-zinc-900"
          >
            Re-swipe the {skips.length} skipped
          </button>
        )}
        <button
          onClick={onBackToSwipe}
          className="w-full py-3 rounded-xl border border-zinc-700 font-semibold text-zinc-200 active:bg-zinc-900"
        >
          Back to swiping
        </button>
        <button
          onClick={onBackToFilters}
          className="w-full py-3 rounded-xl border border-zinc-700 font-semibold text-zinc-200 active:bg-zinc-900"
        >
          Back to filters
        </button>
        <button
          onClick={onClearDecisions}
          className="w-full py-2 text-xs text-red-400/80 underline active:text-red-300"
        >
          Clear all decisions
        </button>
      </div>
    </div>
  )
}
