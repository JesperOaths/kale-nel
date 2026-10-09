#!/usr/bin/env python3
from __future__ import annotations
import datetime, json, pathlib, shutil, subprocess, time

HOME=pathlib.Path("/home/jespern")
HA=pathlib.Path("/opt/homeassistant/config")
WWW=HA/"www"
ROW=WWW/"c720p-weather-row.html"
WEATHER=WWW/"c720p-weather-compact.html"
LOVE=HA/".storage/lovelace.c720p_hub"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"weather-layout-v99-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
for p in (ROW,WEATHER,LOVE):
    shutil.copy2(p,BACKUP/(p.name+".before"))

ROW_MARK="C720P_WEATHER_ROW_SPACING_V99"
row=ROW.read_text()
if ROW_MARK not in row:
    css=f"""
<style id="{ROW_MARK}">
/* One highlight per weather tile. The child cards own the coloured outline;
   the row wrapper only supplies real breathing room so glows never collide. */
.row{{
  grid-template-columns:minmax(0,.98fr) minmax(0,.98fr) minmax(0,1.90fr) minmax(0,1.04fr)!important;
  gap:6px!important;
  padding:3px 5px!important;
  background:#070a0e!important;
}}
.cell{{
  padding:0!important;
  border:0!important;
  box-shadow:none!important;
  background:transparent!important;
  border-radius:13px!important;
  overflow:hidden!important;
}}
.weatherCell,.radarCell,.rainCell{{
  border:0!important;
  box-shadow:none!important;
  background:transparent!important;
}}
.cell iframe{{
  border-radius:13px!important;
  overflow:hidden!important;
}}
.c720p-city-border-v40{{
  border:0!important;
  box-shadow:none!important;
}}
</style>
"""
    row=row.replace("</head>",css+"</head>",1)
# cache-bust only the compact weather child; radar/precip data URLs remain stable
row=row.replace("c720p-weather-compact.html?v=WEATHER_METRIC_CORNERS_V92_20261007",
                "c720p-weather-compact.html?v=WEATHER_LAYOUT_V99_20261009")
ROW.write_text(row)

WX_MARK="C720P_WEATHER_NONOVERLAP_GRID_V99"
wx=WEATHER.read_text()
if WX_MARK not in wx:
    css=f"""
<style id="{WX_MARK}">
/* Responsive grid replacement for the accumulated absolute-position layout.
   Every information group gets an exclusive grid cell; no vertical or
   horizontal overlap is possible even when the Home card is short. */
.card{{
  display:grid!important;
  grid-template-columns:142px minmax(0,1fr) 136px!important;
  grid-template-rows:24px minmax(40px,1.15fr) minmax(32px,.90fr) 48px!important;
  column-gap:7px!important;
  row-gap:5px!important;
  padding:7px 9px!important;
  overflow:hidden!important;
  align-content:stretch!important;
}}
.top{{
  position:static!important;
  grid-column:1 / -1!important;
  grid-row:1!important;
  min-width:0!important;
  height:auto!important;
  align-self:center!important;
}}
.title{{font-size:16px!important;line-height:20px!important}}
.source{{font-size:8.5px!important;padding:3px 8px!important}}

.tempBlock{{
  position:relative!important;
  left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
  grid-column:1!important;grid-row:2 / 4!important;
  width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;
  padding:7px 9px 6px!important;
  overflow:hidden!important;
  border-radius:10px!important;
}}
.tempBlock::before{{right:7px!important;top:6px!important;font-size:6.5px!important}}
.bigTemp{{font-size:38px!important;line-height:.88!important;letter-spacing:-2px!important}}
.condition{{font-size:13px!important;line-height:14px!important;margin-top:3px!important}}
.mini{{font-size:8.5px!important;line-height:10px!important;margin-top:3px!important;max-width:118px!important}}

.cityPanel{{
  position:relative!important;
  left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
  grid-column:2!important;grid-row:2!important;
  width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;
  padding:4px 9px!important;
  display:grid!important;
  grid-template-rows:17px 13px!important;
  row-gap:1px!important;
  align-content:center!important;
  border-radius:10px!important;
  border:1px solid rgba(var(--rgb),.34)!important;
  box-shadow:none!important;
  overflow:hidden!important;
}}
.cityName{{font-size:15px!important;line-height:17px!important}}
.todayRange{{
  font-size:8.5px!important;line-height:11px!important;gap:4px!important;
  min-width:0!important;overflow:hidden!important;flex-wrap:nowrap!important;
}}
.todayRange .max,.todayRange .min{{
  padding:1px 5px!important;border-radius:999px!important;min-width:0!important;
}}

.windBand{{
  position:relative!important;
  left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
  grid-column:2!important;grid-row:3!important;
  width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;
  padding:2px 8px!important;
  font-size:13px!important;line-height:15px!important;
  border-radius:9px!important;
  overflow:hidden!important;
}}

.side{{
  position:relative!important;
  left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
  grid-column:3!important;grid-row:2 / 4!important;
  width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;
  display:grid!important;
  grid-template-rows:repeat(3,minmax(0,1fr))!important;
  gap:4px!important;
  overflow:hidden!important;
}}
.metric{{
  min-width:0!important;min-height:0!important;
  padding:2px 6px!important;
  grid-template-rows:7px minmax(0,1fr)!important;
  border-radius:9px!important;
}}
.metric .label{{font-size:6.5px!important;line-height:7px!important;margin:0 0 1px!important}}
.metric .value{{font-size:13px!important;line-height:14px!important;min-height:14px!important}}
.metricNum{{font-size:14px!important;line-height:14px!important}}

.forecast{{
  position:relative!important;
  left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
  grid-column:1 / -1!important;grid-row:4!important;
  width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;
  display:grid!important;
  grid-template-columns:repeat(4,minmax(0,1fr))!important;
  gap:6px!important;
  overflow:hidden!important;
}}
.day{{
  min-width:0!important;min-height:0!important;
  padding:4px 5px 3px!important;
  border-radius:9px!important;
  overflow:hidden!important;
}}
.dName{{font-size:8px!important;line-height:9px!important}}
.dTemp{{font-size:13.5px!important;line-height:15px!important;margin-top:0!important}}
.dRain{{font-size:7.5px!important;line-height:9px!important}}

/* Hard invariant: all major cards clip to their own grid area. */
.tempBlock,.cityPanel,.windBand,.side,.forecast,.metric,.day{{
  box-sizing:border-box!important;
  max-width:100%!important;
  max-height:100%!important;
}}
</style>
"""
    wx=wx.replace("</head>",css+"</head>",1)
