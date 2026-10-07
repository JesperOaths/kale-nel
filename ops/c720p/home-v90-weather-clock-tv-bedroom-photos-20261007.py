from pathlib import Path
import datetime, shutil, subprocess, time, json, re

HOME=Path('/home/jespern')
WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=HOME/'c720p-backups'/f'home-v90-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)

targets=[
    WWW/'c720p-weather-compact.html',
    WWW/'c720p-tv-surround-v21.html',
    WWW/'c720p-google-photos-inner-security.html',
    WWW/'c720p-release/home-live-primary-v2.html',
    WWW/'c720p-weather-row.html',
]
for p in targets:
    if p.exists():
        try: shutil.copy2(p,BACK/(p.name+'.before'))
        except Exception: pass

p=WWW/'c720p-weather-compact.html'
s=p.read_text(encoding='utf-8')
if 'function metricHtml(' not in s:
    s=s.replace(
        'function fmtHpa(v){let n=Number(v);return isFinite(n)?Math.round(n)+" hPa":"-- hPa"}',
        'function fmtHpa(v){let n=Number(v);return isFinite(n)?Math.round(n)+" hPa":"-- hPa"}\\nfunction metricHtml(v,unit,dec=0){let n=Number(v);if(!isFinite(n))return \'<span class="metricNum">--</span><span class="metricUnit">\'+unit+\'</span>\';return \'<span class="metricNum">\'+(dec?n.toFixed(dec):Math.round(n))+\'</span><span class="metricUnit">\'+unit+\'</span>\'}'
    )
s=s.replace('document.getElementById("feels").textContent="--";document.getElementById("hum").textContent="--%";document.getElementById("press").textContent="-- hPa";',
            'document.getElementById("feels").innerHTML=metricHtml(NaN,"°C");document.getElementById("hum").innerHTML=metricHtml(NaN,"%");document.getElementById("press").innerHTML=metricHtml(NaN,"hPa");')
s=s.replace('document.getElementById("feels").textContent=fmtTemp(feels);',
            'document.getElementById("feels").innerHTML=metricHtml(feels,"°C");')
s=s.replace('document.getElementById("hum").textContent=fmtPct(cur.relative_humidity_2m);',
            'document.getElementById("hum").innerHTML=metricHtml(cur.relative_humidity_2m,"%");')
s=s.replace('document.getElementById("press").textContent=fmtHpa(cur.pressure_msl);',
            'document.getElementById("press").innerHTML=metricHtml(cur.pressure_msl,"hPa");')

wcss='''<style id="C720P_WEATHER_METRICS_V90">
.side{right:10px!important;top:42px!important;width:139px!important;bottom:64px!important;display:grid!important;grid-template-rows:repeat(3,minmax(0,1fr))!important;gap:5px!important}
.metric{position:relative!important;display:grid!important;grid-template-rows:auto auto!important;place-content:center!important;justify-items:center!important;align-items:center!important;text-align:center!important;padding:4px 8px!important;border-radius:10px!important;overflow:hidden!important;background:linear-gradient(145deg,rgba(255,255,255,.072),rgba(255,255,255,.034))!important;border:1px solid rgba(255,255,255,.18)!important;box-shadow:inset 0 1px rgba(255,255,255,.045),0 2px 8px rgba(0,0,0,.10)!important}
.metric:nth-child(1){border-color:rgba(255,211,107,.30)!important}.metric:nth-child(2){border-color:rgba(101,217,255,.30)!important}.metric:nth-child(3){border-color:rgba(182,156,255,.30)!important}
.metric::before{content:""!important;position:absolute!important;left:0!important;right:0!important;top:0!important;height:2px!important;width:auto!important;bottom:auto!important;border-radius:0 0 4px 4px!important;background:#ffd36b!important;opacity:.88!important}
.metric:nth-child(2)::before{background:#65d9ff!important}.metric:nth-child(3)::before{background:#b69cff!important}
.metric .label{margin:0 0 2px!important;padding:0!important;width:100%!important;text-align:center!important;font-size:7.4px!important;line-height:8px!important;font-weight:900!important;letter-spacing:.065em!important;color:#a8b8c7!important;white-space:nowrap!important}
.metric .value{margin:0!important;padding:0!important;width:100%!important;min-height:17px!important;display:flex!important;align-items:baseline!important;justify-content:center!important;gap:2px!important;text-align:center!important;overflow:visible!important;white-space:nowrap!important;text-shadow:none!important;color:#f7fbff!important;font-variant-numeric:tabular-nums!important}
.metricNum{font-size:16px!important;line-height:17px!important;font-weight:900!important;letter-spacing:-.02em!important;color:#fff!important}
.metricUnit{font-size:8.5px!important;line-height:10px!important;font-weight:850!important;color:#b8c8d6!important;letter-spacing:0!important}
</style>'''
s=s.replace('</head>',wcss+'\n</head>',1)
p.write_text(s,encoding='utf-8')

