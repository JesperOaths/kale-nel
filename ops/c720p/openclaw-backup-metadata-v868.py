#!/usr/bin/env python3
from pathlib import Path
root=Path("/home/jespern/openclaw-backups")
rows=[]
if root.exists():
    for p in root.rglob("*"):
        try:
            rel=p.relative_to(root)
            if p.is_file():
                rows.append(("f",str(rel),p.stat().st_size))
            elif p.is_dir():
                rows.append(("d",str(rel),0))
        except Exception:
            pass
for kind,path,size in rows[:240]:
    print(f"{kind} {size} {path}")
print("COUNT="+str(len(rows)))
print("RESULT=OPENCLAW_BACKUP_METADATA_V868_DONE")
