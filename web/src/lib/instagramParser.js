import JSZip from 'jszip'

// Parses Instagram's official "Download Your Information" export (JSON format).
// Known shapes as of 2024–2026 exports:
//   followers_1.json  -> [ { title, media_list_data, string_list_data: [{ href, value, timestamp }] } ]
//   following.json    -> { "relationships_following": [ <same entry shape but string_list_data
//                          items have no "value" — the username is on the entry's own "title",
//                          and "href" is a redirect link like https://www.instagram.com/_u/<user>> ] }
// Large accounts split followers across followers_1.json, followers_2.json, ...
// Username resolution order per entry: string_list_data[0].value, then entry.title,
// then the last non-empty path segment of string_list_data[0].href.

export class ParseError extends Error {
  constructor(message, details = []) {
    super(message)
    this.name = 'ParseError'
    this.details = details
  }
}

export const EXPECTED_FORMAT = [
  'Expected Instagram export shape:',
  '[ { "string_list_data": [ { "href": "https://www.instagram.com/<user>", "value": "<user>", "timestamp": 1234567890 } ] } ]',
  '(following.json wraps that array as { "relationships_following": [ ... ] })',
  'Files come from connections/followers_and_following/ in the export zip.',
]

const FOLLOWERS_NAME = /^followers(_\d+)?\.json$/i
const FOLLOWING_NAME = /^following(_\d+)?\.json$/i

function basename(path) {
  return path.split('/').pop().toLowerCase()
}

function looksLikeEntry(e) {
  return e && typeof e === 'object' && Array.isArray(e.string_list_data)
}

// Best-effort username out of an href like ".../_u/someuser" or ".../someuser/".
function usernameFromHref(href) {
  if (typeof href !== 'string' || !href) return null
  try {
    const path = new URL(href).pathname
    const segments = path.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    return last && last !== '_u' ? last : null
  } catch {
    return null
  }
}

function profileUrl(username) {
  return `https://www.instagram.com/${username}/`
}

// Parse one followers/following JSON document. Returns { people, skipped, wrapperKey, shape }.
export function parseRelationshipJson(text, fileName) {
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new ParseError(`${fileName} is not valid JSON.`, [String(e.message), ...EXPECTED_FORMAT])
  }

  let entries = null
  let wrapperKey = null
  let shape = null

  if (Array.isArray(json)) {
    entries = json
    shape = 'array'
  } else if (json && typeof json === 'object') {
    shape = 'object'
    for (const [k, v] of Object.entries(json)) {
      if (Array.isArray(v) && (v.length === 0 || v.some(looksLikeEntry))) {
        entries = v
        wrapperKey = k
        break
      }
    }
    if (!entries) {
      throw new ParseError(`Unrecognized structure in ${fileName}.`, [
        `Top-level keys found: ${Object.keys(json).slice(0, 12).join(', ') || '(none)'}`,
        ...EXPECTED_FORMAT,
      ])
    }
  } else {
    throw new ParseError(`${fileName}: expected a JSON array or object, got ${json === null ? 'null' : typeof json}.`, EXPECTED_FORMAT)
  }

  const people = []
  let skipped = 0
  for (const entry of entries) {
    const item = Array.isArray(entry?.string_list_data) ? entry.string_list_data[0] : null

    const username =
      (typeof item?.value === 'string' && item.value.trim()) ||
      (typeof entry?.title === 'string' && entry.title.trim()) ||
      usernameFromHref(item?.href) ||
      null

    if (!username) {
      skipped++
      continue
    }

    people.push({
      username,
      href: typeof item?.href === 'string' && item.href && !item.href.includes('/_u/') ? item.href : profileUrl(username),
      timestamp: typeof item?.timestamp === 'number' ? item.timestamp : null,
    })
  }

  if (entries.length > 0 && people.length === 0) {
    const first = entries[0]
    const firstItem = Array.isArray(first?.string_list_data) ? first.string_list_data[0] : null
    throw new ParseError(`${fileName}: couldn't find a username in string_list_data[0].value, entry.title, or entry.href.`, [
      `First entry keys: ${first && typeof first === 'object' ? Object.keys(first).join(', ') : String(first)}`,
      `First string_list_data[0] keys: ${firstItem && typeof firstItem === 'object' ? Object.keys(firstItem).join(', ') : String(firstItem)}`,
      ...EXPECTED_FORMAT,
    ])
  }

  return { people, skipped, wrapperKey, shape }
}

