from pathlib import Path
import datetime, shutil, subprocess, time, json

HOME=Path('/home/jespern')
WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=HOME/'c720p-backups'/f'weather-v92-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)

p=WWW/'c720p-weather-compact.html'
shutil.copy2(p,BACK/(p.name+'.before'))
s=p.read_text(encoding='utf-8')

css='''<style id="C720P_WEATHER_METRIC_CORNERS_V92">
.metric{
  position:relative!important;
  display:block!important;
  padding:0!important;
}
.metric .label{
  position:absolute!important;
  left:9px!important;
  top:6px!important;
  right:auto!important;
  bottom:auto!important;
  width:auto!important;
  margin:0!important;
  padding:0!important;
  text-align:left!important;
  font-size:9px!important;
  line-height:10px!important;
  font-weight:950!important;
  letter-spacing:.055em!important;
  color:#c6d4df!important;
  white-space:nowrap!important;
}
.metric .value{
  position:absolute!important;
  right:9px!important;
  bottom:5px!important;
  left:auto!important;
  top:auto!important;
  width:auto!important;
  min-height:0!important;
  margin:0!important;
  padding:0!important;
  display:flex!important;
  align-items:baseline!important;
  justify-content:flex-end!important;
  gap:2px!important;
  text-align:right!important;
  white-space:nowrap!important;
  font-variant-numeric:tabular-nums!important;
}
.metricNum{
  font-size:20px!important;
  line-height:20px!important;
  font-weight:1000!important;
  letter-spacing:-.035em!important;
  color:#fff!important;
}
.metricUnit{
  font-size:10px!important;
  line-height:11px!important;
  font-weight:900!important;
  color:#d4e0e8!important;
}
</style>'''
s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# Bump nested compact weather cache in the row wrapper.
row=WWW/'c720p-weather-row.html'
r=row.read_text(encoding='utf-8')
r=r.replace('/local/c720p-weather-compact.html?v=WEATHER_DATA_V91_20261007',
            '/local/c720p-weather-compact.html?v=WEATHER_METRIC_CORNERS_V92_20261007')
row.write_text(r,encoding='utf-8')

# Bump the active Lovelace parent iframe too.
py=r'''import json,pathlib,shutil,time
p=pathlib.Path("/config/.storage/lovelace.c720p_hub")
b=pathlib.Path("/config/.storage/lovelace.c720p_hub.before-weather-v92-"+time.strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
d=json.loads(p.read_text())
h=next(x for x in d["data"]["config"]["views"] if x.get("path")=="home")
root=h["cards"][0]
root["cards"][1]["url"]="/local/c720p-weather-row.html?v=WEATHER_METRIC_CORNERS_V92_20261007"
tmp=p.with_suffix(".tmp-w92")
tmp.write_text(json.dumps(d,separators=(",",":")))
tmp.replace(p)
print("WEATHER_ROW="+root["cards"][1]["url"])
print("BACKUP="+str(b))'''
res=subprocess.run(['docker','exec','homeassistant','python3','-c',py],text=True,capture_output=True,timeout=30)
if res.returncode!=0: raise SystemExit(res.stdout+res.stderr)
print(res.stdout.strip())

rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit('HA restart failed: '+rr.stdout+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')

print('BACKUP_DIR='+str(BACK))
print('RESULT=WEATHER_V92_APPLIED')
