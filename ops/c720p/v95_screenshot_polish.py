from pathlib import Path
import shutil,datetime,re,subprocess,time,json
W=Path('/opt/homeassistant/config/www')
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
B=Path('/home/jespern/c720p-backups')/f'v95-polish-{stamp}'
B.mkdir(parents=True,exist_ok=True)

def backup(p):
    if p.exists(): shutil.copy2(p,B/(p.name+'.before'))

# ---------- Agenda ----------
p=W/'c720p-extra-row-v85.html'; backup(p)
s=p.read_text(encoding='utf-8')
css=r'''<style id="C720P_AGENDA_LAYOUT_V95">
.calendarBox .agendaEvent{
  display:grid!important;
  grid-template-columns:38px minmax(0,1fr)!important;
  grid-template-rows:auto auto auto minmax(0,1fr) auto!important;
  column-gap:9px!important;
  row-gap:2px!important;
  padding:8px 10px!important;
  align-items:start!important;
}
.calendarBox .agendaIcon.ico{
  position:static!important;
  grid-column:1!important;
  grid-row:1 / 6!important;
  align-self:center!important;
  justify-self:center!important;
  width:32px!important;
  height:32px!important;
  border-radius:9px!important;
  background-size:18px 18px!important;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 3px 8px rgba(0,0,0,.14)!important;
}
.calendarBox .agendaTop{grid-column:2!important;grid-row:1!important;min-width:0!important}
.calendarBox .agendaDateTime{grid-column:2!important;grid-row:2!important;margin-top:1px!important;font-size:10px!important;line-height:12px!important}
.calendarBox .agendaTitle{grid-column:2!important;grid-row:3!important;margin-top:1px!important;font-size:14px!important;line-height:16px!important}
.calendarBox .agendaDesc{grid-column:2!important;grid-row:4!important;margin-top:1px!important}
.calendarBox .agendaSource{grid-column:2!important;grid-row:5!important;margin-top:0!important;padding-top:1px!important}
.calendarBox .agendaKind,.calendarBox .agendaCountdown{font-size:8px!important;padding:3px 6px!important}
</style>'''
if 'C720P_AGENDA_LAYOUT_V95' not in s:s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# ---------- Voice ----------
p=W/'c720p-voice-banner.html'; backup(p)
s=p.read_text(encoding='utf-8')
css=r'''<style id="C720P_VOICE_USE_SPACE_V95">
.inner{
  grid-template-columns:minmax(0,1fr)!important;
  grid-template-rows:minmax(0,1fr) 46px!important;
  gap:7px!important;
  padding:10px 12px 9px!important;
  align-items:stretch!important;
}
.main{
  grid-column:1!important;
  grid-row:1!important;
  display:grid!important;
  grid-template-columns:64px minmax(0,1fr)!important;
  align-items:center!important;
  gap:12px!important;
  min-width:0!important;
  min-height:0!important;
}
.orb{
  width:62px!important;height:62px!important;min-width:62px!important;
}
.copy{
  min-width:0!important;
  width:100%!important;
  display:grid!important;
  grid-template-rows:auto auto!important;
  align-content:center!important;
  gap:4px!important;
}
.title{
  font-size:23px!important;
  line-height:24px!important;
  white-space:normal!important;
  overflow:visible!important;
  text-overflow:clip!important;
  overflow-wrap:anywhere!important;
}
.detail{
  margin:0!important;
  font-size:12px!important;
  line-height:14px!important;
  max-height:30px!important;
  white-space:normal!important;
  overflow:hidden!important;
  text-overflow:clip!important;
  color:#c4d5e1!important;
}
.metrics{
  grid-column:1!important;
  grid-row:2!important;
  width:100%!important;
  height:46px!important;
  display:grid!important;
  grid-template-columns:repeat(4,minmax(0,1fr))!important;
  gap:6px!important;
}
.metric{
  min-width:0!important;
  min-height:46px!important;
  padding:5px 7px!important;
  display:grid!important;
  grid-template-rows:auto auto!important;
  align-content:center!important;
  justify-items:center!important;
  text-align:center!important;
}
.metric .label{font-size:8px!important;line-height:9px!important}
.metric .value{font-size:17px!important;line-height:18px!important;margin-top:2px!important}
.version{font-size:7px!important;opacity:.28!important}
</style>'''
if 'C720P_VOICE_USE_SPACE_V95' not in s:s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# ---------- Clock ----------
p=W/'c720p-time-mini.html'; backup(p)
clock='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#f7f5ef;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.box{
 height:100vh;min-height:0;border-radius:10px;
 background:radial-gradient(circle at 18% 0%,rgba(255,184,96,.14),transparent 38%),linear-gradient(155deg,#111b25,#080d13 72%);
 border:1px solid rgba(255,255,255,.09);
 padding:7px 11px 8px;
 display:grid;grid-template-rows:17px minmax(0,1fr) 19px;gap:2px;overflow:hidden
}
.top,.bottom{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.kicker{font-size:11px;line-height:12px;font-weight:1000;letter-spacing:.08em;text-transform:uppercase;color:#b5c2ce}
.year,.week{border-radius:999px;padding:2px 7px;border:1px solid rgba(255,189,112,.22);background:rgba(255,189,112,.10);font-size:10px;line-height:11px;font-weight:1000;color:#ffd29e;white-space:nowrap}
.timeRow{min-height:0;display:flex;align-items:center;justify-content:center;gap:4px}
.time{font-size:58px;line-height:.88;font-weight:1000;color:#ffbd70;letter-spacing:-.05em;font-variant-numeric:tabular-nums;text-shadow:0 4px 18px rgba(255,157,64,.12)}
.seconds{align-self:center;margin-top:20px;font-size:18px;line-height:19px;font-weight:1000;color:#b5c2ce;font-variant-numeric:tabular-nums}
.date{min-width:0;font-size:14px;line-height:15px;color:#f2f5f7;font-weight:1000;white-space:nowrap;overflow:hidden;text-overflow:clip;text-transform:capitalize}
@media(max-height:102px){.box{padding:5px 9px;grid-template-rows:14px minmax(0,1fr) 16px}.kicker{font-size:9px}.year,.week{font-size:8.5px}.time{font-size:49px}.seconds{font-size:15px;margin-top:16px}.date{font-size:11.5px}}
</style></head><body>
<div class="box"><div class="top"><span class="kicker">Local Time</span><span id="year" class="year">----</span></div><div class="timeRow"><span id="time" class="time">--:--</span><span id="seconds" class="seconds">:--</span></div><div class="bottom"><span id="date" class="date"></span><span id="week" class="week">Week --</span></div></div>
<script>
function isoWeek(d){const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));x.setUTCDate(x.getUTCDate()+4-(x.getUTCDay()||7));const y=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil((((x-y)/86400000)+1)/7)}
function tick(){const d=new Date(),parts=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(d),g=t=>parts.find(x=>x.type===t)?.value||"--";document.getElementById("time").textContent=g("hour")+":"+g("minute");document.getElementById("seconds").textContent=":"+g("second");document.getElementById("date").textContent=d.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});document.getElementById("year").textContent=d.getFullYear();document.getElementById("week").textContent="Week "+isoWeek(d)}
tick();setInterval(tick,1000)
</script></body></html>'''
p.write_text(clock,encoding='utf-8')

# ---------- TV & Surround ----------
p=W/'c720p-tv-surround-v21.html'; backup(p)
s=p.read_text(encoding='utf-8')
repls={
 'Turn HTS on':'Turn HTS On',
 'Turn TV on':'Turn TV On',
 ' volume +':'Volume +',
 ' volume −':'Volume −',
 'Connect surround':'Connect Surround',
 'IR SEARCH':'IR Search',
 'checking state…':'Checking State…',
 'tap to find S5 IR bridge':'Tap to Find S5 IR Bridge',
 'tap to rediscover S5 IR bridge':'Tap to Rediscover S5 IR Bridge',
 'Samsung HTS':'Samsung HTS',
 'music on the C720P':'Music on the C720P',
 'TV ready · S5 IR offline; Bluetooth path will still be tried':'TV Ready · S5 IR Offline · Bluetooth Fallback Available'
}
for a,b in repls.items():s=s.replace(a,b)
css=r'''<style id="C720P_TV_TEXT_V95">
.title{font-size:16px!important;line-height:18px!important}
.pill{font-size:8.5px!important;text-transform:none!important;letter-spacing:.02em!important}
.btn,.macro{font-size:13px!important;line-height:14px!important;font-weight:1000!important;text-transform:none!important}
.btn .sub,.macro .sub{font-size:9px!important;line-height:10px!important;font-weight:780!important;text-transform:none!important;color:#b8c9d5!important}
.foot{font-size:9px!important;line-height:10px!important;font-weight:800!important}
</style>'''
if 'C720P_TV_TEXT_V95' not in s:s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# ---------- Cache bumps only; preserve outer sizes ----------
cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
shutil.copy2(cfg,B/'lovelace.c720p_hub.before')
d=json.loads(cfg.read_text())
aspects={}
def walk(x):
    if isinstance(x,dict):
        if x.get('type')=='iframe':
            u=str(x.get('url',''));a=x.get('aspect_ratio')
            if 'c720p-voice-banner.html' in u:aspects['voice']=a;x['url']='/local/c720p-voice-banner.html?c720p_build=VOICE_USE_SPACE_V95_20261007'
            elif 'c720p-time-mini.html' in u:aspects['clock']=a;x['url']='/local/c720p-time-mini.html?c720p_build=CLOCK_READABLE_V95_20261007'
            elif 'c720p-extra-row-v85.html' in u:aspects['extra']=a;x['url']='/local/c720p-extra-row-v85.html?v=AGENDA_LAYOUT_V95_20261007'
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
tmp=cfg.with_suffix('.tmp-v95');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

# Nested TV cache.
row=W/'c720p-weather-row.html'; backup(row)
s=row.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+','/local/c720p-tv-surround-v21.html?v=TV_TEXT_V95_20261007',s)
row.write_text(s,encoding='utf-8')

r=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if r.returncode!=0:raise SystemExit(r.stdout+r.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}:break
    time.sleep(1)
else:raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)
print('ASPECTS_PRESERVED='+json.dumps(aspects,sort_keys=True))
print('BACKUP='+str(B))
print('V95_APPLIED=OK')
