"""Update only the HA Security iframe cache key, preserving a private rollback."""
import datetime,subprocess,time,urllib.request

OLD='/local/c720p-surveillance.html?v=person-folders-v31-20261014'
NEW='/local/c720p-surveillance.html?v=archive-review-v32-20261014'

def container(code):
 result=subprocess.run(['docker','exec','-i','homeassistant','python3','-'],input=code,text=True,capture_output=True,timeout=25)
 if result.returncode:raise RuntimeError(result.stderr[-500:])
 return result.stdout.strip()

def available():
 try:
  with urllib.request.urlopen('http://127.0.0.1:8123/',timeout=3) as response:return response.status==200
 except Exception:return False

def main():
 # Both SSH and the outbound maintenance agent remain independent of HA.
 subprocess.run(['systemctl','--user','is-active','c720p-agent-runner.service'],check=True,capture_output=True,timeout=10)
 assert available(),'home_assistant_not_healthy_before_change'
 with urllib.request.urlopen('http://127.0.0.1:8123/local/c720p-surveillance.html?v=archive-review-v32-20261014',timeout=10) as response:
  html=response.read().decode()
 assert 'SECURITY_HUB_V30' in html and 'archive-review-v32-20261014' in html
 backup='/config/.storage/lovelace.c720p_hub.before-security-entry-v32-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 code="""import copy,hashlib,json,os,pathlib
p=pathlib.Path('/config/.storage/lovelace.c720p_hub');raw=p.read_bytes();d=json.loads(raw);before=copy.deepcopy(d)
views=d['data']['config']['views'];targets=[v for v in views if v.get('path')=='front-yard-security'];assert len(targets)==1
cards=targets[0]['cards'];assert len(cards)==1 and cards[0].get('type')=='iframe';assert cards[0]['url']==OLD
b=pathlib.Path(BACKUP);assert not b.exists();b.write_bytes(raw);os.chmod(b,p.stat().st_mode&0o777)
cards[0]['url']=NEW;check=copy.deepcopy(d);next(v for v in check['data']['config']['views'] if v.get('path')=='front-yard-security')['cards'][0]['url']=OLD;assert check==before
tmp=p.with_name(p.name+'.tmp-security-entry-v32');assert not tmp.exists()
with tmp.open('wb') as f:f.write(json.dumps(d,separators=(',',':')).encode());f.flush();os.fsync(f.fileno())
os.chmod(tmp,p.stat().st_mode&0o777);tmp.replace(p)
print(json.dumps({'backup':BACKUP,'old_url':OLD,'new_url':NEW,'only_security_url_changed':True}))
"""
 header='OLD='+repr(OLD)+'\nNEW='+repr(NEW)+'\nBACKUP='+repr(backup)+'\n'
 print(container(header+code),flush=True)
 subprocess.run(['docker','restart','--time','10','homeassistant'],check=True,capture_output=True,timeout=65)
 for _ in range(45):
  if available():break
  time.sleep(1)
 else:
  container('import pathlib\np=pathlib.Path("/config/.storage/lovelace.c720p_hub")\np.write_bytes(pathlib.Path('+repr(backup)+').read_bytes())')
  subprocess.run(['docker','restart','--time','10','homeassistant'],check=True,capture_output=True,timeout=65)
  raise RuntimeError('home_assistant_health_failed_entry_rolled_back')
 actual=container('import json,pathlib\nd=json.loads(pathlib.Path("/config/.storage/lovelace.c720p_hub").read_text())\nprint(next(v for v in d["data"]["config"]["views"] if v.get("path")=="front-yard-security")["cards"][0]["url"])')
 assert actual==NEW
 print('SECURITY_ENTRY_V32_REFRESHED_HOME_ASSISTANT_HEALTHY',flush=True)

if __name__=='__main__':main()
