from pathlib import Path
import shutil,datetime,json,subprocess,time

W=Path('/opt/homeassistant/config/www')
p=W/'c720p-time-mini.html'
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
b=Path('/home/jespern/c720p-backups')/f'clock-v97-{stamp}'
b.mkdir(parents=True,exist_ok=True)
shutil.copy2(p,b/(p.name+'.before'))

s=p.read_text(encoding='utf-8')
s=s.replace('<span class="kicker">Local Time</span>','')
css='''<style id="C720P_CLOCK_SECONDARY_TEXT_V97">
/* V97: remove Local Time and spend that space on useful information. Main HH:MM remains unchanged. */
.box{
  grid-template-rows:20px minmax(0,1fr) 28px!important;
  padding:6px 11px 8px!important;
}
.top{
  justify-content:flex-end!important;
}
.kicker{display:none!important}
.year{
  font-size:15px!important;
  line-height:16px!important;
  font-weight:1000!important;
  padding:3px 9px!important;
}
.week{
  font-size:15px!important;
  line-height:16px!important;
  font-weight:1000!important;
  padding:3px 9px!important;
}
.seconds{
  font-size:25px!important;
  line-height:25px!important;
  font-weight:1000!important;
  margin-top:15px!important;
  color:#d7e0e7!important;
}
.date{
  font-size:20px!important;
  line-height:21px!important;
  font-weight:1000!important;
  letter-spacing:-.015em!important;
}
@media(max-height:102px){
  .box{grid-template-rows:17px minmax(0,1fr) 22px!important;padding:5px 9px!important}
  .year,.week{font-size:12.5px!important;line-height:13px!important;padding:2px 7px!important}
  .seconds{font-size:21px!important;line-height:21px!important;margin-top:12px!important}
  .date{font-size:16.5px!important;line-height:17px!important}
}
</style>'''
if 'C720P_CLOCK_SECONDARY_TEXT_V97' not in s:
    s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
shutil.copy2(cfg,b/'lovelace.c720p_hub.before')
d=json.loads(cfg.read_text())
aspect=None
def walk(x):
    global aspect
    if isinstance(x,dict):
        if x.get('type')=='iframe' and 'c720p-time-mini.html' in str(x.get('url','')):
            aspect=x.get('aspect_ratio')
            x['url']='/local/c720p-time-mini.html?c720p_build=CLOCK_SECONDARY_V97_20261007'
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
tmp=cfg.with_suffix('.tmp-clock97');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

r=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if r.returncode!=0:raise SystemExit(r.stdout+r.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}:break
    time.sleep(1)
else:raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)
print('CLOCK_ASPECT_PRESERVED='+str(aspect))
print('BACKUP='+str(b))
print('CLOCK_V97=OK')
