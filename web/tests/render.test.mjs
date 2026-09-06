// Bundles render-harness.jsx with esbuild, then SSR-renders every screen and
// asserts key content shows up. Run: node tests/render.test.mjs (from web/).
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const outfile = path.join(here, '.build', 'harness.mjs')

await build({
  entryPoints: [path.join(here, 'render-harness.jsx')],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  outfile,
  external: ['react', 'react-dom', 'react-dom/server', 'jszip'],
  logLevel: 'silent',
})

const { renderAll } = await import(outfile)
const html = renderAll()
// React SSR inserts <!-- --> between adjacent text nodes ("@" + {username});
// strip them so needles like "@alice" match.
for (const k of Object.keys(html)) html[k] = html[k].replaceAll('<!-- -->', '')

const checks = [
  ['app', 'Follower Sweep'],
  ['app', 'Import your Instagram export'],
  ['importStep', 'Import successful'],
  ['likedBy', 'Liked by'],
  ['dashboard', 'match current filters'],
  ['dashboard', 'Start swiping'],
  ['swipe', '@alice'],
  ['swipe', 'Remove as follower'],
  ['swipe', 'KEEP'],
  ['swipeEmpty', 'No more cards'],
  ['review', '@bob'],
  ['review', 'unfollow + remove follower'],
  ['review', 'Download .txt'],
  ['review', 'Assisted removal'],
  ['review', 'friendships/remove_follower/'],
  ['review', 'followerSweep.assist.remove'], // the baked list-removal snippet rendered
]

let passed = 0
for (const [screen, needle] of checks) {
  try {
    assert.ok(html[screen].includes(needle), `expected "${needle}" in ${screen}`)
    passed++
    console.log(`  ok — ${screen} renders "${needle}"`)
  } catch (e) {
    console.error(`  FAIL — ${e.message}`)
    process.exitCode = 1
  }
}
console.log(`\n${passed}/${checks.length} render checks passed`)
