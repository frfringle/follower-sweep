// DevTools console snippets. All of them run on an instagram.com tab — same
// origin, so the user's own session cookies apply — because this app's origin
// can't call Instagram's API (CORS, and the session only exists over there).
// 936619743392459 is Instagram web's own x-ig-app-id.

// Instagram's own web JS attaches this whole header set to every /api/v1/ call.
// Sending only x-ig-app-id returns 403 on some sessions; adding the CSRF token,
// x-asbd-id, and x-requested-with clears it. (Instagram also sends
// x-ig-www-claim, but that value lives in memory and can't be read from a
// pasted snippet — if a session strictly requires it, the Network-tab
// "Copy as fetch" fallback replays the real request with it intact.)
// These are code fragments spliced into the snippet strings below; API_HEADERS
// references `csrf`, so CSRF_LINE must run first in the same scope.
const CSRF_LINE = `const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';`
const API_HEADERS = `{ 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf, 'x-asbd-id': '129477', 'x-requested-with': 'XMLHttpRequest' }`

// Fetches the likers of the logged-in user's most recent posts in one go and
// copies a combined bundle to the clipboard. The user's own ID comes from the
// ds_user_id session cookie, the post list from /api/v1/feed/user/<id>/, then
// one likers request per post — count+1 requests total.
export function buildAllPostsSnippet(count = 3) {
  return `(async () => {
  const uid = (document.cookie.match(/ds_user_id=(\\d+)/) || [])[1];
  if (!uid) { console.log('Run this on instagram.com while logged in.'); return; }
  ${CSRF_LINE}
  const H = { headers: ${API_HEADERS}, credentials: 'include' };
  const fr = await fetch('/api/v1/feed/user/' + uid + '/?count=${count}', H);
  if (!fr.ok) { console.log('Post list request failed: ' + fr.status); return; }
  const feed = await fr.json();
  const items = (feed.items || []).slice(0, ${count});
  if (!items.length) { console.log('No posts found. Response keys: ' + Object.keys(feed).join(', ')); return; }
  const posts = [];
  for (const it of items) {
    const id = String(it.pk || it.id).split('_')[0];
    const r = await fetch('/api/v1/media/' + id + '/likers/', H);
    if (!r.ok) { console.log('Likers failed for post ' + it.code + ': ' + r.status); continue; }
    const j = await r.json();
    posts.push({ code: it.code, media_id: id, users: j.users || [] });
    console.log('/p/' + it.code + ': ' + (j.users || []).length + ' likers');
  }
  const text = JSON.stringify({ follower_sweep_bundle: 1, posts });
  console.log(text);
  try { copy(text); console.log('(copied to clipboard — paste into Follower Sweep)'); } catch {}
})();`
}

// Single-post likers variant. With no mediaId it derives one from the post
// page currently open; with a mediaId it's hardcoded so it works from any
// instagram.com tab.
export function buildLikersSnippet(mediaId = null) {
  const idSource = mediaId
    ? `  const id = '${mediaId}';`
    : `  const m = location.pathname.match(/\\/(?:p|reel|reels|tv)\\/([A-Za-z0-9_-]+)/);
  if (!m) { console.log('Open one of your posts first (instagram.com/p/...)'); return; }
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = 0n;
  for (const c of m[1].slice(0, 11)) id = id * 64n + BigInt(A.indexOf(c));`
  return `(async () => {
${idSource}
  ${CSRF_LINE}
  const r = await fetch('/api/v1/media/' + id + '/likers/', { headers: ${API_HEADERS}, credentials: 'include' });
  if (!r.ok) { console.log('Request failed: ' + r.status); return; }
  const j = await r.json();
  const text = JSON.stringify(j);
  console.log(((j.users || []).length) + ' likers. JSON below — paste it into Follower Sweep:');
  console.log(text);
  try { copy(text); console.log('(also copied to your clipboard)'); } catch {}
})();`
}

