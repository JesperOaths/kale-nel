#!/usr/bin/env python3
"""Ensure APT archive cleanup cannot be triggered by routine PR merges."""
from pathlib import Path
workflow = (Path(__file__).resolve().parents[2] /
    ".github/workflows/c720p-apt-cache-clean-v26.yml").read_text()
assert "\non:\n  workflow_dispatch:\n" in workflow
assert "    branches: [main]" in workflow
assert "  pull_request:" in workflow and "  push:" in workflow
assert "confirm_live_cleanup:" in workflow
assert "required: true" in workflow and "type: string" in workflow
job = workflow.split("\n  reclaim:\n", 1)[1]
assert "needs: test" in job
assert "github.event_name == 'workflow_dispatch'" in job
assert "github.ref == 'refs/heads/main'" in job
assert "github.repository == 'JesperOaths/kale-nel'" in job
assert "inputs.confirm_live_cleanup == 'APPLY-C720P-APT-CACHE'" in job
assert "github.event_name == 'push'" not in job
assert "clean-apt-cache-face-v26.py" in job
assert " --apply" in job
assert "python3 ops/c720p/test-apt-reclaim-manual-gate-v255.py" in workflow
print("C720P_APT_MANUAL_ONLY_GATE_PASS")
