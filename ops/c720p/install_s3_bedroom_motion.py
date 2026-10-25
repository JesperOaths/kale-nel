#!/usr/bin/env python3
"""Install S3 bedroom-only motion sensor without changing retired S3 security service.

Uses existing writable automations.yaml and a local-only secret webhook.
No changes to S5, S9+, living-room motion, root-owned packages or security views.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time

HOME = Path("/home/jespern")
BASE = HOME / "c720p-home-hub"
CODE = BASE / "bin/s3-bedroom-motion.py"
CONF = BASE / "config/s3-bedroom-motion.json"
AUTOMATIONS = Path("/opt/homeassistant/config/automations.yaml")
UNIT = HOME / ".config/systemd/user/c720p-s3-bedroom-motion.service"
SOURCE = Path("/tmp/s3_bedroom_motion.py")
BEGIN = "# BEGIN C720P_S3_BEDROOM_SPOTS_V1"
END = "# END C720P_S3_BEDROOM_SPOTS_V1"
PYTHON = BASE / "person-detector/venv/bin/python"
SPOTS = [
    "light.lsc_smart_connect_gu10_rgb_cct",
    "light.lsc_smart_connect_gu10_rgb_cct_2",
    "light.lsc_smart_connect_gu10_rgb_cct_3",
]

def run(*argv):
    r=subprocess.run(argv, text=True, capture_output=True, timeout=45)
    if r.returncode:
        raise RuntimeError(f"failed ({r.returncode}): {' '.join(argv)}: {r.stderr[:400]}")
    return r.stdout.strip()

def automation_block(secret):
    ids = "\n".join(f"          - {x}" for x in SPOTS)
    conditions = " and ".join(f"is_state('{x}', 'off')" for x in SPOTS)
    return f"""
{BEGIN}
- id: c720p_s3_bedroom_spots_v1
  alias: C720P S3 motion - bedroom spots only
  description: 'S3 camera via ADB; only switches on the three bedroom GU10 spots when all are off.'
  triggers:
    - trigger: webhook
      webhook_id: {secret}
      allowed_methods:
        - POST
      local_only: true
  conditions:
    - condition: template
      value_template: "{{{{ {conditions} }}}}"
  actions:
    - action: light.turn_on
      target:
        entity_id:
{ids}
  mode: single
{END}
"""

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    if not SOURCE.exists() or not PYTHON.exists():
        raise SystemExit("missing detector source or venv")
    if not AUTOMATIONS.is_file() or not os.access(AUTOMATIONS,os.W_OK):
        raise SystemExit("Home Assistant automations.yaml not writable")
    run(str(PYTHON),str(SOURCE),"--self-test")
    if not args.apply:
        print(json.dumps({"ok":True,"planned":True,"targets":SPOTS,
              "automations_writable":True,"unit":str(UNIT)}))
        return
    CONF.parent.mkdir(parents=True,exist_ok=True)
    CODE.parent.mkdir(parents=True,exist_ok=True)
    UNIT.parent.mkdir(parents=True,exist_ok=True)
    if CONF.exists():
        config=json.loads(CONF.read_text())
        secret=str(config["webhook_id"])
    else:
        secret="c720p_s3_bedroom_"+secrets.token_hex(20)
        config={"adb_endpoint":"192.168.178.47:5555",
                "webhook_id":secret,
                "webhook":"http://127.0.0.1:8123/api/webhook/"+secret}
    current=AUTOMATIONS.read_text()
    if BEGIN in current:
        import re
        updated=re.sub(re.escape(BEGIN)+r".*?"+re.escape(END),
                       lambda _m:automation_block(secret).strip(),current,flags=re.S)
    else:
        updated=current.rstrip()+"\n\n"+automation_block(secret).strip()+"\n"
    stamp=time.strftime("%Y%m%d_%H%M%S")
    backup=BASE/"backups"/f"automations-before-s3-bedroom-{stamp}.yaml"
    backup.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(AUTOMATIONS,backup)
    temp=AUTOMATIONS.with_suffix(".s3-tmp")
    try:
        temp.write_text(updated)
        temp.replace(AUTOMATIONS)
        shutil.copy2(SOURCE,CODE)
        CODE.chmod(0o755)
        CONF.write_text(json.dumps(config,indent=2)+"\n")
        CONF.chmod(0o600)
        UNIT.write_text(f"""[Unit]
Description=C720P S3 independent bedroom camera motion (ADB)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={PYTHON} {CODE}
Restart=on-failure
RestartSec=12
WorkingDirectory={BASE}

[Install]
WantedBy=default.target
""")
        run("systemctl","--user","daemon-reload")
        run("systemctl","--user","enable","--now",UNIT.name)
    except Exception:
        shutil.copy2(backup,AUTOMATIONS)
        raise
    print(json.dumps({"ok":True,"installed":True,
      "webhook_configured":True,"automation_file_updated":True,
      "homeassistant_reload_required":True,
      "s3_camera_requires_connection":True,
      "backup":str(backup),"service":UNIT.name,"targets":SPOTS}))
if __name__=="__main__":
    main()
