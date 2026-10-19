#!/usr/bin/env python3
"""Inspect C720P clock/NTP and repair only with existing passwordless sudo.

No privilege escalation workaround, token-validation relaxation, HA restart,
timezone change or camera interaction. Repair is explicitly opt-in.
"""
import argparse
import datetime
import json
import re
import shutil
import subprocess
import time

PACKAGE="systemd-timesyncd"
MIN_FREE_BYTES=256*1024*1024

def run(args,timeout=30):
    completed=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                             text=True,timeout=timeout,check=False)
    if completed.returncode:
        raise RuntimeError("command_failed_"+str(completed.returncode)+"_"+args[0])
    return completed.stdout

def status():
    raw=run(["timedatectl","show","-p","NTP","-p","NTPSynchronized",
             "-p","Timezone","-p","CanNTP"],timeout=12)
    values=dict(line.split("=",1) for line in raw.splitlines() if "=" in line)
    if values.get("Timezone")!="Europe/Amsterdam":
        raise RuntimeError("unexpected_timezone_no_automatic_change")
    return {"timezone":values["Timezone"],"ntp_enabled":values.get("NTP")=="yes",
            "clock_synchronized":values.get("NTPSynchronized")=="yes",
            "ntp_supported":values.get("CanNTP")=="yes"}

def repair():
    before=status()
    if before["ntp_enabled"] and before["clock_synchronized"]:
        return {"status":"already_synchronized","before":before,"after":before,
                "privileged_changes":False}
    if shutil.disk_usage("/").free<MIN_FREE_BYTES:
        raise RuntimeError("root_disk_free_below_safe_ntp_repair_reserve")
    # This may legitimately fail: the agent must not obtain or bypass a sudo
    # password, change sudoers, or weaken signed-media clock validation.
    run(["sudo","-n","-v"],timeout=10)
    simulated=run(["sudo","-n","apt-get","-s","install",
                   "--no-install-recommends",PACKAGE],timeout=35)
    # Refuse any APT transaction that removes existing packages or changes the
    # security-sensitive HA runtime unexpectedly.
    if any(re.match(r"(?m)^Remv\s",line) for line in simulated.splitlines()):
        raise RuntimeError("ntp_package_simulation_would_remove_packages")
    if not before["ntp_supported"]:
        run(["sudo","-n","apt-get","install","-y","--no-install-recommends",PACKAGE],timeout=150)
    run(["sudo","-n","timedatectl","set-ntp","true"],timeout=25)
    after=status()
    for _ in range(12):
        if after["clock_synchronized"]:break
        time.sleep(5)
        after=status()
    if not after["ntp_enabled"] or not after["clock_synchronized"]:
        raise RuntimeError("ntp_enabled_but_synchronization_not_confirmed")
    return {"status":"ntp_synchronized","before":before,"after":after,
            "privileged_changes":True,"timezone_preserved":True,
            "media_token_clock_validation_unchanged":True}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply",action="store_true",
                        help="Use already authorized passwordless sudo for guarded time service repair")
    args=parser.parse_args()
    result={"checked_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "operation":"ntp_repair" if args.apply else "clock_inspection",
            "camera_or_media_modified":False,"timezone_changed":False}
    try:
        result.update(repair() if args.apply else {"status":"read_only","clock":status(),
                                                    "privileged_changes":False})
    except Exception as problem:
        result.update(status="blocked",error_type=type(problem).__name__,
                      error_reason=str(problem)[:140],repair_verified=False)
    print("C720P_CLOCK_READINESS_V1 "+json.dumps(result,separators=(",",":"),sort_keys=True),flush=True)
    if result["status"]=="blocked":raise SystemExit(1)

if __name__=="__main__":main()
