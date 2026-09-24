# Follower Sweep

Review your Instagram followers/following with a Tinder-style swipe UI, export a
plain-text action list, then work through it manually with a queue-runner script.

**Nothing here talks to Instagram.** Part 1 is a fully client-side web app (your
export files never leave the browser tab). Part 2 only opens profile URLs in your
default browser and waits for you to act by hand.



https://github.com/user-attachments/assets/02df1e62-652b-45ab-9832-32399460e359





```
follower-sweep/
├── web/              Part 1: React + Tailwind swipe app (client-side only)
├── queue_runner.py   Part 2: opens profiles one at a time, tracks progress
└── tests/            sample export file for the queue runner
```

## Part 1 — the web app

```bash
cd web
npm install
npm run dev      # open the printed URL on your phone or desktop
npm test         # parser + render smoke tests
npm run build    # static build in dist/ (host anywhere, it's all client-side)
```

### Flow

1. **Import** — drop Instagram's "Download Your Information" export (the `.zip`
   itself, or the extracted `followers_1.json` / `following.json` from
   `connections/followers_and_following/`). Get it via Accounts Center →
   Your information and permissions → Download your information → **JSON format**.
   The parser validates the structure and shows the keys it found plus the
   expected format if anything doesn't match.

   No export yet? The "fetch lists with a console snippet" panel is instant:
   it pages through your followers/following via the same
   `/api/v1/friendships/<your-id>/…` calls the dialogs make when scrolled
   (200 per page, 400ms apart — roughly 10 requests for a ~1000-person
   account), then embeds everyone's profile photo (see below) so the swipe
   cards get real avatars. Follow dates only exist in the official export —
   import both and the app merges them (dates from the export, avatars from
   the snippet).

   **Avatars and the CORP block.** Instagram's CDN marks avatar responses with
   `Cross-Origin-Resource-Policy`, so the app *cannot* `<img>`-embed the raw
   `profile_pic_url` from another origin (the browser blocks it with
   `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`, even though the server returns 200).
   No `<img>` attribute — referrer policy, `crossorigin` — can override CORP.
   CORP only blocks *embedding*, though, not *reading*: so the follow snippet,
   running on instagram.com, `fetch()`es each avatar's bytes, downscales them to
   a ~96px JPEG via canvas, and stores a `data:` URL in place of the link. The
   swipe cards render bytes we already hold — no CDN request, no CORP, no
   expiry. (This is why avatars come from the follow snippet, not the likes
   blob, and why that step adds an "avatars N/N" progress log and some time.)
2. **Likes (optional)** — paste up to 3 "Liked by" JSON responses captured from
   your own browser's DevTools Network tab. The parser collects every
   `"username"` field wherever it appears (with a raw-text fallback for
   truncated copies), and shows you the raw keys if it finds none. Skip this
   step and everyone is simply "Unknown".

   Fastest route: the "one console snippet, one paste" panel generates a
   snippet you paste into the DevTools **Console** on any instagram.com tab.
   It reads your user ID from the `ds_user_id` session cookie, fetches your
   last 3 posts from `/api/v1/feed/user/<id>/`, pulls each post's
   `/api/v1/media/<id>/likers/` list (4 requests total, all as you), and
   copies one combined bundle to your clipboard — a single paste covers all
   three posts. A single-post variant is also there (the `/p/<shortcode>/` in
   a post URL is the media ID in URL-safe base64). The app itself can't call
   these endpoints (CORS + your session cookies only exist on instagram.com),
   which is why it's a snippet and not a button.

   The snippets send the same header set Instagram's own web JS attaches to
   `/api/v1/` calls (`x-ig-app-id`, `x-csrftoken`, `x-asbd-id`,
   `x-requested-with`) — app-id alone gets a **403** on some sessions.
   Instagram also sends an `x-ig-www-claim` token that lives in memory and
   can't be read from a pasted snippet; if a snippet still 403s, that session
   requires it, and the fix is to replay Instagram's own successful request:
   DevTools **Network** tab → right-click the `likers/` request → **Copy → Copy
   as fetch** → paste into the Console. (Or just copy that request's **Response**
   JSON and paste it into a Post slot — that path never needs any headers.)

   Liker entries also include `full_name` (shown on cards) and a raw
   `profile_pic_url`. That raw link is CORP-blocked like any other CDN avatar,
   so it won't render — swipe-card photos come from the follow snippet, which
   embeds them as data URLs (see above). Anyone without an embedded avatar just
   gets a colored letter avatar.