WEATHER.write_text(wx)

# Update only the Home view's weather-row URL to force the kiosk to load V99.
d=json.loads(LOVE.read_text())
views=d.get("data",{}).get("config",{}).get("views",[])
changed=0
def walk(x):
    global changed
    if isinstance(x,dict):
        if x.get("type")=="iframe" and str(x.get("url","")).startswith("/local/c720p-weather-row.html"):
            x["url"]="/local/c720p-weather-row.html?v=WEATHER_LAYOUT_V99_20261009"
            changed+=1
        for v in x.values(): walk(v)
    elif isinstance(x,list):
        for v in x: walk(v)
for v in views:
    if v.get("path")=="home":
        walk(v)
LOVE.write_text(json.dumps(d,ensure_ascii=False,separators=(",",":"))+"\n")

# Validate Home Assistant config before restarting.
check=subprocess.run(["docker","exec","homeassistant","python","-m","homeassistant","--script","check_config","-c","/config"],
                     text=True,capture_output=True,timeout=180)
if check.returncode!=0:
    for p in (ROW,WEATHER,LOVE):
        shutil.copy2(BACKUP/(p.name+".before"),p)
    raise SystemExit("HA config check failed: "+(check.stdout+check.stderr)[-3000:])

subprocess.run(["docker","restart","homeassistant"],check=True,stdout=subprocess.DEVNULL,timeout=45)
deadline=time.time()+120
while time.time()<deadline:
    r=subprocess.run(["curl","-fsS","--max-time","2","http://127.0.0.1:8123/"],
                     stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if r.returncode==0: break
    time.sleep(2)
else:
    raise SystemExit("Home Assistant did not return")

# Refresh kiosk if xdotool exists; otherwise HA reconnect/cache-bust will update it.
if shutil.which("xdotool"):
    subprocess.run(["xdotool","key","ctrl+r"],env={**__import__("os").environ,"DISPLAY":":0"},check=False,timeout=10)
time.sleep(10)

before=WWW/"c720p-hub-home-before-weather-fix.png"
after=WWW/"c720p-hub-home-after-weather-fix.png"
subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-f","x11grab","-video_size","1366x768","-i",":0.0","-frames:v","1","-y",str(after)],check=True,timeout=30)

print(json.dumps({
  "ok":True,
  "version":"C720P_WEATHER_LAYOUT_V99_20261009",
  "backup":str(BACKUP),
  "home_weather_iframes_updated":changed,
  "before_screenshot":str(before),
  "after_screenshot":str(after),
  "before_bytes":before.stat().st_size if before.exists() else None,
  "after_bytes":after.stat().st_size,
  "row_marker":ROW_MARK in ROW.read_text(),
  "weather_marker":WX_MARK in WEATHER.read_text(),
},indent=2))
