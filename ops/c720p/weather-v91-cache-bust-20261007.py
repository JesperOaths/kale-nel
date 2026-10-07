from pathlib import Path
import json,subprocess,time,shutil
www=Path('/opt/homeassistant/config/www')
p=www/'c720p-weather-row.html'
s=p.read_text(encoding='utf-8')
s=s.replace('/local/c720p-weather-compact.html?v=WEATHER_METRICS_V90_20261007','/local/c720p-weather-compact.html?v=WEATHER_DATA_V91_20261007')
p.write_text(s,encoding='utf-8')
py=r'''import json,pathlib,shutil,time
p=pathlib.Path("/config/.storage/lovelace.c720p_hub");b=pathlib.Path("/config/.storage/lovelace.c720p_hub.before-weather-v91-"+time.strftime("%Y%m%d_%H%M%S"));shutil.copy2(p,b)
d=json.loads(p.read_text());h=next(x for x in d["data"]["config"]["views"] if x.get("path")=="home");root=h["cards"][0]
root["cards"][1]["url"]="/local/c720p-weather-row.html?v=WEATHER_DATA_V91_20261007"
tmp=p.with_suffix(".tmp-w91");tmp.write_text(json.dumps(d,separators=(",",":")));tmp.replace(p)
print("WEATHER_ROW="+root["cards"][1]["url"]);print("BACKUP="+str(b))'''
r=subprocess.run(['docker','exec','homeassistant','python3','-c',py],text=True,capture_output=True,timeout=30)
if r.returncode!=0: raise SystemExit(r.stdout+r.stderr)
print(r.stdout.strip())
rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit(rr.stdout+rr.stderr)
for _ in range(45):
 c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
 if c.stdout.strip() in {'200','302','401'}: break
 time.sleep(1)
else: raise SystemExit('HA did not return')
print('RESULT=WEATHER_V91_CACHE_BUSTED')
