import { useMemo, useState } from 'react'
import { interactionOf } from '../lib/model.js'
import { buildTxt, downloadTxt, today } from '../lib/exportTxt.js'

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex rounded-xl bg-zinc-900 p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
            value === o.value ? 'bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white' : 'text-zinc-400 active:bg-zinc-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function Dashboard({
  people,
  matching,
  queue,
  filters,
  setFilters,
  likedBySet,
  hasLikedByData,
  decisions,
  onStartSwipe,
  onReview,
  onResetAll,
}) {
  const [exportMsg, setExportMsg] = useState(null)

  const stats = useMemo(() => {
    let interacted = 0
    let none = 0
    let unknown = 0
    for (const p of matching) {
      const s = interactionOf(p, likedBySet, hasLikedByData)
      if (s === 'interacted') interacted++
      else if (s === 'none') none++
      else unknown++
    }
    const followers = people.filter((p) => p.isFollower).length
    const following = people.filter((p) => p.isFollowing).length
    const mutual = people.filter((p) => p.isFollower && p.isFollowing).length
    return { interacted, none, unknown, followers, following, mutual }
  }, [matching, people, likedBySet, hasLikedByData])

  const decidedCount = Object.keys(decisions).length

  function exportFiltered() {
    const rows = matching.map((p) => ({
      username: p.username,
      href: p.href,
      unfollow: p.isFollowing,
      removeFollower: p.isFollower,
    }))
    downloadTxt(`follower-sweep-filtered-${today()}.txt`, buildTxt(rows))
    setExportMsg(`Exported ${matching.length} usernames (no swiping needed).`)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Filter</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {stats.followers} followers · {stats.following} following · {stats.mutual} mutual
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Who</div>
        <Segmented
          value={filters.scope}
          onChange={(scope) => setFilters((f) => ({ ...f, scope }))}
          options={[
            { value: 'both', label: 'Both' },
            { value: 'following', label: 'Following only' },
            { value: 'followers', label: 'Followers only' },
          ]}
        />
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 pt-1">Interaction</div>
        <Segmented
          value={filters.noInteractionOnly ? 'no' : 'all'}
          onChange={(v) => setFilters((f) => ({ ...f, noInteractionOnly: v === 'no' }))}
          options={[
            { value: 'all', label: 'Show everyone' },
            { value: 'no', label: 'No interaction only' },
          ]}
        />
        {!hasLikedByData && (
          <p className="text-xs text-amber-300/90">
            No “Liked by” data loaded — everyone counts as Unknown, so this filter has no effect. Add likes
            data in step 2 to use it.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-center">
        <div className="text-4xl font-extrabold bg-gradient-to-r from-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
          {matching.length}
        </div>
        <div className="text-xs uppercase tracking-wide text-zinc-500">match current filters</div>
        <div className="mt-2 flex justify-center gap-3 text-xs">
          <span className="text-emerald-400">✓ {stats.interacted} interacted</span>
          <span className="text-red-400">✕ {stats.none} no interaction</span>
          <span className="text-zinc-400">? {stats.unknown} unknown</span>
        </div>
        <div className="mt-1 text-xs text-zinc-500">{queue.length} still undecided</div>
      </div>

      <div className="space-y-2">
        <button
          onClick={onStartSwipe}
          disabled={queue.length === 0}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 font-bold text-white disabled:opacity-40 active:opacity-80"
        >
          Start swiping ({queue.length} cards)
        </button>
        <button
          onClick={exportFiltered}
          disabled={matching.length === 0}
          className="w-full py-3 rounded-xl border border-zinc-700 font-semibold text-zinc-200 disabled:opacity-40 active:bg-zinc-900"
        >
          Export filtered list as-is (.txt, no swiping)
        </button>
        {exportMsg && <p className="text-xs text-emerald-400 text-center">{exportMsg}</p>}
        {decidedCount > 0 && (
          <button
            onClick={onReview}
            className="w-full py-3 rounded-xl border border-zinc-700 font-semibold text-zinc-200 active:bg-zinc-900"
          >
            Review decisions ({decidedCount})
          </button>
        )}
        <button onClick={onResetAll} className="w-full py-2 text-xs text-red-400/80 underline active:text-red-300">
          Reset all data
        </button>
      </div>
    </div>
  )
}
