"""Finish one already approved batch; no timer, future clips or new approval."""
import importlib.util,json,os,subprocess,sys,time
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path.insert(0,str(BASE/'bin'))
import s9_verified_people_v33 as people
import s9_sd_proxy_extension as proxy
import s9_archive_delete_v1 as deletion
people.review._sd_rows=lambda:{k:v for k,v in proxy.rows().items() if k not in deletion.deleted()}
def active():return subprocess.run(['systemctl','--user','is-active','c720p-verified-people-v33c.service'],capture_output=True,text=True,timeout=5).stdout.strip()=='active'
def main():
 for _ in range(720):
  if not active():break
  time.sleep(20)
 else:raise RuntimeError('initial_batch_did_not_finish')
 for attempt in range(3):
  approved=people.allowed();features=people.read('features.json',{'entries':{}})
  missing=[k for k in approved if k not in features['entries'] or features['entries'][k].get('error')]
  if not missing:break
  if attempt==2:raise RuntimeError('initial_clip_retries_failed')
  subprocess.run(['/usr/bin/python3','-u',str(BASE/'bin/verified-people-worker-v33.py')],check=True)
 for attempt in range(2):
  subprocess.run(['/usr/bin/python3','-u',str(BASE/'bin/refine-verified-motion-v33.py')],check=True)
  evaluation=people.read('motion-evaluation.json',{})
  if not evaluation.get('errors'):break
 else:raise RuntimeError('final_motion_retries_failed')
 for attempt in range(2):
  subprocess.run(['/usr/bin/python3','-u',str(BASE/'bin/refine-native-faces-v33.py')],check=True)
  evaluation=people.read('native-face-evaluation.json',{})
  if not evaluation.get('errors'):break
 else:raise RuntimeError('native_face_retries_failed')
 subprocess.run(['/usr/bin/python3',str(BASE/'bin/verify-people-live-v33.py')],check=True)
 print('APPROVED_PEOPLE_DATASET_COMPLETE',flush=True)
if __name__=='__main__':main()
