#!/usr/bin/env python3
"""Follower Sweep — queue runner.

Reads the .txt file exported by the Follower Sweep web app and walks you
through it one profile at a time: prints the username and which action(s)
apply, opens the profile URL in your default browser, then waits for YOU to
do the action by hand before moving on.

This script does not log into Instagram, does not call any Instagram API,
and does not click anything on Instagram's behalf — it only opens profile
pages in browser tabs, exactly like you typing the URL yourself.

Usage:
    python3 queue_runner.py export.txt
    python3 queue_runner.py export.txt --unfollow-only
    python3 queue_runner.py export.txt --remove-only
    python3 queue_runner.py export.txt --reset        # forget saved progress first

This is the manual path: it opens each profile so you can click Instagram's own
buttons. (The app's Review screen also offers an "assisted" console snippet that
works your list from your own followers/following page — that path doesn't use
this script.) Either way, this script never touches Instagram directly.

At each prompt:
    Enter  -> done with this profile, open the next one
    s      -> skip for now (it will come up again next run)
    q      -> quit (progress is saved; re-running resumes where you left off)

Progress is stored next to the export file as <export-name>.progress.json
(override with --progress). Only Python stdlib is used.
"""

import argparse
import json
import re
import sys
import webbrowser
from pathlib import Path

UNFOLLOW_HEADER = "=== UNFOLLOW ==="
REMOVE_HEADER = "=== REMOVE FOLLOWER ==="
URL_RE = re.compile(r"https?://\S+")
ACTION_LABELS = {"unfollow": "Unfollow", "remove": "Remove follower"}


def parse_line(line):
    """Return (username, url) from an entry line, or None if unparseable.

    Expected line format is 'username profile-url', but be lenient: a
    URL-only line derives the username from the URL path, and a
    username-only line derives the URL from the username.
    """
    m = URL_RE.search(line)
    url = m.group(0).rstrip("),.;") if m else None
    tokens = [t for t in line.split() if not t.lower().startswith("http")]
    username = tokens[0].lstrip("@") if tokens else None
    if not username and url:
        tail = url.split("://", 1)[1]
        parts = tail.split("/", 1)
        if len(parts) > 1 and parts[1].strip("/"):
            username = parts[1].strip("/").split("/")[0].split("?")[0]
    if not username:
        return None
    if not url:
        url = f"https://www.instagram.com/{username}/"
    return username, url


def parse_export(path):
    """Split the export into the two ordered section lists."""
    sections = {"unfollow": [], "remove": []}
    current = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line == UNFOLLOW_HEADER:
            current = "unfollow"
            continue
        if line == REMOVE_HEADER:
            current = "remove"
            continue
        if line.startswith("==="):
            current = None  # unknown section: ignore its lines
            continue
        if current is None:
            continue
        entry = parse_line(line)
        if entry:
            sections[current].append(entry)
    return sections


def build_queue(sections):
    """Merge the two lists into an ordered {key: {username, url, actions}}.

    Someone present in both sections becomes ONE queue entry with both
    actions, so their profile is only opened once.
    """
    queue = {}
    for action in ("unfollow", "remove"):
        for username, url in sections[action]:
            entry = queue.setdefault(
                username.lower(), {"username": username, "url": url, "actions": []}
            )
            if action not in entry["actions"]:
                entry["actions"].append(action)
    return queue


def load_progress(path):
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data.get("done"), dict):
                return data
        except (json.JSONDecodeError, OSError):
            print(f"! Could not read {path} — starting with fresh progress.")
    return {"done": {}}


def save_progress(path, progress):
    path.write_text(json.dumps(progress, indent=2), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(
        description="Open Follower Sweep export entries one at a time and wait for you to act manually.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Usage:", 1)[1],
    )
    ap.add_argument("export", help="path to the .txt exported by the Follower Sweep web app")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--unfollow-only", action="store_true", help="only process the UNFOLLOW section")
    mode.add_argument("--remove-only", action="store_true", help="only process the REMOVE FOLLOWER section")
    mode.add_argument("--both", action="store_true", help="process both sections (default)")
    ap.add_argument("--progress", help="progress file path (default: <export>.progress.json next to the export)")
    ap.add_argument("--reset", action="store_true", help="forget saved progress before starting")
    ap.add_argument("--dry-run", action="store_true", help="print URLs instead of opening browser tabs")
    args = ap.parse_args()

    export_path = Path(args.export).expanduser()
    if not export_path.is_file():
        sys.exit(f"error: {export_path} does not exist")

    sections = parse_export(export_path)
    if not sections["unfollow"] and not sections["remove"]:
        sys.exit(
            "error: no entries found. Expected sections headed by\n"
            f"  {UNFOLLOW_HEADER}\n  {REMOVE_HEADER}\n"
            "with one 'username profile-url' per line (the format the web app exports)."
        )

    if args.unfollow_only:
        requested = {"unfollow"}
    elif args.remove_only:
        requested = {"remove"}
    else:
        requested = {"unfollow", "remove"}

    progress_path = Path(args.progress).expanduser() if args.progress else export_path.with_name(
        export_path.stem + ".progress.json"
    )
    if args.reset and progress_path.exists():
        progress_path.unlink()
        print(f"Progress reset ({progress_path.name} deleted).")
    progress = load_progress(progress_path)
    done = progress["done"]  # {username-lower: [completed actions]}

    queue = build_queue(sections)
    relevant = [(k, e) for k, e in queue.items() if set(e["actions"]) & requested]

    def pending_actions(key, entry):
        completed = set(done.get(key, []))
        return [a for a in entry["actions"] if a in requested and a not in completed]

    total = len(relevant)
    reviewed = sum(1 for k, e in relevant if not pending_actions(k, e))

    print(f"Loaded {export_path.name}: {len(sections['unfollow'])} unfollow, {len(sections['remove'])} remove-follower entries.")
    print(f"Queue for this run: {total} profiles ({reviewed} already done, {total - reviewed} to go).")
    if reviewed == total:
        print("Nothing left to do — run with --reset to start over.")
        return
    print("Controls: Enter = done, s = skip for now, q = quit (progress saves)\n")

    for key, entry in relevant:
        todo = pending_actions(key, entry)
        if not todo:
            continue
        label = " + ".join(ACTION_LABELS[a] for a in todo)
        print(f"[{reviewed + 1}/{total}] @{entry['username']}  ->  {label}")
        print(f"        {entry['url']}")
        if args.dry_run:
            print("        (dry run: not opening browser)")
        else:
            webbrowser.open(entry["url"])
        try:
            answer = input("        Enter=done / s=skip / q=quit > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            answer = "q"
            print()
        if answer == "q":
            save_progress(progress_path, progress)
            print(f"\nStopped. Reviewed {reviewed} of {total}. Progress saved to {progress_path.name} — rerun to resume.")
            return
        if answer == "s":
            print("        skipped (will come up again next run)\n")
            continue
        done.setdefault(key, [])
        done[key] = sorted(set(done[key]) | set(todo))
        save_progress(progress_path, progress)  # save after every profile: quitting mid-run loses nothing
        reviewed += 1
        print(f"        done — reviewed {reviewed} of {total}\n")

    print(f"All done! Reviewed {reviewed} of {total} profiles.")


if __name__ == "__main__":
    main()
