from pathlib import Path
import datetime
import py_compile
import re
import shutil

SERVER = Path("/home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py")
BACKUPS = Path("/home/jespern/c720p-backups")
MARKER = "C720P_S5_NETWORK_ADB_PRIMARY_V100"

stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup = BACKUPS / f"tv-surround-network-adb-primary-v100-{stamp}"
backup.mkdir(parents=True, exist_ok=False)
shutil.copy2(SERVER, backup / (SERVER.name + ".before"))

s = SERVER.read_text(encoding="utf-8")
if MARKER not in s:
    connected_pat = re.compile(
        r"def connected\(\):\n.*?\n\ndef s5_on_current_lan\(\):",
        re.S,
    )
    connected_repl = """def connected():
    # C720P_S5_NETWORK_ADB_PRIMARY_V100
    # Normal control transport is the identity-verified Galaxy S5 over LAN ADB.
    # The physical USB serial remains recovery-only and is never preferred.
    r = adb_devices()
    device_hosts = parse_adb_device_hosts(r)

    current_host = TARGET.rsplit(":", 1)[0]
    ordered = ([current_host] if current_host in device_hosts else []) + [
        host for host in device_hosts if host != current_host
    ]
    identity_checks = []
    for host in ordered:
        ident = verify_s5_adb_host(host)
        identity_checks.append(ident)
        if ident.get("ok"):
            ident["transport"] = "adb_network"
            save_s5_target(host, "adb_devices_identity_verified")
            r["s5_identity"] = ident
            r["s5_transport"] = "adb_network"
            return True, r

    # Recovery fallback only: the same authorized S5 by exact USB serial.
    usb = verify_s5_usb()
    if usb.get("ok"):
        usb["transport"] = "usb_recovery_fallback"
        r["s5_identity"] = usb
        r["s5_transport"] = "usb_recovery_fallback"
        r["s5_identity_checks"] = identity_checks
        return True, r

    r["s5_identity_checks"] = identity_checks
    return False, r


def s5_on_current_lan():"""
    s2, n = connected_pat.subn(connected_repl, s, count=1)
    if n != 1:
        raise SystemExit("connected() block not found")
    s = s2

    send_pat = re.compile(
        r"def send_ir\(command, device=\"ht_e6500\"\):\n.*?\n\ndef lan_scan_range\(\):",
        re.S,
    )
    send_repl = """def send_ir(command, device="ht_e6500"):
    # Network ADB through the identity-verified Galaxy S5 is the primary path
    # for power, volume, source/menu and every other IR command.
    adb = send_ir_adb(command, device=device)
    if adb.get("ok"):
        adb["preferred_transport"] = "adb_network"
        return adb

    # Exact authorized USB S5 is recovery-only, never the normal route.
    usb = send_ir_fast_usb(command, device=device)
    if usb.get("ok"):
        usb["preferred_transport"] = "adb_network"
        usb["network_adb_failure"] = adb
        usb["fallback_reason"] = "network_adb_unavailable"
        return usb

    # Keep the existing S5 HTTP bridge as a final resilience path.
    http = send_ir_http(command)
    if http.get("ok"):
        http["preferred_transport"] = "adb_network"
        http["network_adb_failure"] = adb
        http["usb_fallback_failure"] = usb
        return http

    return {
        "ok": False,
        "command": command,
        "preferred_transport": "adb_network",
        "adb": adb,
        "usb_recovery": usb,
        "http_recovery": http,
    }


def lan_scan_range():"""
    s2, n = send_pat.subn(send_repl, s, count=1)
    if n != 1:
        raise SystemExit("send_ir() block not found")
    s = s2

SERVER.write_text(s, encoding="utf-8")
py_compile.compile(str(SERVER), doraise=True)
print("TV_SURROUND_NETWORK_ADB_PRIMARY_V100=OK")
print("BACKUP=" + str(backup))
print("MARKER=" + str(MARKER in SERVER.read_text()))
