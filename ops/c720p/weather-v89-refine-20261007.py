from pathlib import Path
import datetime, shutil, subprocess, time, json

HOME=Path('/home/jespern')
WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=HOME/'c720p-backups'/f'weather-v89-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)
p=WWW/'c720p-weather-compact.html'
shutil.copy2(p,BACK/(p.name+'.before'))
s=p.read_text(encoding='utf-8')

# Make the small summary useful instead of duplicating the right-side "Feels like" metric.
s=s.replace('document.getElementById("summary").textContent="feels "+fmtTemp(feels)+" - "+(isFinite(rain)?rain.toFixed(1):"--")+" mm rain";',
            'document.getElementById("summary").textContent="Rain now "+(isFinite(rain)?rain.toFixed(1):"--")+" mm";')
# More compact / balanced high-low wording.
s=s.replace("el.innerHTML='<span class=\"max\">Today max --</span> &middot; <span class=\"min\">min --</span>'",
            "el.innerHTML='<span class=\"max\">High --</span><span class=\"min\">Low --</span>'")
s=s.replace("el.innerHTML='<span class=\"max\">Today max '+fmtTemp(x.high)+'</span> &middot; <span class=\"min\">min '+fmtTemp(x.low)+'</span>'",
            "el.innerHTML='<span class=\"max\">High '+fmtTemp(x.high)+'</span><span class=\"min\">Low '+fmtTemp(x.low)+'</span>'")

