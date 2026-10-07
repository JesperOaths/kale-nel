from pathlib import Path
import datetime, re, shutil, subprocess

HOME = Path("/home/jespern")
STAMP = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK = HOME / "c720p-backups" / f"security-v109-{STAMP}"
BACK.mkdir(parents=True, exist_ok=True)

SU = HOME / ".config/systemd/user/c720p-saved-thumbnailer-v106.service"
TU = HOME / ".config/systemd/user/c720p-saved-thumbnailer-v106.timer"
RU = HOME / ".config/systemd/user/c720p-drive-person-revalidate.service"
RT = HOME / ".config/systemd/user/c720p-drive-person-revalidate.timer"

for p in (SU, TU, RU, RT):
    if p.exists():
        shutil.copy2(p, BACK / (p.name + ".before"))

flock = shutil.which("flock")
if not flock:
    raise SystemExit("flock not found")

def replace_or_fail(text, pattern, replacement, label):
    out, n = re.subn(pattern, replacement, text, flags=re.M)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 replacement, got {n}")
    return out

# Thumbnail worker: fit each batch comfortably inside the service budget.
s = SU.read_text()
s = replace_or_fail(s, r"^Environment=C720P_THUMB_LIMIT=.*$", "Environment=C720P_THUMB_LIMIT=3", "thumb limit")
s = replace_or_fail(s, r"^Environment=C720P_THUMB_MAX_SECONDS=.*$", "Environment=C720P_THUMB_MAX_SECONDS=270", "thumb max seconds")
s = replace_or_fail(s, r"^TimeoutStartSec=.*$", "TimeoutStartSec=6min", "thumb timeout")
thumb_exec = (
    "ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-vision.lock "
    "/home/jespern/c720p-home-hub/person-detector/venv/bin/python "
    "/home/jespern/c720p-home-hub/bin/c720p-saved-thumbnailer-v108.py"
)
s = replace_or_fail(s, r"^ExecStart=.*$", thumb_exec, "thumb exec")
SU.write_text(s)

# Spread progressive backfill out enough that the home hub stays responsive.
t = TU.read_text()
if re.search(r"^OnUnitInactiveSec=", t, flags=re.M):
    t = re.sub(r"^OnUnitInactiveSec=.*$", "OnUnitInactiveSec=4min", t, flags=re.M)
else:
    t = t.replace("OnBootSec=3min\n", "OnBootSec=3min\nOnUnitInactiveSec=4min\n", 1)
if re.search(r"^RandomizedDelaySec=", t, flags=re.M):
    t = re.sub(r"^RandomizedDelaySec=.*$", "RandomizedDelaySec=30s", t, flags=re.M)
else:
    t = t.replace("[Timer]\n", "[Timer]\nRandomizedDelaySec=30s\n", 1)
TU.write_text(t)

# Serialize the dense revalidator with thumbnail generation so the two
# OpenCV/MobileNet jobs never compete for the C720P at the same time.
r = RU.read_text()
reval_exec = (
    "ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-vision.lock "
    "/home/jespern/c720p-home-hub/person-detector/venv/bin/python "
    "/home/jespern/c720p-home-hub/bin/c720p-drive-person-revalidate.py"
)
r = replace_or_fail(r, r"^ExecStart=.*$", reval_exec, "revalidator exec")
RU.write_text(r)

# Stop any pre-V109 workers before reload so the new mutual exclusion applies
# immediately. The revalidator timer remains enabled and will run later.
for unit in ("c720p-saved-thumbnailer-v106.service", "c720p-drive-person-revalidate.service"):
    subprocess.run(["systemctl", "--user", "stop", unit], text=True, capture_output=True, timeout=35)

subprocess.run(["systemctl", "--user", "daemon-reload"], check=True, timeout=20)
subprocess.run(["systemctl", "--user", "reset-failed", "c720p-saved-thumbnailer-v106.service"], text=True, capture_output=True, timeout=15)
subprocess.run(["systemctl", "--user", "enable", "--now", "c720p-saved-thumbnailer-v106.timer"], check=True, timeout=20)
subprocess.run(["systemctl", "--user", "enable", "--now", "c720p-drive-person-revalidate.timer"], check=True, timeout=20)

# Give thumbnails first use of the shared vision lock; revalidation resumes on
# its normal timer rather than competing immediately after deployment.
subprocess.run(["systemctl", "--user", "start", "--no-block", "c720p-saved-thumbnailer-v106.service"], text=True, capture_output=True, timeout=10)

print(f"BACKUP={BACK}")
print("THUMB_LIMIT=3")
print("THUMB_MAX_SECONDS=270")
print("THUMB_TIMEOUT=6min")
print("THUMB_INTERVAL=4min")
print("VISION_LOCK=/run/user/1000/c720p-vision.lock")
print("SECURITY_V109=OK")
