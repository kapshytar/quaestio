#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERITY_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
INTEGRATIONS_DOC="$VERITY_ROOT/docs/handoff/INTEGRATIONS_AND_KEYS.md"

SESSION_ID="${1:-}"
PLATFORM_CODE="${2:-IOS}"
LIMIT="${INGEST_SMOKE_LIMIT:-5}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Missing required tool: python3" >&2
  exit 1
fi

python3 - <<'PY' "$INTEGRATIONS_DOC" "$SESSION_ID" "$PLATFORM_CODE" "$LIMIT"
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

doc_path, session_arg, platform_code, limit_arg = sys.argv[1:5]
limit = int(limit_arg)
doc = Path(doc_path).read_text(encoding="utf-8")

url_match = re.search(r"https://[a-z0-9]+\.supabase\.co", doc)
key_match = re.search(r"eyJhbGciOiJIUzI1Ni[^\s`]+", doc)
if not url_match or not key_match:
    raise SystemExit("Could not resolve Supabase URL/service key from INTEGRATIONS_AND_KEYS.md")

base_url = url_match.group(0)
service_key = key_match.group(0)

headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
}


def rest(path: str, params: dict[str, str]) -> list[dict]:
    query = urllib.parse.urlencode(params, safe="(),.*")
    url = f"{base_url}/rest/v1/{path}?{query}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Supabase REST error {exc.code} for {path}: {body}") from exc


def print_section(title: str) -> None:
    print()
    print(f"== {title} ==")


if not session_arg:
    latest_rows = rest(
        "notes",
        {
            "select": "note_session_id,updated_at,title,origin_platform_code",
            "note_type": "eq.1",
            "origin_platform_code": f"eq.{platform_code}",
            "order": "updated_at.desc",
            "limit": "1",
        },
    )
    if not latest_rows:
        raise SystemExit(f"No note_type=1 rows found for platform {platform_code}")
    session_arg = str(latest_rows[0]["note_session_id"])

session_id = session_arg

print(f"Smoke check: session={session_id} platform={platform_code} limit={limit}")

notes = rest(
    "notes",
    {
        "select": "id,title,note_type,note_session_id,origin_platform_code,created_at,updated_at",
        "note_session_id": f"eq.{session_id}",
        "order": "updated_at.desc",
        "limit": str(limit),
    },
)

logs = rest(
    "ingest_debug_logs",
    {
        "select": "id,created_at,session_id,rpc_name,step,payload,rpc_result,source_platform_code",
        "session_id": f"eq.{session_id}",
        "source_platform_code": f"eq.{platform_code}",
        "order": "created_at.desc",
        "limit": str(limit),
    },
)

# Trim long fields so smoke-check stays cheap to read (especially in agent
# sessions where every byte of output counts). Pass INGEST_SMOKE_FULL=1 to
# disable truncation when a full payload is genuinely needed.
import os
TITLE_MAX = 0 if os.environ.get("INGEST_SMOKE_FULL") else 100

def trim(value, max_len=TITLE_MAX):
    if not value:
        return value or "-"
    s = str(value)
    if max_len <= 0 or len(s) <= max_len:
        return s
    return s[:max_len] + f"…(+{len(s)-max_len})"

print_section("Latest Root / Session Notes")
if not notes:
    print("No notes found.")
else:
    for row in notes:
        print(
            f"{row.get('updated_at')} | type={row.get('note_type')} | "
            f"S{row.get('note_session_id')} | {row.get('origin_platform_code')} | "
            f"{trim(row.get('title'))} | {row.get('id')}"
        )

print_section("Latest Ingest Debug Logs")
if not logs:
    print("No ingest_debug_logs found.")
else:
    for row in logs:
        payload = row.get("payload") or {}
        rpc_result = row.get("rpc_result") or {}
        responses = payload.get("responses") or []
        providers = ", ".join(
            provider
            for provider in [r.get("provider") for r in responses if isinstance(r, dict)]
            if provider
        )
        if not providers:
            providers = "-"
        note_id = (
            rpc_result.get("note_id")
            or payload.get("aggregated_note_id")
            or payload.get("note_id")
            or "-"
        )
        status = rpc_result.get("status") or payload.get("status") or "-"
        title = payload.get("title") or "-"
        print(
            f"{row.get('created_at')} | {row.get('step')} | providers=[{providers}] | "
            f"status={status} | note={note_id} | title={trim(title)}"
        )

print_section("Latest Provider Snapshot")
if not logs:
    print("No logs available.")
else:
    latest = logs[0]
    payload = latest.get("payload") or {}
    responses = payload.get("responses") or []
    if not responses:
        print("No responses in latest payload.")
    else:
        for item in responses:
            if not isinstance(item, dict):
                continue
            provider = item.get("provider", "?")
            text = item.get("text", "")
            preview = " ".join(str(text).split())[:180]
            print(f"{provider}: {preview}")
PY
