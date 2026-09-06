// Export format consumed by queue_runner.py:
//   lines starting with '#' are comments
//   "=== UNFOLLOW ===" and "=== REMOVE FOLLOWER ===" open the two sections
//   each entry line is: username <space> profile-url

export function today() {
  return new Date().toISOString().slice(0, 10)
}

// rows: [{ username, href, unfollow: bool, removeFollower: bool }]
export function buildTxt(rows) {
  const unfollow = rows.filter((r) => r.unfollow)
  const removeFollower = rows.filter((r) => r.removeFollower)
  const lines = [
    `# Follower Sweep export — ${today()}`,
    '# format: username <space> profile-url',
    '',
    '=== UNFOLLOW ===',
    ...unfollow.map((r) => `${r.username} ${r.href}`),
    '',
    '=== REMOVE FOLLOWER ===',
    ...removeFollower.map((r) => `${r.username} ${r.href}`),
    '',
  ]
  return lines.join('\n')
}

export function downloadTxt(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
