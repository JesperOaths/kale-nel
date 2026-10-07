from pathlib import Path
import datetime
import py_compile
import shutil
import subprocess

BASE = Path("/home/jespern/c720p-home-hub")
CONNECT = BASE / "bin/openclaw-s5-adb-connect.sh"
REDISCOVER = BASE / "bin/c720p-s5-rediscover.py"
BACKUPS = Path("/home/jespern/c720p-backups")
MARKER = "C720P_S5_ADB_TCP_PERSISTENCE_V102"

stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup = BACKUPS / f"s5-adb-tcp-persistence-v102-{stamp}"
backup.mkdir(parents=True, exist_ok=False)
for p in (CONNECT, REDISCOVER):
    shutil.copy2(p, backup / (p.name + ".before"))

s = CONNECT.read_text(encoding="utf-8")
if MARKER not in s:
    anchor = '"$ADB" -s "${S5_HOST}:${S5_PORT}" shell settings put global wifi_sleep_policy 2 >/dev/null 2>&1 || true\n'
    insert = anchor + (
        f'# {MARKER}\n'
        '"$ADB" -s "${S5_HOST}:${S5_PORT}" shell setprop persist.adb.tcp.port 5555 >/dev/null 2>&1 || true\n'
        '"$ADB" -s "${S5_HOST}:${S5_PORT}" shell setprop service.adb.tcp.port 5555 >/dev/null 2>&1 || true\n'
    )
    if anchor not in s:
        raise SystemExit("network persistence anchor not found in reconnect helper")
    s = s.replace(anchor, insert, 1)
    CONNECT.write_text(s, encoding="utf-8")

s = REDISCOVER.read_text(encoding="utf-8")
if MARKER not in s:
    anchor = "  ['adb','-s',target,'shell','settings','put','global','wifi_sleep_policy','2'],\n"
    insert = anchor + (
        "  ['adb','-s',target,'shell','setprop','persist.adb.tcp.port','5555'],\n"
        "  ['adb','-s',target,'shell','setprop','service.adb.tcp.port','5555'],\n"
    )
    if anchor not in s:
        raise SystemExit("harden_network_bridge anchor not found in rediscovery helper")
    s = s.replace(anchor, insert, 1)
    marker_anchor = "# C720P_S5_NETWORK_PERSISTENCE_V99\n"
    if marker_anchor in s:
        s = s.replace(marker_anchor, marker_anchor + f"# {MARKER}\n", 1)
    else:
        s = f"# {MARKER}\n" + s
    REDISCOVER.write_text(s, encoding="utf-8")

subprocess.run(["bash", "-n", str(CONNECT)], check=True)
py_compile.compile(str(REDISCOVER), doraise=True)

print("S5_ADB_TCP_PERSISTENCE_V102=OK")
print("BACKUP=" + str(backup))
print("CONNECT_MARKER=" + str(MARKER in CONNECT.read_text()))
print("REDISCOVER_MARKER=" + str(MARKER in REDISCOVER.read_text()))
