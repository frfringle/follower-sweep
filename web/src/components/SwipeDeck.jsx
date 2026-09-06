import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { interactionOf } from '../lib/model.js'

const X_THRESHOLD = 90
const Y_THRESHOLD = 90

const INTERACTION_BADGE = {
  interacted: { label: '✓ Interacted', cls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700' },
  none: { label: '✕ No interaction', cls: 'bg-red-900/60 text-red-300 border-red-700' },
  unknown: { label: '? Interaction unknown', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
}

function fmtDate(ts) {
  if (!ts) return null
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
}

// Real avatar when the liked-by data gave us a profile_pic_url (no extra
// requests — it's in the likers response), letter avatar otherwise. CDN URLs
// are signed and expire after a while, so a load failure falls back too.
function Avatar({ username, pic }) {
  const [failed, setFailed] = useState(false)
  if (pic && !failed) {
    return (
      <img
        src={pic}
        alt=""
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-14 shrink-0 rounded-full object-cover border border-zinc-700"
      />
    )
  }
  return (
    <div className="size-14 shrink-0 rounded-full bg-gradient-to-br from-fuchsia-600 via-pink-600 to-amber-500 flex items-center justify-center text-xl font-black text-white">
      {username?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

const SwipeCard = forwardRef(function SwipeCard({ person, profile, interaction, isTop, depth, opts, onOptsChange, onSwipe }, ref) {
  const [drag, setDrag] = useState(null)
  const [leaving, setLeaving] = useState(null)
  const startRef = useRef(null)

  useImperativeHandle(ref, () => ({ fly }))

  function fly(dir) {
    if (leaving) return
    setDrag(null)
    setLeaving(dir)
    setTimeout(() => onSwipe(dir), 200)
  }

  function onPointerDown(e) {
    if (!isTop || leaving) return
    if (e.target.closest('[data-no-drag]')) return
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ dx: 0, dy: 0 })
  }
  function onPointerMove(e) {
    const s = startRef.current
    if (!s || e.pointerId !== s.id) return
    setDrag({ dx: e.clientX - s.x, dy: e.clientY - s.y })
  }
  function onPointerEnd(e) {
    const s = startRef.current
    if (!s || e.pointerId !== s.id) return
    startRef.current = null
    const { dx, dy } = drag ?? { dx: 0, dy: 0 }
    if (dy < -Y_THRESHOLD && Math.abs(dy) > Math.abs(dx)) fly('up')
    else if (dx > X_THRESHOLD) fly('right')
    else if (dx < -X_THRESHOLD) fly('left')
    else setDrag(null)
  }

  let transform = `translateY(${depth * 12}px) scale(${1 - depth * 0.05})`
  let transition = 'transform 200ms ease, opacity 200ms ease'
  if (drag) {
    transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx * 0.06}deg)`
    transition = 'none'
  } else if (leaving) {
    transform = {
      left: 'translate(-120vw, -8vh) rotate(-25deg)',
      right: 'translate(120vw, -8vh) rotate(25deg)',
      up: 'translate(0, -120vh)',
    }[leaving]
  }

  const dx = drag?.dx ?? 0
  const dy = drag?.dy ?? 0
  const keepOp = leaving === 'right' ? 1 : Math.max(0, Math.min(1, dx / X_THRESHOLD))
  const removeOp = leaving === 'left' ? 1 : Math.max(0, Math.min(1, -dx / X_THRESHOLD))
  const skipOp = leaving === 'up' ? 1 : Math.max(0, Math.min(1, (-dy - Math.abs(dx)) / Y_THRESHOLD))

  const badge = INTERACTION_BADGE[interaction]
  const followerDate = fmtDate(person.followerSince)
  const followingDate = fmtDate(person.followingSince)

  return (
    <div
      className="absolute inset-0 touch-none select-none"
      style={{ transform, transition, zIndex: 10 - depth, opacity: leaving ? 0.5 : 1 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div className="relative h-full rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl p-5 flex flex-col overflow-hidden">
        <div className="flex flex-wrap gap-1.5">
          {person.isFollower && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-900/70 text-sky-300 border border-sky-700">
              FOLLOWER
            </span>
          )}
          {person.isFollowing && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-900/70 text-violet-300 border border-violet-700">
              FOLLOWING
            </span>
          )}
          {person.isFollower && person.isFollowing && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-600">
              MUTUAL
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Avatar username={person.username} pic={profile?.pic} />
          <div className="min-w-0">
            <div className="text-2xl font-extrabold break-all leading-tight">@{person.username}</div>
            {profile?.name && <div className="text-sm text-zinc-400 truncate">{profile.name}</div>}
            <a
              data-no-drag
              href={person.href}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-sky-400 underline break-all"
            >
              Open profile ↗
            </a>
          </div>
        </div>

        <div className="mt-3 space-y-1 text-sm text-zinc-400">
          {followerDate && <div>Follows you since {followerDate}</div>}
          {followingDate && <div>You follow since {followingDate}</div>}
          {!followerDate && !followingDate && <div>No follow dates in export</div>}
        </div>

        <span className={`mt-3 self-start px-2.5 py-1 rounded-full text-xs font-semibold border ${badge.cls}`}>
          {badge.label}
        </span>

        <div data-no-drag className="mt-auto rounded-2xl bg-zinc-800/70 p-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-2">If you swipe Remove ←</div>
          <label className={`flex items-center gap-2 py-1.5 text-sm ${person.isFollowing ? '' : 'opacity-35'}`}>
            <input
              type="checkbox"
              disabled={!person.isFollowing || !isTop}
              checked={!!opts?.unfollow}
              onChange={(e) => onOptsChange({ ...opts, unfollow: e.target.checked })}
              className="size-5 accent-fuchsia-500"
            />
            Unfollow them
          </label>
          <label className={`flex items-center gap-2 py-1.5 text-sm ${person.isFollower ? '' : 'opacity-35'}`}>
            <input
              type="checkbox"
              disabled={!person.isFollower || !isTop}
              checked={!!opts?.removeFollower}
              onChange={(e) => onOptsChange({ ...opts, removeFollower: e.target.checked })}
              className="size-5 accent-fuchsia-500"
            />
            Remove as follower
          </label>
        </div>

        {/* swipe direction overlays */}
        <div
          className="pointer-events-none absolute top-6 left-5 rotate-[-12deg] rounded-lg border-4 border-emerald-500 px-3 py-1 text-2xl font-black text-emerald-500"
          style={{ opacity: keepOp }}
        >
          KEEP
        </div>
        <div
          className="pointer-events-none absolute top-6 right-5 rotate-[12deg] rounded-lg border-4 border-red-500 px-3 py-1 text-2xl font-black text-red-500"
          style={{ opacity: removeOp }}
        >
          REMOVE
        </div>
        <div
          className="pointer-events-none absolute bottom-24 inset-x-0 mx-auto w-fit rounded-lg border-4 border-sky-500 px-3 py-1 text-2xl font-black text-sky-500"
          style={{ opacity: skipOp }}
        >
          SKIP
        </div>
      </div>
    </div>
  )
})

export default function SwipeDeck({
  queue,
  total,
  decidedCount,
  likedBySet,
  hasLikedByData,
  profiles = {},
  onDecide,
  onUndo,
  canUndo,
  onOpenReview,
  onOpenFilters,
}) {
  const topRef = useRef(null)
  const top = queue[0]
  const [opts, setOpts] = useState({ unfollow: false, removeFollower: false })

  useEffect(() => {
    if (top) setOpts({ unfollow: !!top.isFollowing, removeFollower: !!top.isFollower })
  }, [top?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  function commit(dir) {
    if (!top) return
    if (dir === 'right') {
      onDecide(top, 'keep')
    } else if (dir === 'up') {
      onDecide(top, 'skip')
    } else {
      let unfollow = !!opts.unfollow && top.isFollowing
      let removeFollower = !!opts.removeFollower && top.isFollower
      if (!unfollow && !removeFollower) {
        // nothing ticked — fall back to every action that applies
        unfollow = top.isFollowing
        removeFollower = top.isFollower
      }
      onDecide(top, 'remove', { unfollow, removeFollower })
    }
  }

  const pct = total > 0 ? Math.round((decidedCount / total) * 100) : 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-400">
          {decidedCount} of {total} decided
        </span>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs font-semibold disabled:opacity-40 active:bg-zinc-800"
        >
          ↩ Undo
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-pink-500 to-amber-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="relative h-[min(58dvh,470px)]">
        {queue.length === 0 ? (
          <div className="h-full rounded-3xl border border-zinc-800 bg-zinc-900/50 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="text-4xl">🎉</div>
            <div className="font-bold">No more cards in this filter</div>
            <button
              onClick={onOpenReview}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 font-bold text-white active:opacity-80"
            >
              Review &amp; export
            </button>
            <button
              onClick={onOpenFilters}
              className="w-full py-3 rounded-xl border border-zinc-700 font-semibold text-zinc-300 active:bg-zinc-900"
            >
              Back to filters
            </button>
          </div>
        ) : (
          queue.slice(0, 3).map((p, i) => (
            <SwipeCard
              key={p.key}
              ref={i === 0 ? topRef : null}
              person={p}
              profile={profiles[p.key]}
              depth={i}
              isTop={i === 0}
              interaction={interactionOf(p, likedBySet, hasLikedByData)}
              opts={i === 0 ? opts : null}
              onOptsChange={setOpts}
              onSwipe={commit}
            />
          ))
        )}
      </div>

      {queue.length > 0 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={() => topRef.current?.fly('left')}
            className="flex-1 max-w-32 py-3.5 rounded-2xl bg-red-950 border-2 border-red-700 text-red-300 font-bold active:bg-red-900"
          >
            ✕ Remove
          </button>
          <button
            onClick={() => topRef.current?.fly('up')}
            className="flex-1 max-w-24 py-3.5 rounded-2xl bg-zinc-900 border-2 border-zinc-700 text-zinc-300 font-bold active:bg-zinc-800"
          >
            ⤴ Skip
          </button>
          <button
            onClick={() => topRef.current?.fly('right')}
            className="flex-1 max-w-32 py-3.5 rounded-2xl bg-emerald-950 border-2 border-emerald-700 text-emerald-300 font-bold active:bg-emerald-900"
          >
            ✓ Keep
          </button>
        </div>
      )}
      <p className="text-center text-[11px] text-zinc-600">
        drag right = keep · left = remove · up = skip later
      </p>
    </div>
  )
}
