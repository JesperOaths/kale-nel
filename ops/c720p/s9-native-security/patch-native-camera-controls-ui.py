#!/usr/bin/env python3
"""Attach existing Security Controls tab to native Camera2 authenticated relay."""
from pathlib import Path
import argparse,os
MARKER="S9_NATIVE_CAMERA2_SECURITY_CONTROLS_V1"
PATTERN="headers:{'content-type':'application/json'},body:JSON.stringify({key,value:sel.value})"
UPDATED="headers:{'content-type':'application/json','X-S9-Camera-Control-Intent':'explicit-user-selection-v1'},body:JSON.stringify({key,value:sel.value})"
def patch(s):
 if MARKER in s:return s
 if s.count(PATTERN)!=1 or "async function loadControls(cam,prefix)" not in s or "cameraControls" not in s:
  raise ValueError("unexpected_security_controls_layout")
 s=s.replace(PATTERN,UPDATED,1)
 s=s.replace("function refreshControls(){loadControls('new','camera')}",
  "/* "+MARKER+" */function refreshControls(){loadControls('new','camera')}",1)
 return s
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument('--page',type=Path,default=Path('/opt/homeassistant/config/www/c720p-surveillance.html'))
 args=p.parse_args()
 a=args.page.read_text();b=patch(a)
 if a!=b:
  t=args.page.with_name(args.page.name+".s9-native-controls-stage")
  t.write_text(b);os.chmod(t,args.page.stat().st_mode & 0o777);os.replace(t,args.page)
 print("S9_NATIVE_CAMERA2_CONTROLS_PANEL", "present" if a==b else "patched")
