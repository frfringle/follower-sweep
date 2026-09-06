const KEY = 'followerSweep.v1'

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch (e) {
    // Quota exceeded or private mode — the app still works, just won't resume.
    console.warn('Follower Sweep: could not persist state', e)
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
