#!/usr/bin/env python3
"""Create or migrate the five conference indexes. Never deletes data.

    python3 scripts/setup_indexes.py            # create missing, add compatible fields
    python3 scripts/setup_indexes.py --check    # report only (exit 3 if incompatible)
    python3 scripts/setup_indexes.py --preflight  # version, license, inference endpoint

For an existing index:
- fields missing from the live mapping are added with PUT _mapping (compatible);
- a field whose type/inference_id differs is INCOMPATIBLE. The tool prints a
  reindex plan (new -vN index, _reindex, alias swap) and stops. Executing that
  plan is a manual, explicitly approved step; this script never drops an index.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from confdata import mappings as M  # noqa: E402
from confdata.es import ES, ESError  # noqa: E402


def diff(want: dict, have: dict, path: str = "") -> tuple[dict, list[str]]:
    """Return (properties to add, list of incompatibilities)."""
    add, bad = {}, []
    for name, spec in want.get("properties", {}).items():
        p = f"{path}{name}"
        cur = have.get("properties", {}).get(name)
        if cur is None:
            add[name] = spec
            continue
        wt, ht = spec.get("type", "object"), cur.get("type", "object")
        if wt != ht:
            bad.append(f"{p}: live type {ht}, wanted {wt}")
            continue
        if wt == "semantic_text" and spec.get("inference_id") != cur.get("inference_id"):
            bad.append(f"{p}: live inference_id {cur.get('inference_id')}, wanted {spec.get('inference_id')}")
        if "properties" in spec:
            sub_add, sub_bad = diff(spec, cur, p + ".")
            if sub_add:
                add[name] = {**({"type": wt} if wt != "object" else {}), "properties": sub_add}
            bad += sub_bad
    return add, bad


def preflight(es: ES) -> dict:
    info = es.info()
    out = {"cluster_name": info.get("cluster_name"), "version": info["version"]["number"],
           "build_flavor": info["version"].get("build_flavor")}
    try:
        lic = es.request("GET", "/_license")["license"]
        out["license"] = {"type": lic["type"], "status": lic["status"]}
    except ESError as e:
        out["license"] = f"unavailable ({e.status})"
    try:
        eps = es.request("GET", "/_inference/_all")["endpoints"]
        out["inference_endpoints"] = [f"{e['inference_id']} ({e['task_type']}, {e.get('service')})" for e in eps]
    except ESError as e:
        out["inference_endpoints"] = f"cannot list ({e.status}: {e})"
    iid = M.inference_id()
    out["configured_inference_id"] = iid
    try:
        r = es.request("POST", f"/_inference/{iid}", {"input": "flow matching for robot manipulation"})
        out["inference_probe"] = "ok: " + ",".join(r.keys())
    except ESError as e:
        out["inference_probe"] = f"FAILED {e}"
    try:
        es.request("POST", "/_security/user/_has_privileges", {"index": [{"names": ["conference-*"],
                   "privileges": ["create_index", "manage", "write", "read"]}]})
        out["privileges"] = "checked"
    except ESError as e:
        out["privileges"] = f"not checked ({e.status}; security may be disabled locally)"
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--preflight", action="store_true")
    args = ap.parse_args()
    es = ES()
    if args.preflight:
        print(json.dumps(preflight(es), indent=1))
        return 0
    incompatible = False
    for index, builder in M.ALL.items():
        want = builder()
        if not es.exists(index):
            if args.check:
                print(f"{index}: missing")
                continue
            es.request("PUT", f"/{index}", {"mappings": want})
            print(f"{index}: created")
            continue
        have = es.request("GET", f"/{index}/_mapping")[index]["mappings"]
        add, bad = diff(want, have)
        if bad:
            incompatible = True
            print(f"{index}: INCOMPATIBLE\n  " + "\n  ".join(bad))
            nxt = index.rsplit("-v", 1)[0] + "-v" + str(int(index.rsplit("-v", 1)[1]) + 1)
            print(f"  Plan (requires explicit approval): create {nxt} with the new mapping, "
                  f"POST _reindex {index} -> {nxt}, verify counts, point readers at {nxt}, keep {index} until signed off.")
            continue
        if add and not args.check:
            es.request("PUT", f"/{index}/_mapping", {"properties": add})
            print(f"{index}: added fields {sorted(add)}")
        else:
            print(f"{index}: up to date" if not add else f"{index}: would add {sorted(add)}")
    return 3 if incompatible else 0


if __name__ == "__main__":
    sys.exit(main())
