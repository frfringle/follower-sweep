// Cross-reference model: merge followers + following into unique people,
// then classify each person's interaction status against the liked-by lists.

export function keyOf(username) {
  return username.trim().toLowerCase()
}

export function buildPeople(followers = [], following = []) {
  const map = new Map()
  const ensure = (raw) => {
    const key = keyOf(raw.username)
    if (!map.has(key)) {
      map.set(key, {
        key,
        username: raw.username.trim(),
        href: raw.href,
        isFollower: false,
        isFollowing: false,
        followerSince: null,
        followingSince: null,
      })
    }
    return map.get(key)
  }
  for (const f of followers) {
    const p = ensure(f)
    p.isFollower = true
    p.followerSince = f.timestamp ?? p.followerSince
  }
  for (const f of following) {
    const p = ensure(f)
    p.isFollowing = true
    p.followingSince = f.timestamp ?? p.followingSince
  }
  return [...map.values()].sort((a, b) => a.username.localeCompare(b.username))
}

export function buildLikedBySet(likedPosts = []) {
  const set = new Set()
  for (const post of likedPosts) {
    for (const u of post?.usernames ?? []) set.add(keyOf(u))
  }
  return set
}

// Merge the avatar/full-name info harvested from liked-by blobs across posts.
// Keyed by lowercased username; first pic/name seen wins.
export function buildProfileMap(likedPosts = []) {
  const map = {}
  for (const post of likedPosts) {
    for (const [k, v] of Object.entries(post?.profiles ?? {})) {
      const p = map[k] ?? (map[k] = {})
      if (!p.pic && v?.pic) p.pic = v.pic
      if (!p.name && v?.name) p.name = v.name
    }
  }
  return map
}

// 'interacted' | 'none' | 'unknown' (unknown = no liked-by data was provided)
export function interactionOf(person, likedBySet, hasLikedByData) {
  if (!hasLikedByData) return 'unknown'
  return likedBySet.has(person.key) ? 'interacted' : 'none'
}

// filters: { scope: 'both' | 'following' | 'followers', noInteractionOnly: boolean }
// With no liked-by data everyone is 'unknown', which passes the
// no-interaction filter so the app stays usable without that signal.
export function matchesFilters(person, filters, likedBySet, hasLikedByData) {
  if (filters.scope === 'following' && !person.isFollowing) return false
  if (filters.scope === 'followers' && !person.isFollower) return false
  if (filters.noInteractionOnly) {
    if (interactionOf(person, likedBySet, hasLikedByData) === 'interacted') return false
  }
  return true
}