css='''<style id="C720P_WEATHER_REFINED_V89">
/* Keep the existing geometry, but make each information group read as an intentional panel. */
.card{
  background:
    radial-gradient(circle at 18% 42%,rgba(var(--rgb),.16),transparent 32%),
    radial-gradient(circle at 72% 18%,rgba(var(--rgb),.07),transparent 26%),
    linear-gradient(120deg,#071321 0%,#091522 48%,#0a1724 100%)!important;
}
.top{top:8px!important}
.title{font-size:17px!important;letter-spacing:.01em!important}
.source{padding:3px 8px!important;font-size:9px!important;background:rgba(3,9,15,.72)!important;border-color:rgba(var(--rgb),.35)!important;color:#dceaf5!important}

/* NOW card */
.tempBlock{
  left:12px!important;top:39px!important;width:150px!important;height:91px!important;
  padding:10px 11px 8px!important;border-radius:11px!important;
  background:linear-gradient(145deg,rgba(255,255,255,.075),rgba(255,255,255,.025))!important;
  border:1px solid rgba(255,255,255,.13)!important;
  box-shadow:inset 0 1px rgba(255,255,255,.05),0 5px 18px rgba(0,0,0,.12)!important;
}
.tempBlock::before{
  content:"NOW";position:absolute;right:9px;top:7px;
  font-size:7px;line-height:1;font-weight:1000;letter-spacing:.12em;color:rgba(255,255,255,.48)
}
.bigTemp{font-size:47px!important;line-height:.84!important;letter-spacing:-2.5px!important}
.condition{font-size:15px!important;line-height:16px!important;margin-top:5px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
.mini{font-size:9.5px!important;line-height:11px!important;margin-top:5px!important;color:#b9c8d5!important;max-width:126px!important}

/* Location + today's range */
.cityPanel{
  left:169px!important;right:153px!important;top:42px!important;height:45px!important;
  padding:5px 11px!important;border-radius:11px!important;
  background:linear-gradient(105deg,rgba(var(--rgb),.16),rgba(var(--rgb),.07))!important;
  border:1px solid rgba(var(--rgb),.48)!important;
  box-shadow:inset 0 1px rgba(255,255,255,.04)!important
}
.cityName{font-size:16px!important;line-height:18px!important;letter-spacing:.005em!important}
.todayRange{
  display:flex!important;align-items:center!important;gap:6px!important;
  font-size:9px!important;line-height:12px!important;overflow:visible!important
}
.todayRange .max,.todayRange .min{
  display:inline-flex!important;align-items:center!important;padding:2px 6px!important;border-radius:999px!important;
  background:rgba(4,10,16,.35)!important;border:1px solid rgba(255,255,255,.08)!important;
  white-space:nowrap!important
}
.todayRange .max{color:#ffd95c!important}
.todayRange .min{color:#a9d5ff!important}

/* Wind is a secondary readout, not a competing headline. */
.windBand{
  left:169px!important;right:153px!important;top:93px!important;height:37px!important;
  border-radius:11px!important;font-size:15px!important;letter-spacing:.01em!important;
  background:linear-gradient(90deg,rgba(255,255,255,.055),rgba(255,255,255,.085))!important;
  border-color:rgba(255,255,255,.10)!important
}

/* Distinguish the three different metric types while retaining the same stack. */
.side{right:10px!important;top:42px!important;width:137px!important;bottom:64px!important;gap:4px!important}
.metric{
  position:relative!important;padding:4px 8px 4px 10px!important;border-radius:10px!important;
  background:linear-gradient(110deg,rgba(255,255,255,.065),rgba(255,255,255,.035))!important;
  border:1px solid rgba(255,255,255,.10)!important;overflow:hidden!important
}
.metric::before{content:"";position:absolute;left:0;top:5px;bottom:5px;width:3px;border-radius:0 3px 3px 0;background:#ffd36b;opacity:.9}
.metric:nth-child(2)::before{background:#65d9ff}
.metric:nth-child(3)::before{background:#b69cff}
.metric .label{font-size:7px!important;line-height:8px!important;letter-spacing:.07em!important;color:#93a7b8!important}
.metric .value{font-size:15px!important;line-height:17px!important;color:#f7fbff!important}

/* Forecast: stronger hierarchy, less flat. */
.forecast{left:12px!important;right:10px!important;bottom:8px!important;height:53px!important;gap:6px!important}
.day{
  position:relative!important;border-radius:10px!important;padding:5px 5px 4px!important;
  background:linear-gradient(150deg,rgba(255,255,255,.065),rgba(255,255,255,.028))!important;
  border:1px solid rgba(255,255,255,.10)!important;
  box-shadow:inset 0 1px rgba(255,255,255,.025)!important
}
.day::before{content:"";position:absolute;left:9px;right:9px;top:0;height:2px;border-radius:0 0 3px 3px;background:rgba(var(--rgb),.62)}
.dName{font-size:8.7px!important;line-height:10px!important;letter-spacing:.025em!important;color:#a9b9c7!important}
.dTemp{font-size:15px!important;line-height:17px!important;margin-top:1px!important}
.dRain{font-size:8.2px!important;line-height:10px!important;color:#d9e8f2!important}
.dRain::before{content:"Rain ";color:#87bde0;font-weight:850}

/* Remove duplicated word when JS already outputs "87% rain". */
</style>'''
# We will change JS forecast rain output to only the percentage to match the new label.
s=s.replace('+("% rain")', '+("%")') if '+("% rain")' in s else s
s=s.replace(')+"% rain":"-- rain")', ')+"%":"--")')
s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# Bump the parent iframe cache only; no structural HA restart is needed for the static file itself.
py=r'''import json,pathlib,shutil,time
p=pathlib.Path("/config/.storage/lovelace.c720p_hub");b=pathlib.Path("/config/.storage/lovelace.c720p_hub.before-weather-v89-"+time.strftime("%Y%m%d_%H%M%S"));shutil.copy2(p,b)
d=json.loads(p.read_text());h=next(x for x in d["data"]["config"]["views"] if x.get("path")=="home");root=h["cards"][0]
root["cards"][1]["url"]="/local/c720p-weather-row.html?v=WEATHER_REFINED_V89_20261007"
tmp=p.with_suffix(".tmp-w89");tmp.write_text(json.dumps(d,separators=(",",":")));tmp.replace(p)
print("LOVELACE_BACKUP="+str(b));print("WEATHER_ROW_URL="+root["cards"][1]["url"])'''
r=subprocess.run(['docker','exec','homeassistant','python3','-c',py],text=True,capture_output=True,timeout=30)
if r.returncode!=0: raise SystemExit(r.stdout+r.stderr)
print(r.stdout.strip())
rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit('HA restart failed: '+rr.stdout+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')
print('BACKUP='+str(BACK))
print('RESULT=WEATHER_V89_APPLIED')
