"""Minimal Elasticsearch REST client built on requests.

Connection settings come only from the environment:
  ELASTICSEARCH_URL   e.g. https://my-deployment.es.us-east-1.aws.elastic.cloud
  ELASTICSEARCH_API_KEY  base64 "id:key" API key (ELASTIC_API_KEY also accepted), or
  ELASTIC_USERNAME / ELASTIC_PASSWORD
Credentials are never logged; errors print the status and ES error type only.
"""
from __future__ import annotations

import json
import os
from typing import Any, Iterable

import requests


class ESError(RuntimeError):
    def __init__(self, status: int, body: Any):
        self.status = status
        self.body = body
        err = body.get("error") if isinstance(body, dict) else body
        reason = err.get("reason") if isinstance(err, dict) else str(err)[:300]
        super().__init__(f"Elasticsearch HTTP {status}: {reason}")


class ES:
    def __init__(self, url: str | None = None, api_key: str | None = None, timeout: int = 120):
        self.url = (url or os.environ.get("ELASTICSEARCH_URL") or "").rstrip("/")
        if not self.url:
            raise SystemExit("ELASTICSEARCH_URL is not set (see docs/DATA.md).")
        self.session = requests.Session()
        self.session.headers["content-type"] = "application/json"
        key = api_key or os.environ.get("ELASTICSEARCH_API_KEY") or os.environ.get("ELASTIC_API_KEY")
        if key:
            self.session.headers["authorization"] = f"ApiKey {key}"
        elif os.environ.get("ELASTIC_USERNAME"):
            self.session.auth = (os.environ["ELASTIC_USERNAME"], os.environ.get("ELASTIC_PASSWORD", ""))
        self.timeout = timeout

    def request(self, method: str, path: str, body: Any = None, params: dict | None = None,
                ok: Iterable[int] = (200, 201)) -> Any:
        data = body if isinstance(body, (str, bytes)) or body is None else json.dumps(body)
        if isinstance(body, str) and path.endswith("_bulk"):
            self.session.headers["content-type"] = "application/x-ndjson"
        try:
            resp = self.session.request(method, self.url + path, data=data, params=params, timeout=self.timeout)
        finally:
            self.session.headers["content-type"] = "application/json"
        try:
            parsed = resp.json()
        except ValueError:
            parsed = resp.text
        if resp.status_code not in ok:
            raise ESError(resp.status_code, parsed)
        return parsed

    def info(self) -> dict:
        return self.request("GET", "/")

    def exists(self, index: str) -> bool:
        return self.session.head(self.url + "/" + index, timeout=self.timeout).status_code == 200

    def bulk(self, lines: list[dict], refresh: str | None = None) -> dict:
        payload = "\n".join(json.dumps(l) for l in lines) + "\n"
        return self.request("POST", "/_bulk", payload, params={"refresh": refresh} if refresh else None)

    def search(self, index: str, body: dict) -> dict:
        return self.request("POST", f"/{index}/_search", body)

    def mget(self, index: str, ids: list[str], source: list[str] | None = None) -> dict:
        params = {"_source_includes": ",".join(source)} if source else None
        return self.request("POST", f"/{index}/_mget", {"ids": ids}, params=params)

    def get(self, index: str, doc_id: str) -> dict | None:
        from urllib.parse import quote
        r = self.request("GET", f"/{index}/_doc/{quote(doc_id, safe='')}", ok=(200, 404))
        return r if r.get("found") else None

    def refresh(self, index: str) -> None:
        self.request("POST", f"/{index}/_refresh")


# HTTP statuses for which a bulk item can succeed on retry.
RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504}


def split_bulk_failures(resp: dict) -> tuple[list[dict], list[dict]]:
    """Return (retryable, permanent) failed items from a bulk response."""
    retryable, permanent = [], []
    for item in resp.get("items", []):
        op = next(iter(item.values()))
        if op.get("status", 200) < 300:
            continue
        rec = {"_id": op.get("_id"), "status": op.get("status"),
               "type": (op.get("error") or {}).get("type"),
               "reason": ((op.get("error") or {}).get("reason") or "")[:300]}
        (retryable if op.get("status") in RETRYABLE_STATUSES else permanent).append(rec)
    return retryable, permanent
