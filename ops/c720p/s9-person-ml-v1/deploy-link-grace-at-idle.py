#!/usr/bin/env python3
"""Wait for a safe camera idle boundary; then apply pre-validated S9 link grace."""
import json,time,urllib.request,subprocess,sys
end=time.monotonic()+175
last={}
while time.monotonic()<end:
 try:
  with urllib.request.urlopen('http://127.0.0.1:8793/health.json',timeout=6) as r:last=json.load(r)
  if last.get('camera_ok') and not last.get('recording'):
   print('CAMERA_IDLE_SAFE_BOUNDARY',flush=True)
   ret=subprocess.run(['/usr/bin/python3','/tmp/s9-link-grace.py'],timeout=85)
   sys.exit(ret.returncode)
 except Exception as e:
  print('CAMERA_HEALTH_TEMP_ERROR',type(e).__name__,flush=True)
 time.sleep(5)
print('DEFER_NO_SAFE_IDLE_WINDOW',{'camera_ok':last.get('camera_ok'),'recording':last.get('recording')},flush=True)
sys.exit(2)
