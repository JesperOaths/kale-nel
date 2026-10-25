#!/usr/bin/env python3
"""Configure S3 app direct local HA events without exposing its webhook ID in logs."""
from pathlib import Path
import json
import subprocess
cfg=json.loads(Path("/home/jespern/c720p-home-hub/config/s3-bedroom-motion.json").read_text())
token=str(cfg["webhook_id"])
assert token.startswith("c720p_s3_bedroom_") and len(token)>=30
url="http://192.168.178.141:8123/api/webhook/"+token
args=["adb","-s","192.168.178.47:5555","shell","am","start","-n",
      "nl.kalenel.s3motion/.MotionActivity",
      "--es","webhook",url,"--ez","verify_webhook_only","true"]
subprocess.run(args,check=True,stdout=subprocess.DEVNULL,timeout=35)
print("S3_DIRECT_LOCAL_WEBHOOK_CONFIGURED_AND_GET_TEST_STARTED")