// Assisted removal, driven from YOUR OWN followers / following list — the only
// snippet here that WRITES. The usernames you marked for removal are baked in.
// Run it once on instagram.com (logged in as yourself) and it works through the
// whole list on its own, pacing itself, until it finishes, hits the per-run
// cap, or Instagram pushes back. Progress is saved to instagram.com's own
// localStorage after every action, so if it stops (a block, the cap, or you
// reload the tab) re-running picks up exactly where it left off.
//
// There is NO safe "fast": Instagram's action limits are unpublished and vary
// by account. So the real protection is (a) human-like, randomized gaps with an
// occasional longer breather, and (b) an immediate STOP the moment a write
// returns 400/429 (its "action blocked" signal). The pacing knobs are at the
// top of the generated snippet — slower is always safer.
//
// It also solves the two things that made the old per-profile snippet fragile:
//   • IDs — resolved from your own list endpoint (friendships/<uid>/followers
//     or /following, which return username + pk together), matched to the baked
//     usernames; no per-profile web_profile_info lookup.
//   • x-ig-www-claim — Instagram returns the current claim in the
//     x-ig-set-www-claim RESPONSE header, readable on a same-origin fetch, so a
//     probe GET bootstraps it and every write reuses it. No 403, nothing pasted.
//
//   action: 'unfollow' (destroy, from your following) | 'remove'
//           (remove_follower, from your followers)
export function buildListRemovalSnippet(action, usernames = []) {
  const isRemove = action === 'remove'
  const listKind = isRemove ? 'followers' : 'following'
  const endpoint = isRemove ? 'remove_follower' : 'destroy'
  const verb = isRemove ? 'remove follower' : 'unfollow'
  const targets = JSON.stringify([...new Set(usernames.map((u) => u.trim().toLowerCase()).filter(Boolean))])
  return `(async () => {
  // ==== pacing — slower is safer. Instagram's real limits are unpublished. ====
  const MIN_GAP = 5000, MAX_GAP = 11000;          // random wait between removals (ms)
  const COOLDOWN_EVERY = 12, COOLDOWN = [60000, 120000]; // longer breather every N removals
  const MAX_PER_RUN = 80;                          // stop after this many; continue another day
  // ===========================================================================
  const TARGETS = ${targets};
  if (!TARGETS.length) { console.log('No ${verb} targets baked in.'); return; }
  const uid = (document.cookie.match(/ds_user_id=(\\d+)/) || [])[1];
  if (!uid) { console.log('Run this on instagram.com while logged in as yourself.'); return; }
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  const KEY = 'followerSweep.assist.${action}';
  const done = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
  const saveDone = () => localStorage.setItem(KEY, JSON.stringify([...done]));
  const left = () => TARGETS.filter((t) => !done.has(t)).length;
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let claim = '0';
  const H = (extra) => ({ headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf, 'x-asbd-id': '359341', 'x-requested-with': 'XMLHttpRequest', 'x-ig-www-claim': claim, ...extra }, credentials: 'include' });
  const readClaim = (res) => { claim = res.headers.get('x-ig-set-www-claim') || claim; };
  // bootstrap the www-claim from Instagram's own response header
  readClaim(await fetch('/api/v1/friendships/' + uid + '/${listKind}/?count=1', H()));
  console.log('Starting ${verb}: ' + left() + ' to go (cap ' + MAX_PER_RUN + ' this run). Reload the tab any time to stop — progress is saved.');
  let acted = 0;
  for (const name of TARGETS) {
    if (done.has(name)) continue;
    if (acted >= MAX_PER_RUN) { console.log('⏸ Hit this run\\'s cap (' + MAX_PER_RUN + '). ' + left() + ' left — re-run later (ideally tomorrow) to continue.'); return; }
    const q = await fetch('/api/v1/friendships/' + uid + '/${listKind}/?count=24&query=' + encodeURIComponent(name), H());
    if (!q.ok) { console.log('lookup failed for @' + name + ': ' + q.status + ' — stopping.'); return; }
    readClaim(q);
    const hit = ((await q.json()).users || []).find((u) => (u.username || '').toLowerCase() === name);
    if (!hit) { done.add(name); saveDone(); continue; } // already ${verb}d / not in your ${listKind}
    const r = await fetch('/api/v1/friendships/${endpoint}/' + hit.pk + '/', { method: 'POST', ...H({ 'content-type': 'application/x-www-form-urlencoded' }) });
    if (r.ok) { done.add(name); saveDone(); acted++; console.log('✓ ${verb} @' + name + '  (' + acted + ' this run · ' + left() + ' left)'); }
    else if (r.status === 400 || r.status === 429) { console.log('⛔ @' + name + ' → ' + r.status + '. Instagram is throttling/blocking. STOPPING now. Wait several hours (ideally a full day) before re-running. ' + left() + ' still to go.'); return; }
    else { console.log('✗ @' + name + ': ' + r.status + ' — skipping this one (will retry next run).'); continue; }
    if (left() === 0) break;
    let gap = rnd(MIN_GAP, MAX_GAP);
    if (acted % COOLDOWN_EVERY === 0) { gap = rnd(COOLDOWN[0], COOLDOWN[1]); console.log('   …breather ' + Math.round(gap / 1000) + 's…'); }
    await wait(gap);
  }
  console.log('✅ Done — ${verb} complete for every baked-in target. (Clear with: localStorage.removeItem(\\'' + KEY + '\\'))');
})();`
}