3. **Filter** — Following only / Followers only / Both, and No-interaction only /
   Everyone, with live match counts. From here you can also **export the
   filtered list as-is** without swiping.
4. **Swipe** — drag right = Keep, left = Remove, up = Skip (decide later), or
   use the buttons. Cards show username, profile link, follow dates,
   interaction status, and Follower/Following/Mutual tags. On each card two
   checkboxes control what "Remove" means: *Unfollow them* and/or *Remove as
   follower* (pre-ticked to whatever applies). Undo, progress bar, and
   everything persists in localStorage so you can close the tab and resume.
5. **Export** — review Keep/Remove/Skip counts and download the `.txt`. This
   screen also has an **Assisted removal** panel (see below).

### Assisted removal (optional, the one thing that writes)

Everything else in this app only reads. The Review screen's *Assisted removal*
panel generates a console snippet that actually performs the action, driven from
**your own followers / following list** on instagram.com. Your removal picks are
baked into the snippet. Pick a tab:

- **Remove follower** — run it on your own **followers** list. POSTs
  `friendships/remove_follower/<id>/`.
- **Unfollow** — run it on your own **following** list. POSTs
  `friendships/destroy/<id>/`.

Paste it once and it works through the whole baked-in list on its own, pacing
itself between removals. Two things that used to be fragile are handled
automatically:

- **User IDs** come from your own list endpoint
  (`friendships/<your-id>/followers` or `/following`, which return `username` +
  `pk` together), matched to the baked usernames — no per-profile lookup.
- **`x-ig-www-claim`** (the token that caused 403s) is read from Instagram's own
  `x-ig-set-www-claim` *response* header on a probe request, then reused on every
  write. Nothing to paste; `x-csrftoken` comes from your cookie.

Progress is saved to instagram.com's own `localStorage`
(`followerSweep.assist.remove` / `.unfollow`) after every removal, so if it stops
you can re-run and it resumes exactly where it left off (skipping who's done,
without rescanning). Reload the tab to stop it mid-run; clear that key to start a
section over.

**Pacing and the ban risk.** Bulk removal is the single most aggressively
rate-limited / "action blocked" behavior on Instagram, and its limits are
*unpublished* — there is no guaranteed-safe speed. So the snippet: waits a
random 5–11s between removals with a longer 1–2min breather every dozen; caps
each run (default 80); and **stops the instant a removal returns 400/429**, which
is Instagram's throttle/block signal. If it stops on a block, don't push it —
wait several hours to a day, then re-run. The pacing constants (`MIN_GAP`,
`MAX_GAP`, `COOLDOWN_EVERY`, `COOLDOWN`, `MAX_PER_RUN`) are at the top of the
generated snippet; slower is always safer. Prefer not to automate writes at all?
Skip this panel and use `queue_runner.py`, which just opens each profile so you
can click Instagram's own buttons.

### Export format

```
=== UNFOLLOW ===
username https://www.instagram.com/username/

=== REMOVE FOLLOWER ===
username https://www.instagram.com/username/
```

## Part 2 — the queue runner

Python 3, stdlib only.

```bash
python3 queue_runner.py follower-sweep-decisions-2026-07-06.txt
python3 queue_runner.py export.txt --unfollow-only   # or --remove-only / --both
python3 queue_runner.py export.txt --reset           # forget saved progress
python3 queue_runner.py export.txt --dry-run         # print URLs, don't open tabs
```

For each profile it prints `[X/Y] @username -> Unfollow + Remove follower`,
opens the profile in your default browser, and waits: **Enter** = done,
**s** = skip for now, **q** = quit. Someone in both sections is opened once
with both actions listed. Progress saves after every profile to
`<export>.progress.json` next to the export file, so re-running resumes where
you left off. This is the fully manual path — you click Instagram's own buttons;
the script never touches Instagram. (For a faster path, use the Review screen's
Assisted-removal snippet described above.)
