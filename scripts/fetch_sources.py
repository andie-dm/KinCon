#!/usr/bin/env python3
"""Download and cache the official AAAI-25 sources used by the importers.

Everything lands in data/raw/ with a manifest recording URL, retrieval time,
HTTP status and SHA-256. Later stages read only the cache, never the network.

Access rules honoured:
- aaai.org robots.txt sets Crawl-delay: 43200, so each aaai.org page is fetched
  at most once and never refetched while a cached copy exists.
- ojs.aaai.org disallows only /cache/; issue tables of contents are fetched
  with a polite delay.

Usage: python3 scripts/fetch_sources.py [--refresh-ojs]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
MANIFEST = RAW / "manifest.json"
UA = "aaai25-replay-importer/1.0 (hackathon research demo; one-off fetch)"

HF_PARQUET = "https://huggingface.co/datasets/ai-conferences/AAAI2025/resolve/main/data/train-00000-of-00001.parquet"
HF_README = "https://huggingface.co/datasets/ai-conferences/AAAI2025/resolve/main/README.md"
AAAI_PAGES = {
    "proceeding_index.html": "https://aaai.org/proceeding/aaai-39-2025/",
    "main_technical_track.html": "https://aaai.org/conference/aaai/aaai-25/main-technical-track/",
    "poster_sessions.html": "https://aaai.org/conference/aaai/aaai-25/poster-sessions/",
    "poster_saturday.pdf": "https://aaai.org/wp-content/uploads/2025/01/AAAI-25-Poster-Schedule_2025-01-22_Saturday-Only.pdf",
    # Newer schedule files linked from main_technical_track.html (fetched once).
    "oral_main_track_2025-02-22.pdf": "https://aaai.org/wp-content/uploads/2025/02/AAAI-25-Main-Track-Oral-Talks-Schedule-2.22.pdf",
    "poster_main_track_2025-02-21.pdf": "https://aaai.org/wp-content/uploads/2025/02/AAAI-25-Main-Track-Poster-Schedule-2.21.pdf",
    "poster_saturday_2025-02-27.pdf": "https://aaai.org/wp-content/uploads/2025/02/AAAI-25-Saturday-Poster-Schedule-2.27.25.pdf",
}
# OJS issue view ids for volume 39, read from the cached proceedings index
# (issue 20 is 652, not 643).
OJS_ISSUES = {i: 623 + i for i in range(1, 20)} | {20: 652} | {i: 623 + i for i in range(21, 29)}
OJS_URL = "https://ojs.aaai.org/index.php/AAAI/issue/view/{}"


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text("utf-8")) if MANIFEST.exists() else {}


def fetch(url: str, dest: Path, manifest: dict, *, refresh: bool = False) -> None:
    key = str(dest.relative_to(RAW)).replace("\\", "/")
    if dest.exists() and not refresh:
        manifest.setdefault(key, {"url": url, "retrieved_at": None, "note": "pre-existing cache"})
        if not manifest[key].get("sha256"):
            manifest[key]["sha256"] = hashlib.sha256(dest.read_bytes()).hexdigest()
        return
    resp = requests.get(url, headers={"User-Agent": UA}, timeout=60)
    dest.parent.mkdir(parents=True, exist_ok=True)
    manifest[key] = {
        "url": url,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "status": resp.status_code,
        "content_type": resp.headers.get("content-type"),
    }
    if resp.status_code != 200:
        print(f"WARN {resp.status_code} {url}", file=sys.stderr)
        return
    dest.write_bytes(resp.content)
    manifest[key]["sha256"] = hashlib.sha256(resp.content).hexdigest()
    manifest[key]["bytes"] = len(resp.content)
    print(f"fetched {key} ({len(resp.content)} bytes)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-ojs", action="store_true", help="refetch OJS TOCs even if cached")
    args = ap.parse_args()
    manifest = load_manifest()
    fetch(HF_PARQUET, RAW / "hf_aaai2025_train.parquet", manifest)
    fetch(HF_README, RAW / "hf_README.md", manifest)
    fetch("https://huggingface.co/api/datasets/ai-conferences/AAAI2025", RAW / "hf_api.json", manifest)
    for name, url in AAAI_PAGES.items():
        fetch(url, RAW / name, manifest)  # never refreshed: crawl-delay 43200
    for issue, ojs_id in OJS_ISSUES.items():
        dest = RAW / "ojs" / f"issue_{ojs_id}.html"
        if dest.exists() and not args.refresh_ojs:
            fetch(OJS_URL.format(ojs_id), dest, manifest)
            continue
        fetch(OJS_URL.format(ojs_id), dest, manifest, refresh=True)
        time.sleep(2)
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True), "utf-8")


if __name__ == "__main__":
    main()
