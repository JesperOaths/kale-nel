from pathlib import Path
import shutil,datetime,json,re,subprocess,time

W=Path('/opt/homeassistant/config/www')
p=W/'c720p-time-mini.html'
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
b=Path('/home/jespern/c720p-backups')/f'clock-v96-{stamp}'
b.mkdir(parents=True,exist_ok=True)
shutil.copy2(p,b/(p.name+'.before'))

s=p.read_text(encoding='utf-8')
css='''<style id="C720P_CLOCK_SECONDARY_TEXT_V96">
/* Keep the main HH:MM unchanged. Make every supporting element readable at distance. */
.box{
  grid-template-rows:22px minmax(0,1fr) 25px!important;
  padding:7px 11px 8px!important;
}
.kicker{
  font-size:14px!important;
  line-height:15px!important;
  font-weight:1000!important;
  letter-spacing:.07em!important;
}
.year,.week{
  font-size:12.5px!important;
  line-height:14px!important;
  font-weight:1000!important;
  padding:3px 8px!important;
}
.seconds{
  font-size:22px!important;
  line-height:22px!important;
  font-weight:1000!important;
  margin-top:17px!important;
  color:#d3dce4!important;
}
.date{
  font-size:17px!important;
  line-height:18px!important;
  font-weight:1000!important;
  letter-spacing:-.01em!important;
}
@media(max-height:102px){
  .box{grid-template-rows:18px minmax(0,1fr) 20px!important;padding:5px 9px!important}
  .kicker{font-size:11.5px!important;line-height:12px!important}
  .year,.week{font-size:10.5px!important;line-height:11px!important;padding:2px 7px!important}
  .seconds{font-size:18px!important;line-height:18px!important;margin-top:14px!important}
  .date{font-size:14px!important;line-height:15px!important}
}
</style>'''
if 'C720P_CLOCK_SECONDARY_TEXT_V96' not in s:
    s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# Cache-bust only the clock iframe; preserve its exact outer aspect ratio.
cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
shutil.copy2(cfg,b/'lovelace.c720p_hub.before')
d=json.loads(cfg.read_text())
aspect=None
def walk(x):
    global aspect
    if isinstance(x,dict):
        if x.get('type')=='iframe' and 'c720p-time-mini.html' in str(x.get('url','')):
            aspect=x.get('aspect_ratio')
            x['url']='/local/c720p-time-mini.html?c720p_build=CLOCK_SECONDARY_V96_20261007'
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
tmp=cfg.with_suffix('.tmp-clock96');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

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
print('CLOCK_V96=OK')
