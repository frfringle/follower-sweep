import { ParseError } from './instagramParser.js'

// Defensive parser for a "Liked by" response blob copied from the browser
// DevTools Network tab. The exact wrapper changes between Instagram web
// versions (GraphQL: data.xdt_api__v1__media__media_id__likers.users[...],
// older REST: { users: [...] }), so instead of assuming a path we walk the
// whole structure and collect every string "username" field. If JSON parsing
// fails entirely, fall back to scanning the raw text for "username":"..."
// pairs (handles truncated copies).

// Besides usernames, liker objects carry profile_pic_url and full_name for
// free — harvest them so the swipe cards can show real avatars without any
// extra requests. profiles is keyed by lowercased username.
function collectProfiles(root) {
  const usernames = []
  const profiles = {}
  const seen = new Set()
  const stack = [root]
  let visited = 0
  while (stack.length > 0) {
    if (++visited > 500000) break // hard cap so a pathological blob can't hang the tab
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const v of node) if (v && typeof v === 'object') stack.push(v)
      continue
    }
    if (node && typeof node === 'object') {
      if (typeof node.username === 'string' && node.username) {
        if (!seen.has(node.username)) {
          seen.add(node.username)
          usernames.push(node.username)
        }
        const key = node.username.toLowerCase()
        const p = profiles[key] ?? (profiles[key] = {})
        if (!p.pic && typeof node.profile_pic_url === 'string' && node.profile_pic_url) p.pic = node.profile_pic_url
        if (!p.name && typeof node.full_name === 'string' && node.full_name) p.name = node.full_name
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v)
    }
  }
  for (const k of Object.keys(profiles)) {
    if (!profiles[k].pic && !profiles[k].name) delete profiles[k]
  }
  return { usernames, profiles }
}

function describeStructure(json) {
  const lines = []
  if (Array.isArray(json)) {
    lines.push(`Top level: array of ${json.length} item(s).`)
    const first = json.find((v) => v && typeof v === 'object')
    if (first) lines.push(`First object item keys: ${Object.keys(first).slice(0, 15).join(', ')}`)
  } else if (json && typeof json === 'object') {
    lines.push(`Top-level keys: ${Object.keys(json).slice(0, 15).join(', ') || '(none)'}`)
    for (const probe of ['data', 'users']) {
      const v = json[probe]
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        lines.push(`"${probe}" keys: ${Object.keys(v).slice(0, 15).join(', ')}`)
      }
    }
  } else {
    lines.push(`Top level is a ${json === null ? 'null' : typeof json}, not an object.`)
  }
  return lines
}

// Returns { usernames, profiles, method: 'json' | 'text-scan', postCount? }.
// postCount is set when the blob is a follower-sweep bundle covering several
// posts (from the all-posts console snippet). Throws ParseError with the raw
// keys it saw so you can adjust what you paste.
export function parseLikedByBlob(text) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new ParseError('Nothing to parse — the input is empty.')

  let json = null
  let parseErrMsg = null
  try {
    json = JSON.parse(trimmed)
  } catch (e) {
    parseErrMsg = String(e.message)
  }

  if (json !== null && typeof json === 'object') {
    const { usernames, profiles } = collectProfiles(json)
    if (usernames.length > 0) {
      const postCount =
        Array.isArray(json.posts) && json.posts.some((p) => Array.isArray(p?.users))
          ? json.posts.length
          : undefined
      return { usernames, profiles, method: 'json', postCount }
    }
  }

  // Fallback: scan raw text for "username":"..." pairs.
  const rx = /"username"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  const found = new Set()
  let m
  while ((m = rx.exec(trimmed)) !== null) {
    try {
      found.add(JSON.parse(`"${m[1]}"`)) // unescape via JSON string rules
    } catch {
      found.add(m[1])
    }
  }
  if (found.size > 0) return { usernames: [...found], profiles: {}, method: 'text-scan' }

  const details = []
  if (json !== null && typeof json === 'object') {
    details.push('The JSON parsed fine, but no "username" string field exists anywhere in it.')
    details.push(...describeStructure(json))
    details.push('Make sure you copied the response of the likers request itself (not the page HTML).')
  } else {
    details.push(`Not valid JSON (${parseErrMsg}) and no "username":"..." pairs found in the raw text.`)
    details.push('Copy the full response body of the "Liked by" request from the DevTools Network tab.')
  }
  throw new ParseError('Could not find any usernames in this blob.', details)
}
