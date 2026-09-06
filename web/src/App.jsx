import { useEffect, useMemo, useState } from 'react'
import ImportStep from './components/ImportStep.jsx'
import LikedByStep from './components/LikedByStep.jsx'
import Dashboard from './components/Dashboard.jsx'
import SwipeDeck from './components/SwipeDeck.jsx'
import ReviewExport from './components/ReviewExport.jsx'
import { loadState, saveState, clearState } from './lib/storage.js'
import { buildPeople, buildLikedBySet, buildProfileMap, matchesFilters } from './lib/model.js'
import { mergeImportData } from './lib/instagramParser.js'

const STEPS = [
  { id: 'import', label: 'Import' },
  { id: 'likedby', label: 'Likes' },
  { id: 'dashboard', label: 'Filter' },
  { id: 'swipe', label: 'Swipe' },
  { id: 'review', label: 'Export' },
]

const DEFAULT_FILTERS = { scope: 'both', noInteractionOnly: false }

export default function App() {
  const [persisted] = useState(() => loadState())
  const [data, setData] = useState(persisted?.data ?? null)
  const [likedPosts, setLikedPosts] = useState(persisted?.likedPosts ?? [])
  const [decisions, setDecisions] = useState(persisted?.decisions ?? {})
  const [filters, setFilters] = useState(persisted?.filters ?? DEFAULT_FILTERS)
  const [history, setHistory] = useState(persisted?.history ?? [])
  const [screen, setScreen] = useState(persisted?.screen && persisted?.data ? persisted.screen : 'import')

  useEffect(() => {
    saveState({ data, likedPosts, decisions, filters, history, screen })
  }, [data, likedPosts, decisions, filters, history, screen])

  const people = useMemo(() => (data ? buildPeople(data.followers, data.following) : []), [data])
  const likedBySet = useMemo(() => buildLikedBySet(likedPosts), [likedPosts])
  // data (follow snippet) and likedPosts both carry a .profiles map — merge them all
  const profileMap = useMemo(() => buildProfileMap([data ?? {}, ...likedPosts]), [data, likedPosts])
  const hasLikedByData = likedPosts.some((p) => p?.usernames?.length > 0)

  const matching = useMemo(
    () => people.filter((p) => matchesFilters(p, filters, likedBySet, hasLikedByData)),
    [people, filters, likedBySet, hasLikedByData],
  )
  const queue = useMemo(() => matching.filter((p) => !decisions[p.key]), [matching, decisions])

  function decide(person, verdict, opts = {}) {
    setDecisions((prev) => ({ ...prev, [person.key]: { verdict, ...opts, at: Date.now() } }))
    setHistory((prev) => [...prev, person.key])
  }

  const canUndo = history.some((k) => decisions[k])

  function undo() {
    const next = [...history]
    let key = null
    while (next.length > 0) {
      const k = next.pop()
      if (decisions[k]) {
        key = k
        break
      }
    }
    setHistory(next)
    if (key) {
      setDecisions((prev) => {
        const copy = { ...prev }
        delete copy[key]
        return copy
      })
    }
  }

  function clearDecisions() {
    if (!window.confirm('Clear all Keep/Remove/Skip decisions? Your imported lists stay.')) return
    setDecisions({})
    setHistory([])
  }

  function redoSkipped() {
    const skippedKeys = new Set(Object.entries(decisions).filter(([, d]) => d.verdict === 'skip').map(([k]) => k))
    setDecisions((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !skippedKeys.has(k))))
    setHistory((prev) => prev.filter((k) => !skippedKeys.has(k)))
    setScreen('swipe')
  }

  function resetAll() {
    if (!window.confirm('Delete ALL imported data, liked-by lists and decisions?')) return
    clearState()
    setData(null)
    setLikedPosts([])
    setDecisions({})
    setFilters(DEFAULT_FILTERS)
    setHistory([])
    setScreen('import')
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800">
        <div className="max-w-md mx-auto px-3 pt-3 pb-2">
          <h1 className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-fuchsia-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
            Follower Sweep
          </h1>
          <nav className="mt-2 flex gap-1">
            {STEPS.map((s, i) => {
              const enabled = s.id === 'import' || data !== null
              const active = screen === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => enabled && setScreen(s.id)}
                  disabled={!enabled}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white'
                      : enabled
                        ? 'bg-zinc-900 text-zinc-400 active:bg-zinc-800'
                        : 'bg-zinc-900/50 text-zinc-700'
                  }`}
                >
                  {i + 1}·{s.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto px-3 py-4">
        {screen === 'import' && (
          <ImportStep
            data={data}
            onParsed={(res) => setData((prev) => mergeImportData(prev, res))}
            onContinue={() => setScreen('likedby')}
          />
        )}
        {screen === 'likedby' && data && (
          <LikedByStep
            likedPosts={likedPosts}
            onSave={(posts) => {
              setLikedPosts(posts)
              setScreen('dashboard')
            }}
          />
        )}
        {screen === 'dashboard' && data && (
          <Dashboard
            people={people}
            matching={matching}
            queue={queue}
            filters={filters}
            setFilters={setFilters}
            likedBySet={likedBySet}
            hasLikedByData={hasLikedByData}
            decisions={decisions}
            onStartSwipe={() => setScreen('swipe')}
            onReview={() => setScreen('review')}
            onResetAll={resetAll}
          />
        )}
        {screen === 'swipe' && data && (
          <SwipeDeck
            queue={queue}
            total={matching.length}
            decidedCount={matching.length - queue.length}
            likedBySet={likedBySet}
            hasLikedByData={hasLikedByData}
            profiles={profileMap}
            onDecide={decide}
            onUndo={undo}
            canUndo={canUndo}
            onOpenReview={() => setScreen('review')}
            onOpenFilters={() => setScreen('dashboard')}
          />
        )}
        {screen === 'review' && data && (
          <ReviewExport
            people={people}
            decisions={decisions}
            onRedoSkipped={redoSkipped}
            onClearDecisions={clearDecisions}
            onBackToFilters={() => setScreen('dashboard')}
            onBackToSwipe={() => setScreen('swipe')}
          />
        )}
      </main>
    </div>
  )
}
