from pathlib import Path
import re,shutil,datetime,json,subprocess,time

W=Path('/opt/homeassistant/config/www')
p=W/'c720p-tv-surround-v21.html'
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
B=Path('/home/jespern/c720p-backups')/f'tv-surround-v98-{stamp}'
B.mkdir(parents=True,exist_ok=True)
shutil.copy2(p,B/(p.name+'.before'))

s=p.read_text(encoding='utf-8')

# Better backend error extraction: avoid "failed: unknown" when the real nested cause is s5_unreachable.
old='''    if(!r.ok||j.ok===false)throw new Error(j.failure||j.error||j.state||("HTTP "+r.status));'''
new='''    if(!r.ok||j.ok===false){
      const nested=j?.power_result?.error||j?.s5?.error||j?.ready?.error||j?.wake?.error||j?.result?.error;
      const state=(j.state&&j.state!=="unknown")?j.state:"";
      throw new Error(j.failure||nested||j.error||state||j.action||("HTTP "+r.status));
    }'''
if old not in s: raise SystemExit('req error line not found')
s=s.replace(old,new,1)

# Make one deliberate recovery attempt instead of two long scans per click.
s=s.replace('for(let attempt=1;attempt<=2;attempt++){','for(let attempt=1;attempt<=1;attempt++){',1)
s=s.replace('e.irP.textContent="IR OFFLINE";','e.irP.textContent="IR Offline";',1)
s=s.replace('else{e.irP.textContent="IR Search";e.irP.className="pill unknown"}',
            'else{e.irP.textContent="IR Offline";e.irP.className="pill bad"}',1)

# Accurate labels/capitalization and honest degraded-state copy.
s=s.replace('tvState===true?"Turn TV off":"Turn TV On"','tvState===true?"Turn TV Off":"Turn TV On"')
s=s.replace('htsState===true?"Turn HTS off":"Turn HTS On"','htsState===true?"Turn HTS Off":"Turn HTS On"')
s=s.replace('"Tap to Find S5 IR Bridge"','"S5 Offline · Tap to Retry"')
s=s.replace('"Tap to Rediscover S5 IR Bridge"','"S5 Offline · Tap to Retry"')
s=s.replace('status("TV Ready · S5 IR Offline · Bluetooth Fallback Available");',
            'status("TV Ready · S5 IR Offline · HTS Controls Will Retry IR");')

# Replace volumeAction so it either uses the live BT sink immediately, or explicitly recovers IR
# before sending a physical receiver volume command. No 15s blind timeout.
m=re.search(r'async function volumeAction\(dir\)\{.*?\n\}',s,re.S)
if not m: raise SystemExit('volumeAction not found')
volume='''async function volumeAction(dir){
  try{
    const m=await req(8790,"/state","GET",4500);
    if(m.live_ready&&m.bluetooth_connected&&m.audio_sink_present){
      return req(8790,"/volume/"+dir,"POST",7000);
    }
  }catch(_){}
  if(!irReady){
    status("Finding S5 IR bridge for HTS volume…");
    await ensureIR();
  }
  return req(8789,"/ht-e6500/volume/"+dir,"POST",30000);
}'''
s=s[:m.start()]+volume+s[m.end():]

# HTS power button now visibly performs the same recovery first instead of relying on opaque nested backend work.
old='''e.hts.onclick=()=>action(htsState===true?"Turning HTS off":"Turning HTS on",
  ()=>req(8789,htsState===true?"/ht-e6500/ensure-off":"/ht-e6500/ensure-on","POST",36000),1800);'''
new='''e.hts.onclick=()=>action(htsState===true?"Turning HTS Off":"Turning HTS On",async()=>{
  if(!irReady)await ensureIR();
  return req(8789,htsState===true?"/ht-e6500/ensure-off":"/ht-e6500/ensure-on","POST",36000);
},1800);'''
if old not in s:
    # account for prior capitalization changes
    old=re.search(r'e\.hts\.onclick=\(\)=>action\(htsState===true\?.*?\),1800\);',s,re.S)
    if not old: raise SystemExit('HTS onclick not found')
    s=s[:old.start()]+new+s[old.end():]
else:s=s.replace(old,new,1)

s=s.replace('e.up.onclick=()=>action("HTSVolume +"','e.up.onclick=()=>action("HTS Volume +"')
s=s.replace('e.down.onclick=()=>action("HTSVolume −"','e.down.onclick=()=>action("HTS Volume −"')

# Surround macro: preflight recovery only when neither IR nor an already-live Bluetooth path exists.
old='''  busy=true;availability();status("Starting TV → HDMI 3 → HTS Bluetooth…");
  try{
    await req(8790,"/pipeline/bluetooth-fast","POST",8000);'''
new='''  busy=true;availability();status("Starting TV → HDMI 3 → HTS Bluetooth…");
  try{
    if(!irReady&&!mediaReady){
      status("Finding S5 IR bridge for Surround…");
      await ensureIR();
    }
    await req(8790,"/pipeline/bluetooth-fast","POST",8000);'''
if old not in s: raise SystemExit('macro start not found')
s=s.replace(old,new,1)

# Add a small degraded-state affordance so offline buttons look actionable, not broken.
css='''<style id="C720P_TV_USABILITY_V98">
.pill.bad{color:#ffb8ae!important;border-color:rgba(255,104,88,.30)!important;background:rgba(255,104,88,.08)!important}
.bridge-off:not(:disabled){opacity:1!important}
.bridge-off:not(:disabled) .sub{color:#e2ad79!important}
.btn:disabled,.macro:disabled{cursor:wait!important;opacity:.64!important}
</style>'''
if 'C720P_TV_USABILITY_V98' not in s:s=s.replace('</head>',css+'\n</head>',1)

p.write_text(s,encoding='utf-8')

# Bump nested card cache and parent weather-row cache. Do not resize anything.
row=W/'c720p-weather-row.html'
shutil.copy2(row,B/(row.name+'.before'))
rs=row.read_text(encoding='utf-8')
rs=re.sub(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+',
          '/local/c720p-tv-surround-v21.html?v=TV_USABILITY_V98_20261007',rs)
row.write_text(rs,encoding='utf-8')

cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
shutil.copy2(cfg,B/'lovelace.c720p_hub.before')
d=json.loads(cfg.read_text());aspect=None
def walk(x):
    global aspect
    if isinstance(x,dict):
        if x.get('type')=='iframe' and 'c720p-weather-row.html' in str(x.get('url','')):
            aspect=x.get('aspect_ratio')
            x['url']='/local/c720p-weather-row.html?v=TV_USABILITY_V98_20261007'
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
tmp=cfg.with_suffix('.tmp-tv98');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

r=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if r.returncode!=0:raise SystemExit(r.stdout+r.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}:break
    time.sleep(1)
else:raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)

print('WEATHER_ROW_ASPECT_PRESERVED='+str(aspect))
print('BACKUP='+str(B))
print('TV_SURROUND_V98=OK')
