#!/usr/bin/env python3
"""Read-only print of the active Archive bulk handler for exact patching."""
from pathlib import Path
import hashlib
p=Path("/opt/homeassistant/config/www/frontyard-security-new/archive-review-v32.js")
if not p.is_file() or p.is_symlink():raise RuntimeError("source_missing")
s=p.read_text()
if not 10000<len(s)<30000 or "archiveBulkDeleteV32" not in s:raise RuntimeError("not_expected_review_handler")
print("ACTIVE_ARCHIVE_BULK_SHA256",hashlib.sha256(s.encode()).hexdigest())
print("BEGIN_ARCHIVE_JS")
print(s)
print("END_ARCHIVE_JS")
