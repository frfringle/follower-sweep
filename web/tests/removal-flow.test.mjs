// Executes the GENERATED removal snippets against a mocked Instagram and
// asserts their runtime behaviour. The unit tests in parsers.test.mjs only
// inspect the snippet text; every bug this file guards against shipped past
// that kind of check, so the behaviour is pinned here instead.
//
// Run: node tests/removal-flow.test.mjs   (from web/)
import assert from 'node:assert/strict'
import { buildListRemovalSnippet } from '../src/lib/snippets.js'

const PAGE_HTML = 'x["DTSGInitialData",[],{"token":"TESTDTSG123"},999]x'
const mockDoc = {
  cookie: 'ds_user_id=42; csrftoken=TOK',
  documentElement: { innerHTML: PAGE_HTML },
  querySelector: () => null,
}

// Runs one snippet. `list` is what the followers/following endpoint returns,
// `postBody` is what the write endpoint replies with. Returns what happened.
async function run({ action = 'remove', targets, list, postBody = '{"status":"ok"}', postStatus = 200, store = {} }) {
  const listKind = action === 'remove' ? 'followers' : 'following'
  const endpoint = action === 'remove' ? 'remove_follower' : 'destroy'
  const logs = []
  const posted = []
  const bodies = []

  const fetchMock = async (url, opts = {}) => {
    const headers = { get: (h) => (h === 'content-type' ? 'application/json' : 'hmac.CLAIM') }
    if (url.includes('/friendships/') && url.includes('/' + listKind + '/')) {
      return { ok: true, status: 200, headers, json: async () => ({ users: list }), text: async () => JSON.stringify({ users: list }) }
    }
    if (url.includes('/' + endpoint + '/')) {
      posted.push(url.match(new RegExp(endpoint + '\\/([^/]+)'))[1])
      bodies.push(opts.body ?? null)
      return { ok: postStatus < 400, status: postStatus, headers, text: async () => postBody }
    }
    return { ok: false, status: 404, headers, text: async () => '{}' }
  }

  const snippet = buildListRemovalSnippet(action, targets)
    .trim().replace(/;\s*$/, '')
    .replace(/const MIN_GAP = \d+, MAX_GAP = \d+;/, 'const MIN_GAP = 1, MAX_GAP = 2;')
    .replace(/const COOLDOWN_EVERY = \d+, COOLDOWN = \[\d+, \d+\];/, 'const COOLDOWN_EVERY = 999, COOLDOWN = [1, 2];')
    .replace(/await wait\(400\);/, 'await wait(1);')

  const fn = new Function('fetch', 'document', 'localStorage', 'console', 'return (' + snippet + ')')
  await fn(
    fetchMock,
    mockDoc,
    { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v }, removeItem: (k) => { delete store[k] } },
    { log: (...a) => logs.push(a.join(' ')) },
  )
  return { logs, posted, bodies, store, done: JSON.parse(store['followerSweep.assist.' + action] || '[]') }
}

const U = (name, pk) => ({ username: name, pk })
let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok — ${name}`)
  } catch (e) {
    console.error(`  FAIL — ${name}\n    ${e.message}`)
    process.exitCode = 1
  }
}

await test('removes each target and records progress', async () => {
  const r = await run({ targets: ['aa', 'bb'], list: [U('aa', '1'), U('bb', '2'), U('zz', '9')] })
  assert.deepEqual(r.posted, ['1', '2'])
  assert.deepEqual(r.done.sort(), ['aa', 'bb'])
})

await test('HTTP 200 with a fail body marks NOBODY done and halts', async () => {
  // the silent no-op: Instagram soft-blocks with 200 + {"status":"fail"}
  const r = await run({ targets: ['aa', 'bb'], list: [U('aa', '1'), U('bb', '2')],
                        postBody: '{"status":"fail","feedback_required":true}' })
  assert.equal(r.posted.length, 1, 'should stop after the first failure')
  assert.deepEqual(r.done, [], 'a failed action must never be marked done')
  assert.ok(r.logs.some((l) => l.includes('feedback_required')), 'should surface the raw body')
})

await test('targets absent from a COMPLETE index are marked done without a write', async () => {
  const r = await run({ targets: ['aa', 'ghost'], list: [U('aa', '1')] })
  assert.deepEqual(r.posted, ['1'], 'must not POST for someone not in the list')
  assert.deepEqual(r.done.sort(), ['aa', 'ghost'])
})

await test('resuming skips who is already done', async () => {
  const r = await run({ targets: ['aa', 'bb'], list: [U('aa', '1'), U('bb', '2')],
                        store: { 'followerSweep.assist.remove': JSON.stringify(['aa']) } })
  assert.deepEqual(r.posted, ['2'])
})

await test('unfollow sends the fb_dtsg body that destroy requires', async () => {
  const r = await run({ action: 'unfollow', targets: ['aa'], list: [U('aa', '7')] })
  const body = r.bodies[0] || ''
  assert.deepEqual(r.posted, ['7'])
  assert.ok(body.includes('fb_dtsg=TESTDTSG123'), 'missing fb_dtsg: ' + body)
  assert.ok(/jazoest=2\d+/.test(body), 'missing jazoest: ' + body)
  assert.ok(body.includes('user_id=7'), 'missing user_id: ' + body)
})

await test('remove_follower still sends no body (the known-good path)', async () => {
  const r = await run({ targets: ['aa'], list: [U('aa', '7')] })
  assert.equal(r.bodies[0], null, 'remove_follower must keep posting an empty body')
})

await test('the two actions are order independent', async () => {
  // A mutual marked for both. Removing them as a follower must not affect the
  // ability to unfollow them, and vice versa: the relationships are separate
  // edges, read from separate lists, tracked under separate storage keys.
  const shared = {}

  const removeFirst = await run({ action: 'remove', targets: ['mutual'], list: [U('mutual', '5')], store: shared })
  assert.deepEqual(removeFirst.posted, ['5'], 'remove should act')

  // following list still contains them: removing a follower does not unfollow
  const thenUnfollow = await run({ action: 'unfollow', targets: ['mutual'], list: [U('mutual', '5')], store: shared })
  assert.deepEqual(thenUnfollow.posted, ['5'], 'unfollow must still work after a remove')

  assert.deepEqual(JSON.parse(shared['followerSweep.assist.remove']), ['mutual'])
  assert.deepEqual(JSON.parse(shared['followerSweep.assist.unfollow']), ['mutual'])

  // and the reverse order, from clean state
  const other = {}
  const unfollowFirst = await run({ action: 'unfollow', targets: ['mutual'], list: [U('mutual', '5')], store: other })
  const thenRemove = await run({ action: 'remove', targets: ['mutual'], list: [U('mutual', '5')], store: other })
  assert.deepEqual(unfollowFirst.posted, ['5'], 'unfollow should act')
  assert.deepEqual(thenRemove.posted, ['5'], 'remove must still work after an unfollow')
})

await test('one action never consumes the other\'s saved progress', async () => {
  // remove having finished must not make unfollow think it is done
  const store = { 'followerSweep.assist.remove': JSON.stringify(['aa']) }
  const r = await run({ action: 'unfollow', targets: ['aa'], list: [U('aa', '3')], store })
  assert.deepEqual(r.posted, ['3'], 'unfollow must ignore the remove key')
})

console.log(`\n${passed} removal-flow checks passed`)
