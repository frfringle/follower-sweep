// Plain-node smoke tests for the parsing/model/export logic.
// Run: node tests/parsers.test.mjs   (from the web/ directory, after npm install)
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { parseRelationshipJson, parseExportFiles, parseFollowSnippetBlob, mergeImportData, ParseError } from '../src/lib/instagramParser.js'
import { parseLikedByBlob } from '../src/lib/likedByParser.js'
import { buildPeople, buildLikedBySet, buildProfileMap, interactionOf, matchesFilters } from '../src/lib/model.js'
import { buildTxt } from '../src/lib/exportTxt.js'
import { shortcodeToMediaId, mediaIdToShortcode, postUrlToMediaId } from '../src/lib/mediaId.js'
import { buildLikersSnippet, buildAllPostsSnippet, buildFollowSnippet, buildListRemovalSnippet } from '../src/lib/snippets.js'

let passed = 0
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ok — ${name}`)
    })
    .catch((e) => {
      console.error(`  FAIL — ${name}\n    ${e.message}`)
      process.exitCode = 1
    })
}

const followersJson = JSON.stringify([
  { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/alice', value: 'alice', timestamp: 1700000000 }] },
  { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/bob', value: 'bob', timestamp: 1710000000 }] },
  { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/carol', value: 'carol', timestamp: 1720000000 }] },
])

const followingJson = JSON.stringify({
  relationships_following: [
    { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/bob', value: 'bob', timestamp: 1600000000 }] },
    { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/dave', value: 'dave', timestamp: 1610000000 }] },
  ],
})

await test('parses followers_1.json (bare array shape)', () => {
  const r = parseRelationshipJson(followersJson, 'followers_1.json')
  assert.equal(r.people.length, 3)
  assert.equal(r.people[0].username, 'alice')
  assert.equal(r.people[0].href, 'https://www.instagram.com/alice')
  assert.equal(r.people[0].timestamp, 1700000000)
  assert.equal(r.shape, 'array')
})

await test('parses following.json (relationships_following wrapper)', () => {
  const r = parseRelationshipJson(followingJson, 'following.json')
  assert.equal(r.people.length, 2)
  assert.equal(r.wrapperKey, 'relationships_following')
})

await test('parses real-world following.json shape (no "value", username on entry.title, /_u/ href)', () => {
  const realFollowing = JSON.stringify({
    relationships_following: [
      { title: 'jaclynnntang', string_list_data: [{ href: 'https://www.instagram.com/_u/jaclynnntang', timestamp: 1783368574 }] },
      { title: 'ste_vnl', string_list_data: [{ href: 'https://www.instagram.com/_u/ste_vnl', timestamp: 1783357697 }] },
    ],
  })
  const r = parseRelationshipJson(realFollowing, 'following.json')
  assert.equal(r.people.length, 2)
  assert.equal(r.people[0].username, 'jaclynnntang')
  assert.equal(r.people[0].href, 'https://www.instagram.com/jaclynnntang/')
  assert.equal(r.people[0].timestamp, 1783368574)
  assert.equal(r.skipped, 0)
})

await test('unknown wrapper key still found if entries look right', () => {
  const alt = JSON.stringify({ some_future_key: JSON.parse(followersJson) })
  const r = parseRelationshipJson(alt, 'x.json')
  assert.equal(r.people.length, 3)
  assert.equal(r.wrapperKey, 'some_future_key')
})

await test('clear error on malformed structure, includes keys + expected format', () => {
  assert.throws(
    () => parseRelationshipJson(JSON.stringify({ foo: 1, bar: 'x' }), 'weird.json'),
    (e) => e instanceof ParseError && /Top-level keys found: foo, bar/.test(e.details.join('\n')) && /string_list_data/.test(e.details.join('\n')),
  )
})

await test('clear error on invalid JSON', () => {
  assert.throws(() => parseRelationshipJson('not json {', 'f.json'), (e) => e instanceof ParseError && /not valid JSON/.test(e.message))
})

await test('entries missing usernames are skipped and counted', () => {
  const withBad = JSON.stringify([JSON.parse(followersJson)[0], { string_list_data: [] }, { nope: true }])
  const r = parseRelationshipJson(withBad, 'followers_1.json')
  assert.equal(r.people.length, 1)
  assert.equal(r.skipped, 2)
})

await test('parseExportFiles reads a full export zip', async () => {
  const zip = new JSZip()
  zip.file('connections/followers_and_following/followers_1.json', followersJson)
  zip.file('connections/followers_and_following/following.json', followingJson)
  zip.file('connections/followers_and_following/close_friends.json', '[]')
  const buf = await zip.generateAsync({ type: 'uint8array' })
  const file = new File([buf], 'instagram-export.zip')
  const r = await parseExportFiles([file])
  assert.equal(r.followers.length, 3)
  assert.equal(r.following.length, 2)
})

await test('parseExportFiles errors helpfully on zip without follow files', async () => {
  const zip = new JSZip()
  zip.file('media/posts_1.json', '[]')
  const buf = await zip.generateAsync({ type: 'uint8array' })
  await assert.rejects(parseExportFiles([new File([buf], 'export.zip')]), (e) => /JSON format/.test(e.details.join('\n')))
})

await test('parseExportFiles handles separate json files by name', async () => {
  const r = await parseExportFiles([
    new File([followersJson], 'followers_1.json'),
    new File([followingJson], 'following.json'),
  ])
  assert.equal(r.followers.length, 3)
  assert.equal(r.following.length, 2)
})

await test('liked-by: GraphQL-style nested structure', () => {
  const blob = JSON.stringify({
    data: { 'xdt_api__v1__media__media_id__likers': { users: [{ pk: '1', username: 'alice', full_name: 'A' }, { pk: '2', username: 'zed' }] } },
    extensions: { is_final: true },
  })
  const r = parseLikedByBlob(blob)
  assert.deepEqual(new Set(r.usernames), new Set(['alice', 'zed']))
  assert.equal(r.method, 'json')
})

await test('liked-by: old REST style { users: [...] }', () => {
  const r = parseLikedByBlob(JSON.stringify({ users: [{ username: 'bob' }], user_count: 1, status: 'ok' }))
  assert.deepEqual(r.usernames, ['bob'])
})

await test('liked-by: text-scan fallback on truncated JSON', () => {
  const r = parseLikedByBlob('{"users":[{"username":"alice"},{"username":"bob"}')
  assert.deepEqual(new Set(r.usernames), new Set(['alice', 'bob']))
  assert.equal(r.method, 'text-scan')
})

await test('liked-by: error shows raw keys when no usernames found', () => {
  assert.throws(
    () => parseLikedByBlob(JSON.stringify({ data: { weird_key: [] }, status: 'ok' })),
    (e) => e instanceof ParseError && /Top-level keys: data, status/.test(e.details.join('\n')) && /"data" keys: weird_key/.test(e.details.join('\n')),
  )
})

await test('model: merge + interaction + filters', () => {
  const followers = JSON.parse(followersJson).map((e) => ({ username: e.string_list_data[0].value, href: e.string_list_data[0].href, timestamp: e.string_list_data[0].timestamp }))
  const following = JSON.parse(followingJson).relationships_following.map((e) => ({ username: e.string_list_data[0].value, href: e.string_list_data[0].href, timestamp: e.string_list_data[0].timestamp }))
  const people = buildPeople(followers, following)
  assert.equal(people.length, 4) // alice, bob (mutual), carol, dave
  const bob = people.find((p) => p.key === 'bob')
  assert.ok(bob.isFollower && bob.isFollowing)
  assert.equal(bob.followerSince, 1710000000)
  assert.equal(bob.followingSince, 1600000000)

  const likedBySet = buildLikedBySet([{ usernames: ['Alice'] }]) // case-insensitive
  assert.equal(interactionOf(people.find((p) => p.key === 'alice'), likedBySet, true), 'interacted')
  assert.equal(interactionOf(bob, likedBySet, true), 'none')
  assert.equal(interactionOf(bob, likedBySet, false), 'unknown')

  const f = { scope: 'following', noInteractionOnly: true }
  const matched = people.filter((p) => matchesFilters(p, f, likedBySet, true))
  assert.deepEqual(matched.map((p) => p.key), ['bob', 'dave']) // following & not interacted

  // no liked-by data: unknown passes the no-interaction filter
  const matchedNoData = people.filter((p) => matchesFilters(p, f, new Set(), false))
  assert.equal(matchedNoData.length, 2)
})

await test('media id: shortcode <-> id round-trip against a real likers URL', () => {
  // real capture: clicking "Liked by" on instagram.com/p/DaU88w7lfQ7/ hit
  // /api/v1/media/3933036433099846715/likers/
  assert.equal(shortcodeToMediaId('DaU88w7lfQ7'), '3933036433099846715')
  assert.equal(mediaIdToShortcode('3933036433099846715'), 'DaU88w7lfQ7')
})

await test('media id: extracted from post/reel URLs, ignoring share-link suffixes', () => {
  assert.equal(postUrlToMediaId('https://www.instagram.com/p/DaU88w7lfQ7/'), '3933036433099846715')
  assert.equal(postUrlToMediaId('https://www.instagram.com/reel/DaU88w7lfQ7/?igsh=abc123'), '3933036433099846715')
  // share links append extra encoded info after the 11-char shortcode
  assert.equal(postUrlToMediaId('https://www.instagram.com/p/DaU88w7lfQ7ExtraStuff123/'), '3933036433099846715')
  assert.equal(postUrlToMediaId('https://www.instagram.com/jaclynnntang/'), null)
  assert.equal(postUrlToMediaId(''), null)
})

await test('media id: console snippet embeds hardcoded id or derives from location', () => {
  const withId = buildLikersSnippet('3933036433099846715')
  assert.ok(withId.includes("'3933036433099846715'"))
  assert.ok(withId.includes('/api/v1/media/'))
  const generic = buildLikersSnippet(null)
  assert.ok(generic.includes('location.pathname'))
  assert.ok(generic.includes('/api/v1/media/'))
})

await test('every generated snippet sends the full anti-403 header set and is valid JS', () => {
  // A snippet returning 403 with only x-ig-app-id is the bug we're guarding
  // against: assert each read/write snippet carries the headers Instagram's own
  // web JS attaches, and that the spliced code strings actually parse.
  const snippets = [
    buildLikersSnippet('123'),
    buildLikersSnippet(null),
    buildAllPostsSnippet(3),
    buildFollowSnippet(),
    buildListRemovalSnippet('remove', ['bob']),
    buildListRemovalSnippet('unfollow', ['bob']),
  ]
  for (const s of snippets) {
    assert.ok(s.includes("'x-ig-app-id': '936619743392459'"), 'missing x-ig-app-id')
    assert.ok(s.includes("'x-asbd-id'"), 'missing x-asbd-id')
    assert.ok(s.includes("'x-requested-with': 'XMLHttpRequest'"), 'missing x-requested-with')
    assert.ok(s.includes("'x-csrftoken': csrf"), 'missing x-csrftoken')
    assert.ok(s.includes("credentials: 'include'"), 'missing credentials')
    assert.ok(s.includes('csrftoken=([^;]+)'), 'missing csrf cookie read')
    new Function(s) // throws SyntaxError if the spliced snippet is malformed
  }
})

await test('all-posts snippet: reads post links from the page, never hits feed/user', () => {
  const s = buildAllPostsSnippet(3)
  // www.instagram.com serves /api/v1/feed/user/<id>/ as an HTML shell (200
  // text/html), which is what caused "Unexpected token '<'". It must not come
  // back — post shortcodes are read from the profile grid's links instead.
  assert.ok(!s.includes('/api/v1/feed/user/'), 'regression: feed/user returns HTML, not JSON')
  assert.ok(s.includes('querySelectorAll'), 'should read post links from the page')
  assert.ok(s.includes('a[href*="/p/"]'))
  assert.ok(s.includes('BigInt'), 'shortcode -> media id conversion should be local')
  assert.ok(s.includes('/likers/'))
  assert.ok(s.includes('follower_sweep_bundle'))
})

await test('liked-by: bundle from the all-posts snippet (profiles + postCount)', () => {
  const bundle = JSON.stringify({
    follower_sweep_bundle: 1,
    posts: [
      { code: 'A1', media_id: '1', users: [{ username: 'alice', profile_pic_url: 'https://cdn.example/a.jpg', full_name: 'Alice A' }] },
      { code: 'B2', media_id: '2', users: [{ username: 'bob' }, { username: 'alice' }] },
    ],
  })
  const r = parseLikedByBlob(bundle)
  assert.deepEqual([...r.usernames].sort(), ['alice', 'bob'])
  assert.equal(r.postCount, 2)
  assert.equal(r.profiles.alice.pic, 'https://cdn.example/a.jpg')
  assert.equal(r.profiles.alice.name, 'Alice A')
  assert.equal(r.profiles.bob, undefined) // no pic/name info -> not kept
})

await test('follow snippet: paginates friendships endpoints via cookie-derived id', () => {
  const s = buildFollowSnippet()
  assert.ok(s.includes('ds_user_id'))
  assert.ok(s.includes('/api/v1/friendships/'))
  assert.ok(s.includes('next_max_id'))
  assert.ok(s.includes('follower_sweep_follows'))
})

await test('every snippet guards .json() against Instagram returning an HTML page', () => {
  // A logged-out / checkpointed / wrong-tab request comes back as HTML, often
  // with HTTP 200 — so `res.ok` passes and res.json() throws the cryptic
  // "Unexpected token '<', "<!DOCTYPE"...". Every snippet must route JSON
  // parsing through the content-type guard instead of calling .json() raw.
  const snippets = [
    buildLikersSnippet('123'),
    buildAllPostsSnippet(3),
    buildFollowSnippet(),
    buildListRemovalSnippet('remove', ['bob']),
    buildListRemovalSnippet('unfollow', ['bob']),
  ]
  for (const s of snippets) {
    assert.ok(s.includes('const asJson ='), 'missing the JSON guard helper')
    assert.ok(s.includes("ct.includes('json')"), 'guard does not check content-type')
    assert.ok(s.includes('checkpoint'), 'guard does not explain the likely cause')
    // no un-guarded .json() at the call sites (the guard's own `res.json()` is the sanctioned one)
    assert.ok(!/await (?:r|q|fr|info)\.json\(\)/.test(s), 'found a raw .json() call outside the guard')
    new Function(s)
  }
})

await test('follow snippet: embeds avatars as downscaled data URLs (CORP workaround)', () => {
  const s = buildFollowSnippet()
  // fetch the bytes here (allowed) and re-encode to a data URL the app can embed
  assert.ok(s.includes('createImageBitmap'))
  assert.ok(s.includes("toDataURL('image/jpeg'"))
  assert.ok(s.includes('canvas'))
  new Function(s) // the avatar logic must not break the snippet's JS
})

await test('follow snippet blob: parses lists, harvests avatars, warns about missing dates', () => {
  const blob = JSON.stringify({
    follower_sweep_follows: 1,
    followers: [
      { username: 'alice', full_name: 'Alice A', profile_pic_url: 'https://cdn.example/a.jpg' },
      { username: '' },
    ],
    following: [{ username: 'bob', full_name: '', profile_pic_url: '' }],
  })
  const r = parseFollowSnippetBlob(blob)
  assert.equal(r.followers.length, 1)
  assert.equal(r.followers[0].username, 'alice')
  assert.equal(r.followers[0].href, 'https://www.instagram.com/alice/')
  assert.equal(r.followers[0].timestamp, null)
  assert.equal(r.following.length, 1)
  assert.equal(r.profiles.alice.pic, 'https://cdn.example/a.jpg')
  assert.equal(r.profiles.bob, undefined)
  assert.ok(r.warnings.some((w) => w.includes('follow dates')))
  assert.ok(r.warnings.some((w) => w.includes('skipped 1')))
})

await test('follow snippet blob: clear error on wrong shape, shows keys', () => {
  assert.throws(
    () => parseFollowSnippetBlob(JSON.stringify({ users: [{ username: 'x' }] })),
    (e) => e instanceof ParseError && /Top-level keys: users/.test(e.details.join('\n')),
  )
})

await test('mergeImportData: export dates + snippet avatars survive re-imports', () => {
  const fromExport = {
    followers: [{ username: 'alice', href: 'https://www.instagram.com/alice/', timestamp: 1700000000 }],
    following: [],
    warnings: [],
    sources: ['followers_1.json'],
  }
  const fromSnippet = {
    followers: [{ username: 'alice', href: 'https://www.instagram.com/alice/', timestamp: null }],
    following: [{ username: 'bob', href: 'https://www.instagram.com/bob/', timestamp: null }],
    warnings: [],
    sources: ['console snippet'],
    profiles: { alice: { pic: 'https://cdn.example/a.jpg' } },
  }
  // export first, snippet second: timestamp carried over, avatar gained
  const merged = mergeImportData(fromExport, fromSnippet)
  assert.equal(merged.followers[0].timestamp, 1700000000)
  assert.equal(merged.profiles.alice.pic, 'https://cdn.example/a.jpg')
  assert.equal(merged.following[0].username, 'bob')
  // snippet first, export second: avatar carried over, fresh timestamp wins
  const merged2 = mergeImportData(fromSnippet, { ...fromExport, followers: [{ ...fromExport.followers[0], timestamp: 1800000000 }] })
  assert.equal(merged2.followers[0].timestamp, 1800000000)
  assert.equal(merged2.profiles.alice.pic, 'https://cdn.example/a.jpg')
  // no previous data: passthrough
  assert.equal(mergeImportData(null, fromSnippet), fromSnippet)
})

await test('list-removal snippet: right endpoints/list, bakes usernames, www-claim, throttled auto-run', () => {
  const remove = buildListRemovalSnippet('remove', ['Bob', 'CAROL', 'bob'])
  // remove-follower drives off your OWN followers list, not destroy
  assert.ok(remove.includes('/api/v1/friendships/remove_follower/'))
  assert.ok(!remove.includes('/destroy/'))
  assert.ok(remove.includes("/' + uid + '/followers/"))
  // usernames baked in, deduped + lowercased
  assert.ok(remove.includes('["bob","carol"]'))
  // www-claim is bootstrapped from Instagram's own response header, not pasted
  assert.ok(remove.includes('x-ig-set-www-claim'))
  assert.ok(remove.includes("'x-ig-www-claim': claim"))
  // runs the whole list itself, paced: randomized gaps + a per-run cap
  assert.ok(remove.includes('MIN_GAP') && remove.includes('MAX_GAP'))
  assert.ok(remove.includes('MAX_PER_RUN'))
  assert.ok(remove.includes('setTimeout')) // actually waits between actions
  // stops the instant Instagram pushes back
  assert.ok(/r\.status === 400 \|\| r\.status === 429/.test(remove))
  // resumable progress in the page's own storage
  assert.ok(remove.includes('localStorage') && remove.includes('followerSweep.assist.remove'))

  const unfollow = buildListRemovalSnippet('unfollow', ['dave'])
  assert.ok(unfollow.includes('/api/v1/friendships/destroy/'))
  assert.ok(!unfollow.includes('remove_follower'))
  assert.ok(unfollow.includes("/' + uid + '/following/")) // unfollow drives off your following list

  // empty list is a safe no-op, still valid JS
  const empty = buildListRemovalSnippet('remove', [])
  assert.ok(empty.includes('No remove follower targets baked in'))
  new Function(empty)
})

await test('model: buildProfileMap merges across posts, first pic wins', () => {
  const map = buildProfileMap([
    { profiles: { alice: { pic: 'p1' } } },
    { profiles: { alice: { pic: 'p2', name: 'Alice' }, bob: { name: 'Bob' } } },
  ])
  assert.equal(map.alice.pic, 'p1')
  assert.equal(map.alice.name, 'Alice')
  assert.equal(map.bob.name, 'Bob')
})

await test('export txt format', () => {
  const txt = buildTxt([
    { username: 'alice', href: 'https://www.instagram.com/alice/', unfollow: true, removeFollower: false },
    { username: 'bob', href: 'https://www.instagram.com/bob/', unfollow: true, removeFollower: true },
    { username: 'carol', href: 'https://www.instagram.com/carol/', unfollow: false, removeFollower: true },
  ])
  const lines = txt.split('\n')
  const ufIdx = lines.indexOf('=== UNFOLLOW ===')
  const rfIdx = lines.indexOf('=== REMOVE FOLLOWER ===')
  assert.ok(ufIdx >= 0 && rfIdx > ufIdx)
  assert.deepEqual(lines.slice(ufIdx + 1, ufIdx + 3), [
    'alice https://www.instagram.com/alice/',
    'bob https://www.instagram.com/bob/',
  ])
  assert.deepEqual(lines.slice(rfIdx + 1, rfIdx + 3), [
    'bob https://www.instagram.com/bob/',
    'carol https://www.instagram.com/carol/',
  ])
})

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`)
