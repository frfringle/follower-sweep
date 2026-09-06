# Testing Follower Sweep

## Part 1 — web app (`web/`)

### Automated tests

```bash
cd web
npm install       # first time only
npm test          # runs both suites below
```

`npm test` runs two Node scripts (no browser needed):

- **`tests/parsers.test.mjs`** — parsing and logic, 29 checks:
  - Instagram export parsing: bare-array `followers_1.json`, wrapped
    `following.json` (`relationships_following` key), an unrecognized-but-valid
    wrapper key, malformed JSON, and the real-world shape where
    `string_list_data` entries have no `value` field and the username lives on
    `entry.title` with an `href` like `.../_u/username` (this is the shape
    Instagram's actual export used at the time this was built — the schema has
    changed before, so if your export doesn't match, this is the file to add a
    case to: `parseRelationshipJson` in `web/src/lib/instagramParser.js`).
  - `parseExportFiles`: reading a full `.zip`, a zip with no follow files
    (should error with the file list), and loose `.json` files by name.
  - "Liked by" blob parsing: GraphQL-style nesting, old REST `{ users: [...] }`
    shape, a text-scan fallback for truncated JSON, and the error path when no
    usernames are found anywhere.
  - The cross-reference model (merge followers/following, interaction status,
    filters) and the `.txt` export format.
  - Media-ID math (`web/src/lib/mediaId.js`): shortcode ↔ media ID round-trip
    against a real captured likers URL, extraction from post/reel/share links,
    and the generated DevTools console snippets (single-post and last-3-posts
    variants).
  - The all-posts bundle path: parsing the combined blob the snippet produces
    (per-post counts, harvested `profile_pic_url` / `full_name` for card
    avatars) and merging profiles across posts via `buildProfileMap`.
  - The followers/following console-snippet route (`web/src/lib/snippets.js`):
    the generated snippet paginates the friendships endpoints and embeds
    avatars as downscaled JPEG data URLs (it `fetch()`es each `profile_pic_url`
    on instagram.com and canvas-re-encodes it — the workaround for Instagram's
    CDN blocking cross-origin `<img>` embedding via CORP). The pasted blob
    parses into lists + avatars with a missing-dates warning, wrong shapes error
    with the keys seen, and `mergeImportData` keeps export timestamps + snippet
    avatars when both sources are imported.
  - The assisted-removal snippet (`buildListRemovalSnippet`): each action hits
    the right endpoint off the right list (`remove_follower/` from your
    followers, `destroy/` from your following), bakes the removal usernames in
    (deduped + lowercased), bootstraps `x-ig-www-claim` from the response
    header, keeps resumable progress in `localStorage`, and runs the whole list
    itself with randomized gaps + a per-run cap, stopping the instant a write
    returns 400/429. (The loop control-flow — throttle, stop-on-block, resume —
    is exercised end-to-end with mocked `fetch` in the browser during manual
    verification; the unit test asserts the pacing/cap/stop constants are wired
    in and the snippet is valid JS.)
- **`tests/render.test.mjs`** — bundles `render-harness.jsx` with esbuild and
  server-renders every screen (Import, Likes, Dashboard, Swipe, Review) against
  fixture data, asserting key text shows up (e.g. `@alice`, `KEEP`,
  `Download .txt`). Catches screens that crash or silently render blank.

Run them individually with `node tests/parsers.test.mjs` or
`node tests/render.test.mjs` from `web/`.

### Manual browser testing

```bash
cd web
npm run dev        # prints a local URL, open on desktop or your phone
```

Walk the full flow at least once after any change to `src/`:

1. **Import** — drag in the export `.zip`, or the extracted
   `followers_1.json` / `following.json`. Confirm the follower/following/mutual
   counts look right and no unexpected warnings appear. Then try feeding it
   garbage (e.g. a random `.json` file) and confirm you get a readable error
   naming the keys it found instead of a blank screen or stack trace.
2. **Likes** — paste a "Liked by" JSON blob (or upload one), confirm the
   username count and sample usernames look right. Try pasting malformed text
   and confirm the raw-keys error shows. Try skipping this step entirely and
   confirm the Filter screen still works with everyone "Unknown".
3. **Filter** — toggle Both / Following only / Followers only and Show
   everyone / No-interaction only, and confirm the live count updates. Try
   "Export filtered list as-is" and check the downloaded `.txt`.
4. **Swipe** — drag a card in each of the three directions (or use the
   buttons): right = Keep, left = Remove, up = Skip. Confirm the Unfollow /
   Remove-as-follower checkboxes are pre-ticked sensibly and only enabled for
   applicable tags. Hit Undo and confirm the last decision reverts. Reload the
   tab mid-stack and confirm progress resumed from localStorage.
5. **Export** — confirm Keep/Remove/Skip counts match what you did, download
   the `.txt`, and check it has both `=== UNFOLLOW ===` and
   `=== REMOVE FOLLOWER ===` sections with `username profile-url` lines.

Use browser DevTools → Application → Local Storage to inspect/clear the
`followerSweep.v1` key if you need a clean slate without using the in-app
"Reset all data" button.

### Testing against your real Instagram export safely

The parser is defensive but Instagram's export schema has changed before.
Rather than pasting your real follower list into a chat tool or an
unfamiliar destination, test it locally:

```bash
cd web && npm run dev
```

then drag your real `followers_1.json` / `following.json` (or the whole
export `.zip`) straight into the running app in your own browser tab — the
files never leave that tab (no network calls, `FileReader`/`JSZip` only). If
parsing fails, the error box shows the exact keys it found so you can add a
matching case to `parseRelationshipJson` / `parseLikedByBlob` and re-run
`npm test`.

### Build check

```bash
npm run build     # static bundle in dist/, must complete with no errors
npm run preview   # sanity-check the production build
```

## Part 2 — queue runner (`queue_runner.py`)

Stdlib-only Python 3, no install step.

```bash
python3 queue_runner.py tests/sample-export.txt --dry-run
```

`tests/sample-export.txt` is a 3-username fixture (alice/bob → unfollow,
bob/carol → remove follower) matching the real export format. `--dry-run`
prints what would happen without opening any browser tabs — use it for every
change to the parsing/progress logic.

Things to check:

- **Parsing**: confirm it correctly splits the two sections and reports `bob`
  under both Unfollow and Remove-follower.
- **Progress tracking**: run without `--dry-run` once (or inspect the code
  path), quit partway via `q`, re-run, and confirm it resumes instead of
  restarting. `--reset` should wipe `<export>.progress.json` and start over.
- **Mode flags**: `--unfollow-only`, `--remove-only`, and the default
  `--both` should each process only the expected section(s).
- **Bad input**: point it at a `.txt` file missing the `===` headers and
  confirm it fails with a clear message rather than a stack trace.

```bash
python3 queue_runner.py tests/sample-export.txt --unfollow-only --dry-run
python3 queue_runner.py tests/sample-export.txt --remove-only --dry-run
python3 queue_runner.py tests/sample-export.txt --reset --dry-run
```