// Pages through the logged-in user's followers and following lists via the
// same /api/v1/friendships/<id>/(followers|following)/ endpoints the web UI
// hits when the dialogs are scrolled, 200 per page with a 400ms pause.
//
// Then it embeds avatars: Instagram's CDN sets Cross-Origin-Resource-Policy on
// avatar responses, so the app can't <img>-embed the raw profile_pic_url
// cross-origin (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin). But CORP only blocks
// *embedding* — a same-origin fetch here on instagram.com can still READ the
// bytes. So we fetch each avatar, downscale it to a ~96px JPEG via canvas, and
// store a data: URL in place of the link. The swipe cards then render bytes we
// already hold — no CDN request, no CORP, no expiry. profile_pic_url becomes a
// data URL; the parser stores it unchanged.
// No follow timestamps here — only the official export has those.
export function buildFollowSnippet() {
  return `(async () => {
  const uid = (document.cookie.match(/ds_user_id=(\\d+)/) || [])[1];
  if (!uid) { console.log('Run this on instagram.com while logged in.'); return; }
  ${CSRF_LINE}
  const H = { headers: ${API_HEADERS}, credentials: 'include' };
  const out = { follower_sweep_follows: 1, followers: [], following: [] };
  for (const kind of ['followers', 'following']) {
    let maxId = '';
    for (let page = 0; page < 40; page++) {
      const url = '/api/v1/friendships/' + uid + '/' + kind + '/?count=200' + (maxId ? '&max_id=' + encodeURIComponent(maxId) : '');
      const r = await fetch(url, H);
      if (!r.ok) { console.log(kind + ' page ' + (page + 1) + ' failed: ' + r.status); break; }
      const j = await r.json();
      for (const u of j.users || []) {
        out[kind].push({ username: u.username, full_name: u.full_name || '', profile_pic_url: u.profile_pic_url || '' });
      }
      console.log(kind + ': ' + out[kind].length + (j.next_max_id ? '…' : ' (done)'));
      if (!j.next_max_id) break;
      maxId = j.next_max_id;
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  // fetch + downscale avatars to data URLs (deduped by URL; ~6 at a time)
  const entries = [...out.followers, ...out.following];
  const uniq = [...new Set(entries.map((e) => e.profile_pic_url).filter(Boolean))];
  const thumb = async (u) => {
    try {
      const bmp = await createImageBitmap(await (await fetch(u)).blob());
      const S = 96, k = Math.min(1, S / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      return c.toDataURL('image/jpeg', 0.72);
    } catch { return ''; }
  };
  const map = {};
  let done = 0, i = 0;
  const worker = async () => { while (i < uniq.length) { const u = uniq[i++]; map[u] = await thumb(u); if (++done % 50 === 0 || done === uniq.length) console.log('avatars ' + done + '/' + uniq.length); } };
  console.log('fetching ' + uniq.length + ' avatars — this takes a bit…');
  await Promise.all(Array.from({ length: 6 }, worker));
  let embedded = 0;
  for (const e of entries) { const d = map[e.profile_pic_url]; e.profile_pic_url = d || ''; if (d) embedded++; }
  const text = JSON.stringify(out);
  console.log('embedded ' + embedded + '/' + entries.length + ' avatars · blob ~' + Math.round(text.length / 1024) + ' KB');
  console.log(text);
  try { copy(text); console.log('(copied to clipboard — paste into Follower Sweep)'); } catch {}
})();`
}