p=WWW/'c720p-tv-surround-v21.html'
s=p.read_text(encoding='utf-8')
tvcss='''<style id="C720P_TV_BUTTON_COLOR_V90">
#tv:not(.on){color:#e8f5ff!important;border-color:rgba(93,176,255,.38)!important;background:radial-gradient(90% 150% at 0% 0%,rgba(93,176,255,.16),transparent 62%),linear-gradient(145deg,rgba(27,58,90,.58),rgba(14,31,49,.60))!important;box-shadow:inset 3px 0 0 rgba(93,176,255,.78),inset 0 1px 0 rgba(255,255,255,.08),0 4px 14px rgba(0,0,0,.18)!important}
#tv:not(.on):before{color:#e4f4ff!important;border-color:rgba(93,176,255,.28)!important;background:linear-gradient(145deg,rgba(93,176,255,.24),rgba(93,176,255,.08))!important}
</style>'''
s=s.replace('</head>',tvcss+'\n</head>',1)
p.write_text(s,encoding='utf-8')

p=WWW/'c720p-google-photos-inner-security.html'
s=p.read_text(encoding='utf-8')
pcss='''<style id="C720P_PHOTO_FULL_FRAME_V90">
.stage{background-color:#05070b!important;background-size:cover!important;background-position:center center!important;background-repeat:no-repeat!important}
.stage::before{content:"";position:absolute;inset:-18px;z-index:0;pointer-events:none;background:inherit;background-size:cover!important;background-position:center center!important;filter:blur(16px) brightness(.46) saturate(.88);transform:scale(1.06)}
.stage::after{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background:linear-gradient(180deg,rgba(3,7,12,.12),rgba(3,7,12,.24))}
.photo{z-index:2!important;object-fit:contain!important;object-position:center center!important;width:100%!important;height:100%!important;padding:0!important;background:transparent!important;filter:drop-shadow(0 10px 25px rgba(0,0,0,.52))!important;transform:none!important}
.photo.on{transform:none!important}.photo.on[data-smart-fit="contain"]{transform:none!important}.counter{z-index:5!important}.loading{z-index:4!important}
</style>'''
s=s.replace('</head>',pcss+'\n</head>',1)
s=s.replace('hidden.style.objectFit=frame.fit||"cover";','hidden.style.objectFit="contain";')
s=s.replace('hidden.dataset.smartFit=frame.fit||"cover";','hidden.dataset.smartFit="contain";')
old='''if(frame.fit==="contain"){
      stage.style.backgroundImage='linear-gradient(rgba(4,7,11,.42),rgba(4,7,11,.42)),url("'+url.replace(/"/g,"%22")+'")';
    }else{
      stage.style.backgroundImage="none";
    }
    stage.classList.toggle("smart-contain",frame.fit==="contain");'''
new='''stage.style.backgroundImage='url("'+url.replace(/"/g,"%22")+'")';
    stage.classList.add("smart-contain");'''
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')

p=WWW/'c720p-release/home-live-primary-v2.html'
try: p.chmod(0o644)
except Exception: pass
s=p.read_text(encoding='utf-8')
s=s.replace('/local/c720p-google-photos-inner-security.html?v=v50','/local/c720p-google-photos-inner-security.html?v=PHOTO_FULL_FRAME_V90_20261007')
p.write_text(s,encoding='utf-8')
try: p.chmod(0o444)
except Exception: pass

py=r'''import json,pathlib,shutil,time
p=pathlib.Path("/config/.storage/lovelace.c720p_hub")
b=pathlib.Path("/config/.storage/lovelace.c720p_hub.before-v90-"+time.strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
d=json.loads(p.read_text());views=d["data"]["config"]["views"];home=next(x for x in views if x.get("path")=="home")
root=home["cards"][0];cols=root["cards"][0]["cards"]
clock=cols[2]["cards"][2];clock["aspect_ratio"]="23.2%";clock["url"]="/local/c720p-time-mini.html?c720p_build=CLOCK_ALIGN_V90_20261007"
bed=cols[3]["cards"][1]
for ent in bed.get("entities",[]):
    if isinstance(ent,dict) and ent.get("entity")=="light.c720p_bedroom_main_lamp": ent["name"]="Bedroom Spots"
root["cards"][1]["url"]="/local/c720p-weather-row.html?v=WEATHER_METRICS_V90_20261007"
root["cards"][2]["url"]="/local/c720p-extra-row-v85.html?v=PHOTO_FULL_FRAME_V90_20261007"
tmp=p.with_suffix(".tmp-v90");tmp.write_text(json.dumps(d,separators=(",",":")));tmp.replace(p)
print("CLOCK_ASPECT="+clock["aspect_ratio"])
print("BEDROOM_NAME="+next(e["name"] for e in bed["entities"] if isinstance(e,dict) and e.get("entity")=="light.c720p_bedroom_main_lamp"))
print("BACKUP="+str(b))'''
r=subprocess.run(['docker','exec','homeassistant','python3','-c',py],text=True,capture_output=True,timeout=30)
if r.returncode!=0: raise SystemExit(r.stdout+r.stderr)
print(r.stdout.strip())

p=WWW/'c720p-weather-row.html'
s=p.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+','/local/c720p-tv-surround-v21.html?v=TV_COLOR_V90_20261007',s)
s=s.replace('/local/c720p-weather-compact.html?v=WEATHER_REFINED_V89_20261007','/local/c720p-weather-compact.html?v=WEATHER_METRICS_V90_20261007')
p.write_text(s,encoding='utf-8')

rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit('HA restart failed: '+rr.stdout+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')
print('BACKUP_DIR='+str(BACK))
print('RESULT=HOME_V90_APPLIED')
