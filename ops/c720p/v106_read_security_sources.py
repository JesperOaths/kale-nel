from pathlib import Path
for title,p in [
 ("DRIVE_RETENTION",Path("/home/jespern/c720p-home-hub/bin/c720p-drive-value-retention.py")),
 ("ARCHIVE_SERVER",Path("/home/jespern/c720p-home-hub/bin/c720p-drive-security-archive.py"))
]:
 print("==="+title+"===")
 print(p.read_text(encoding="utf-8",errors="replace"))
