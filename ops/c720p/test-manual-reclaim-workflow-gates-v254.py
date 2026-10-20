#!/usr/bin/env python3
"""Prevent source-only C720P cleanup merges from submitting live deletion jobs.

Both maintenance flows retain explicitly opt-in, manual, branch-pinned apply
paths for a separately authorized future maintenance window.
"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
TARGETS = (
    (".github/workflows/c720p-guarded-disposable-reclaim.yml", "execute",
     "APPLY-C720P-DISPOSABLES", "reclaim-audited-disposable-20261014.py"),
    (".github/workflows/c720p-browser-cache-reclaim-20261014.yml", "clean",
     "APPLY-C720P-BROWSER-CACHES", "reclaim-browser-caches-20261014.py"),
)
for rel, job, confirmation, source in TARGETS:
    body = (ROOT / rel).read_text()
    assert "\non:\n  workflow_dispatch:\n" in body, rel
    assert "  pull_request:" in body and "  push:" in body, rel
    assert "    branches: [main]" in body, rel
    assert "confirm_live_cleanup:" in body, rel
    assert "required: true" in body and "type: string" in body, rel
    gate = body.split("\n  " + job + ":\n", 1)[1]
    assert "github.event_name == 'workflow_dispatch'" in gate, rel
    assert "github.ref == 'refs/heads/main'" in gate, rel
    assert "github.repository == 'JesperOaths/kale-nel'" in gate, rel
    assert "inputs.confirm_live_cleanup == '" + confirmation + "'" in gate, rel
    assert "github.event_name == 'push'" not in gate, rel
    assert " --apply" in gate and source in gate, rel
    assert "    needs: validate" in gate, rel
    print("C720P_RECLAIM_MANUAL_GATE_PASS", rel)
