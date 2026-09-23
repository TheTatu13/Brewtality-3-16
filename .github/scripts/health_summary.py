#!/usr/bin/env python3
"""Weekly digest of scheduled-workflow health, filed as a GitHub issue.

Looks at every scheduled ("cron") run from the last 7 days, tallies
success/failure per workflow, and opens (or updates) a `health-summary`
issue with the results. Read-only against run history -- this only ever
writes its own digest issue, nothing else.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def main() -> None:
    since = datetime.now(timezone.utc) - timedelta(days=7)

    raw = gh("run", "list", "--limit", "100", "--json", "name,conclusion,createdAt,event,url")
    runs = json.loads(raw)
    recent = [
        r for r in runs
        if r["event"] == "schedule"
        and datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00")) >= since
    ]

    by_name: dict[str, dict] = {}
    for r in recent:
        s = by_name.setdefault(
            r["name"],
            {"total": 0, "success": 0, "failed": 0, "other": 0, "fail_urls": []},
        )
        s["total"] += 1
        conclusion = r.get("conclusion")
        if conclusion == "success":
            s["success"] += 1
        elif conclusion == "failure":
            s["failed"] += 1
            s["fail_urls"].append(r["url"])
        else:
            s["other"] += 1

    if by_name:
        rows = ["| Workflow | Runs | Success | Failed | Other |", "|---|---|---|---|---|"]
        failed_lines: list[str] = []
        for name in sorted(by_name):
            s = by_name[name]
            rows.append(f"| {name} | {s['total']} | {s['success']} | {s['failed']} | {s['other']} |")
            if s["failed"]:
                links = ", ".join(f"[run]({u})" for u in s["fail_urls"])
                failed_lines.append(f"- **{name}**: {links}")
        table = "\n".join(rows)
    else:
        table = "_No scheduled runs in the last 7 days._"
        failed_lines = []

    total_runs = len(recent)
    total_failed = sum(s["failed"] for s in by_name.values())

    body_parts = [
        "## Scheduled workflow runs (last 7 days)",
        "",
        table,
        "",
        f"**Total runs:** {total_runs} · **Failed:** {total_failed}",
    ]
    if failed_lines:
        body_parts += ["", "### Failed runs", *failed_lines]
    body = "\n".join(body_parts)

    week = datetime.now(timezone.utc).strftime("%G-W%V")
    title = f"Weekly health summary: {week}"
    label = "health-summary"

    subprocess.run(
        [
            "gh", "label", "create", label,
            "--color", "0e8a16",
            "--description", "Weekly automated workflow health digest",
        ],
        capture_output=True,
    )

    existing = json.loads(gh(
        "issue", "list", "--label", label, "--state", "open",
        "--search", f'"{title}" in:title', "--json", "number",
    ))
    if existing:
        gh("issue", "edit", str(existing[0]["number"]), "--body", body)
        print(f"Updated issue #{existing[0]['number']}")
    else:
        url = gh("issue", "create", "--title", title, "--label", label, "--body", body)
        print(f"Created issue: {url.strip()}")


if __name__ == "__main__":
    sys.exit(main())
