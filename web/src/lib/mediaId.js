// Instagram references posts two ways:
//   - post URLs use a shortcode:      instagram.com/p/DaU88w7lfQ7/
//   - internal APIs use a media ID:   /api/v1/media/3933036433099846715/likers/
// The shortcode is simply the media ID encoded in URL-safe base64, so the two
// convert both ways with no lookup. Shortcodes longer than 11 chars (some
// share links) encode extra info after the media ID — only the first 11
// characters are the ID.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function shortcodeToMediaId(shortcode) {
  if (typeof shortcode !== 'string' || shortcode.length === 0) return null
  let id = 0n
  for (const ch of shortcode) {
    const v = ALPHABET.indexOf(ch)
    if (v === -1) return null
    id = id * 64n + BigInt(v)
  }
  return id.toString()
}

export function mediaIdToShortcode(mediaId) {
  let id
  try {
    id = BigInt(mediaId)
  } catch {
    return null
  }
  if (id < 0n) return null
  if (id === 0n) return ALPHABET[0]
  let out = ''
  while (id > 0n) {
    out = ALPHABET[Number(id % 64n)] + out
    id /= 64n
  }
  return out
}

// Accepts a full post/reel URL (or bare shortcode-ish path) and returns the
// numeric media ID as a string, or null if no shortcode is found.
export function postUrlToMediaId(url) {
  const m = String(url ?? '').match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
  if (!m) return null
  return shortcodeToMediaId(m[1].slice(0, 11))
}

// The console-snippet builders that use these IDs live in snippets.js.
