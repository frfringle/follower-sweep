// SSR smoke harness: renders every screen with realistic props to catch
// component wiring errors. Bundled by render.test.mjs via esbuild.
import { renderToString } from 'react-dom/server'
import App from '../src/App.jsx'
import ImportStep from '../src/components/ImportStep.jsx'
import LikedByStep from '../src/components/LikedByStep.jsx'
import Dashboard from '../src/components/Dashboard.jsx'
import SwipeDeck from '../src/components/SwipeDeck.jsx'
import ReviewExport from '../src/components/ReviewExport.jsx'
import { buildPeople, buildLikedBySet } from '../src/lib/model.js'

const followers = [
  { username: 'alice', href: 'https://www.instagram.com/alice/', timestamp: 1700000000 },
  { username: 'bob', href: 'https://www.instagram.com/bob/', timestamp: 1710000000 },
]
const following = [
  { username: 'bob', href: 'https://www.instagram.com/bob/', timestamp: 1600000000 },
  { username: 'dave', href: 'https://www.instagram.com/dave/', timestamp: 1610000000 },
]
const people = buildPeople(followers, following)
const likedBySet = buildLikedBySet([{ usernames: ['alice'] }])
const filters = { scope: 'both', noInteractionOnly: false }
const decisions = {
  alice: { verdict: 'keep', at: 1 },
  bob: { verdict: 'remove', unfollow: true, removeFollower: true, at: 2 },
  dave: { verdict: 'skip', at: 3 },
}
const noop = () => {}

export function renderAll() {
  return {
    app: renderToString(<App />),
    importStep: renderToString(
      <ImportStep data={{ followers, following, warnings: ['w1'], sources: ['followers_1.json → followers (2)'] }} onParsed={noop} onContinue={noop} />,
    ),
    likedBy: renderToString(<LikedByStep likedPosts={[{ usernames: ['alice'], method: 'json' }]} onSave={noop} />),
    dashboard: renderToString(
      <Dashboard
        people={people}
        matching={people}
        queue={people}
        filters={filters}
        setFilters={noop}
        likedBySet={likedBySet}
        hasLikedByData={true}
        decisions={{}}
        onStartSwipe={noop}
        onReview={noop}
        onResetAll={noop}
      />,
    ),
    swipe: renderToString(
      <SwipeDeck
        queue={people}
        total={people.length}
        decidedCount={0}
        likedBySet={likedBySet}
        hasLikedByData={true}
        onDecide={noop}
        onUndo={noop}
        canUndo={false}
        onOpenReview={noop}
        onOpenFilters={noop}
      />,
    ),
    swipeEmpty: renderToString(
      <SwipeDeck
        queue={[]}
        total={3}
        decidedCount={3}
        likedBySet={likedBySet}
        hasLikedByData={false}
        onDecide={noop}
        onUndo={noop}
        canUndo={true}
        onOpenReview={noop}
        onOpenFilters={noop}
      />,
    ),
    review: renderToString(
      <ReviewExport
        people={people}
        decisions={decisions}
        onRedoSkipped={noop}
        onClearDecisions={noop}
        onBackToFilters={noop}
        onBackToSwipe={noop}
      />,
    ),
  }
}