// Parses the blob produced by the followers/following console snippet (see
// buildFollowSnippet in snippets.js): { follower_sweep_follows: 1,
// followers: [{ username, full_name, profile_pic_url }], following: [...] }.
// Returns the same shape as parseExportFiles plus a profiles map (avatars for
// everyone). This route has no follow timestamps — only the export does.
export function parseFollowSnippetBlob(text) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new ParseError('Nothing to parse — the input is empty.')

  let json
  try {
    json = JSON.parse(trimmed)
  } catch (e) {
    throw new ParseError('Not valid JSON.', [
      String(e.message),
      'Paste the blob the followers/following console snippet copied to your clipboard.',
    ])
  }
  if (!json || typeof json !== 'object' || (!Array.isArray(json.followers) && !Array.isArray(json.following))) {
    throw new ParseError("This doesn't look like the follow-snippet blob.", [
      `Top-level keys: ${json && typeof json === 'object' ? Object.keys(json).slice(0, 12).join(', ') || '(none)' : typeof json}`,
      'Expected { "followers": [...], "following": [...] } as copied by the console snippet.',
    ])
  }

  const warnings = []
  const profiles = {}
  const mapList = (list, label) => {
    const out = []
    let skipped = 0
    for (const u of list ?? []) {
      const username = typeof u?.username === 'string' ? u.username.trim() : ''
      if (!username) {
        skipped++
        continue
      }
      out.push({ username, href: profileUrl(username), timestamp: null })
      const key = username.toLowerCase()
      const p = profiles[key] ?? (profiles[key] = {})
      if (!p.pic && typeof u.profile_pic_url === 'string' && u.profile_pic_url) p.pic = u.profile_pic_url
      if (!p.name && typeof u.full_name === 'string' && u.full_name) p.name = u.full_name
    }
    if (skipped > 0) warnings.push(`${label}: skipped ${skipped} entr${skipped === 1 ? 'y' : 'ies'} with no username.`)
    return out
  }

  const followers = mapList(json.followers, 'followers')
  const following = mapList(json.following, 'following')
  if (followers.length === 0 && following.length === 0) {
    throw new ParseError('No usernames found in the snippet blob.', [
      'Both "followers" and "following" came back empty — check the console output where you ran the snippet.',
    ])
  }
  for (const k of Object.keys(profiles)) {
    if (!profiles[k].pic && !profiles[k].name) delete profiles[k]
  }
  warnings.push(
    'Imported via console snippet — follow dates are not available this way (only the official export has timestamps).',
  )
  return {
    followers,
    following,
    warnings,
    sources: [`console snippet → followers (${followers.length}), following (${following.length})`],
    profiles,
  }
}

// Fill gaps in a fresh import with what a previous one knew: follow
// timestamps only come from the official export, avatars only from the
// console snippet, so importing one after the other keeps both. Fresh values
// always win; people absent from the fresh import are dropped.
export function mergeImportData(prev, next) {
  if (!prev) return next
  const ts = new Map()
  for (const listName of ['followers', 'following']) {
    for (const p of prev[listName] ?? []) {
      if (p.timestamp) ts.set(`${listName}:${p.username.toLowerCase()}`, p.timestamp)
    }
  }
  const fillTs = (list, listName) =>
    (list ?? []).map((p) => (p.timestamp ? p : { ...p, timestamp: ts.get(`${listName}:${p.username.toLowerCase()}`) ?? null }))

  const profiles = { ...(prev.profiles ?? {}) }
  for (const [k, v] of Object.entries(next.profiles ?? {})) {
    const p = profiles[k] ?? (profiles[k] = {})
    if (v?.pic) p.pic = v.pic
    if (v?.name) p.name = v.name
  }

  return {
    ...next,
    followers: fillTs(next.followers, 'followers'),
    following: fillTs(next.following, 'following'),
    profiles,
  }
}

// Accepts a mix of File objects: the whole export .zip and/or extracted .json files.
// Returns { followers, following, warnings, sources }.
export async function parseExportFiles(files) {
  const jobs = [] // { name, text }

  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      let zip
      try {
        zip = await JSZip.loadAsync(await file.arrayBuffer())
      } catch (e) {
        throw new ParseError(`Couldn't read ${file.name} as a zip archive.`, [String(e.message)])
      }
      const names = Object.keys(zip.files).filter(
        (n) => !zip.files[n].dir && !n.startsWith('__MACOSX/') && !basename(n).startsWith('.'),
      )
      const matches = names.filter((n) => FOLLOWERS_NAME.test(basename(n)) || FOLLOWING_NAME.test(basename(n)))
      if (matches.length === 0) {
        const followish = names.filter((n) => n.toLowerCase().includes('follow')).slice(0, 12)
        throw new ParseError(`No followers/following JSON files found inside ${file.name}.`, [
          'Expected connections/followers_and_following/followers_1.json and following.json.',
          'If you requested the export in HTML format, request it again in JSON format.',
          followish.length
            ? `Files mentioning "follow" in this zip: ${followish.join(', ')}`
            : `The zip contains ${names.length} files, none matching followers*.json / following*.json.`,
        ])
      }
      for (const n of matches) {
        jobs.push({ name: n, text: await zip.files[n].async('string') })
      }
    } else {
      jobs.push({ name: file.name, text: await file.text() })
    }
  }

  const followers = []
  const following = []
  const warnings = []
  const sources = []

  for (const job of jobs) {
    const b = basename(job.name)
    let kind = FOLLOWERS_NAME.test(b) ? 'followers' : FOLLOWING_NAME.test(b) ? 'following' : null
    const parsed = parseRelationshipJson(job.text, job.name)

    if (!kind) {
      // Filename didn't tell us — infer from the document shape.
      if (parsed.wrapperKey && parsed.wrapperKey.toLowerCase().includes('following')) {
        kind = 'following'
      } else if (parsed.wrapperKey && parsed.wrapperKey.toLowerCase().includes('follower')) {
        kind = 'followers'
      } else if (parsed.shape === 'array') {
        kind = 'followers'
        warnings.push(
          `${job.name}: couldn't tell followers vs following from the file name; treated it as FOLLOWERS because it's a bare array (Instagram's followers_N.json shape). Rename it following.json and re-import if that's wrong.`,
        )
      } else {
        throw new ParseError(`Can't tell whether ${job.name} is a followers or following file.`, [
          `Its wrapper key is "${parsed.wrapperKey}".`,
          'Rename the file to followers_1.json or following.json and try again.',
        ])
      }
    }

    if (parsed.skipped > 0) {
      warnings.push(`${job.name}: skipped ${parsed.skipped} entr${parsed.skipped === 1 ? 'y' : 'ies'} with no username.`)
    }
    ;(kind === 'followers' ? followers : following).push(...parsed.people)
    sources.push(`${job.name} → ${kind} (${parsed.people.length})`)
  }

  if (followers.length === 0 && following.length === 0) {
    throw new ParseError('No followers or following data found in the selected files.', EXPECTED_FORMAT)
  }

  return { followers, following, warnings, sources }
}
