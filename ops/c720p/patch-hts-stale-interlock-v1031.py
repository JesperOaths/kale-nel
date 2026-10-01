#!/usr/bin/env python3
from pathlib import Path
import shutil
import time

TARGET = Path("/home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py")
MARKER = "# C720P_HTS_STALE_INTERLOCK_RECOVERY_V2"
RETRY_AFTER = 120

s = TARGET.read_text(encoding="utf-8")
if MARKER in s:
    print("PATCH=ALREADY_PRESENT")
    raise SystemExit(0)

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups/hts-stale-interlock-v1031-" + stamp + ".py")
backup.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup)

anchor = '''    before_on = before_state == "on"

    # A previous unconfirmed toggle is a hard interlock.  If the receiver is not
'''
replacement = '''    before_on = before_state == "on"

    # C720P_HTS_STALE_INTERLOCK_RECOVERY_V2
    # A fresh ON command shadow is intentionally enough to advance into source
    # selection, but never enough to claim live confirmation. This prevents a
    # second POWER toggle during the receiver's boot window.
    if want_on and bool(before.get("shadow_fresh")) and str(before.get("commanded_state") or "").lower() == "on":
        return {
            "ok": True,
            "confirmed": False,
            "state": "on_provisional",
            "action": "none_recent_guarded_on_command",
            "wanted": wanted,
            "presence_before": before,
            "presence_after": before,
            "guard": "fresh_command_shadow_prevents_double_toggle",
        }

    # A previous unconfirmed toggle is a temporary interlock. While it is fresh
'''
if anchor not in s:
    raise SystemExit("anchor_before_on_not_found")
s = s.replace(anchor, replacement, 1)

old = '''    unresolved_toggle = (
        not before_on
        and saved.get("confirmed") is False
        and saved.get("state") == "unknown"
        and saved.get("action") in {"single_power_toggle", "power_toggle_failed"}
    )
    if unresolved_toggle:
        return {
            "ok": False,
            "confirmed": False,
            "state": "unknown",
            "action": "refused_unresolved_previous_toggle",
            "wanted": wanted,
            "presence_before": before,
            "previous_result": saved,
            "guard": "unknown_state_interlock_no_blind_toggle",
        }
'''
new = '''    unresolved_toggle = (
        not before_on
        and saved.get("confirmed") is False
        and saved.get("state") == "unknown"
        and saved.get("action") in {"single_power_toggle", "power_toggle_failed"}
    )
    try:
        unresolved_age = max(0, int(time.time()) - int(saved.get("updated_at") or 0))
    except Exception:
        unresolved_age = None

    if unresolved_toggle:
        net = before.get("network") if isinstance(before.get("network"), dict) else {}
        no_live_evidence = (
            not bool(before.get("live_present"))
            and not bool(before.get("bluetooth_present"))
            and not bool(before.get("connected"))
            and not bool(net.get("present"))
            and not bool(before.get("shadow_fresh"))
        )
        stale_recovery_allowed = bool(
            want_on
            and no_live_evidence
            and unresolved_age is not None
            and unresolved_age >= 120
        )
        if not stale_recovery_allowed:
            return {
                "ok": False,
                "confirmed": False,
                "state": "unknown",
                "action": "refused_unresolved_previous_toggle",
                "wanted": wanted,
                "presence_before": before,
                "previous_result": saved,
                "interlock_age_seconds": unresolved_age,
                "retry_after_seconds": 120,
                "guard": "unknown_state_interlock_no_blind_toggle",
            }
        # The stale interlock is older than the recovery window and all live
        # evidence is absent. Fall through to the normal ON-only absent-signal
        # inference below, which still permits exactly one POWER toggle.
'''
if old not in s:
    raise SystemExit("unresolved_toggle_block_not_found")
s = s.replace(old, new, 1)

TARGET.write_text(s, encoding="utf-8")
print("PATCH=APPLIED")
print("BACKUP=" + str(backup))
print("RETRY_AFTER_SECONDS=120")
