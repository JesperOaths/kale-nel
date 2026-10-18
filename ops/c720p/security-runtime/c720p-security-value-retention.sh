#!/usr/bin/env bash
# Retain legacy camera archives only after positive idle-health evidence.
set -uo pipefail
DRY_RUN=0
case "${1:-}" in --dry-run) DRY_RUN=1;; "") ;; *) echo "usage: $0 [--dry-run]" >&2; exit 2;; esac
run_one(){
  local name="$1" port="$2" py="$3" src="$4" unit="$5" rec
  if [ ! -f "$src" ];then
    if systemctl --user is-active --quiet "$unit";then
      echo "$name RETENTION=ERROR_ACTIVE_SOURCE_MISSING";return 1
    fi
    echo "$name RETENTION=SKIP_RETIRED_SOURCE";return 0
  fi
  if ! rec=$(curl -fsS --max-time 3 "http://127.0.0.1:${port}/health.json" 2>/dev/null |
    /usr/bin/python3 -c 'import json,sys
try:
 d=json.load(sys.stdin)
 if d.get("ok") is not True or type(d.get("recording")) is not bool:raise ValueError("invalid_health")
 print("1" if d["recording"] else "0")
except Exception:raise SystemExit(2)' 2>/dev/null);then
    echo "$name RETENTION=SKIP_HEALTH_UNAVAILABLE";return 0
  fi
  if [ "$rec" = 1 ];then echo "$name RETENTION=SKIP_RECORDING";return 0;fi
  if [ "$DRY_RUN" = 1 ];then echo "$name RETENTION=DRY_RUN_IDLE";return 0;fi
  "$py" - "$src" "$name" <<'PY'
import importlib.util,sys,os
src,name=sys.argv[1:3]
sys.path.insert(0, os.path.dirname(src))
sp=importlib.util.spec_from_file_location('retention_'+name,src);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
b=len(m.load_index());m.retain(m.load_config());a=len(m.load_index());print(name,'RETENTION=PASS','before',b,'after',a)
PY
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]];then
 result=0
 run_one new 8793 /home/jespern/c720p-security-camera-new/.venv/bin/python /home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py c720p-frontyard-security-new.service || result=1
 run_one s3 8791 /usr/bin/python3 /home/jespern/c720p-security-camera/c720p-frontyard-security.py c720p-frontyard-security.service || result=1
 exit "$result"
fi
