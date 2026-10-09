#!/usr/bin/env python3
"""Fix TV/Surround macro stranded busy state and S5-offline partial TV activation.

Operates on live, user-owned C720P Home Assistant static UI only.
No server or phone controls modified.
"""
from pathlib import Path
import datetime,json,re,shutil,sys
WWW=Path('/opt/homeassistant/config/www')
UI=WWW/'c720p-tv-surround-v21.html'
ROW=WWW/'c720p-weather-row.html'
ui=UI.read_text(encoding='utf-8')
row=ROW.read_text(encoding='utf-8')
MARK='C720P_TV_SURROUND_MACRO_S5_PREFLIGHT_V26'
if MARK in ui:
 print(json.dumps({'ok':True,'already_applied':True}));sys.exit(0)
start=ui.index('e.macro.onclick=async()=>{')
end=ui.index('\nrefresh().catch',start)
old=ui[start:end]
assert old.count('if(!irReady&&!mediaReady)')==1
assert old.count('  busy=false;await refresh();')==1
assert 'TV on · HDMI 3 selected · S5 ADB offline' in old
assert 'const until=Date.now()+100000;' in old
new = '''// C720P_TV_SURROUND_MACRO_S5_PREFLIGHT_V26
e.macro.onclick=async()=>{
  if(busy)return;
  busy=true;
  availability();
  status("Checking TV and surround paths…");
  try{
    // Do not turn on the TV if the surround receiver cannot yet be reached.
    // A manually powered receiver that is already visible over Bluetooth
    // needs no S5; otherwise recover the real Galaxy S5 over Wi-Fi ADB/HTTP.
    const audio=await req(8790,"/state","GET",5500);
    const btAvailable=!!(audio.live_ready||audio.bluetooth_connected||audio.audio_sink_present);
    if(!irReady&&!mediaReady&&!btAvailable){
      status("Checking S5 over wireless ADB/HTTP before switching TV on…");
      await ensureIR();
    }
    status("Turning TV on…");
    await req(8789,"/grundig-tv/on","POST",24000);
    status("Selecting TV HDMI 3…");
    await req(8789,"/grundig-tv/hdmi3-fast","POST",16000);
    status("Connecting Samsung receiver over Bluetooth…");
    await req(8790,"/pipeline/bluetooth-fast","POST",8000);
    const until=Date.now()+100000;
    let verified=false;
    while(Date.now()<until){
      await wait(1400);
      const m=await req(8790,"/state","GET",5500);
      if(m.live_ready&&m.bluetooth_connected&&m.audio_sink_present&&m.audio_sink_default){
        status("TV + surround Bluetooth audio verified","ok");
        verified=true;
        break;
      }
      if(!m.pipeline_running&&m.pipeline_state==="failed")
        throw new Error(m.pipeline_failure||m.last_pipeline_failure||"surround failed");
      status("Connecting surround · "+String(m.pipeline_state||m.state||"working").replaceAll("_"," ")+"…");
    }
    if(!verified)throw new Error("Bluetooth audio could not be verified");
  }catch(x){
    status("Surround unavailable: "+String(x?.message||x).replaceAll("_"," ").slice(0,73),"bad");
  }finally{
    // Never strand the whole control panel as busy after an unavailable S5,
    // a failed TV input command, a Bluetooth timeout or an exception.
    busy=false;
    try{await refresh()}catch(_){refreshInFlight=false;availability()}
  }
};'''
ui=ui[:start]+new+ui[end:]
# Remove the false implication that the phone must be plugged in.
ui=ui.replace('S5 unavailable · USB auto-recovery armed','S5 offline on Wi-Fi · IR unavailable')
ui=ui.replace('S5 on Wi-Fi · bridge stopped · USB auto-recovery armed',
              'S5 on Wi-Fi · IR bridge needs reconnect')
ui=ui.replace('TV Ready · S5 Unavailable · USB Recovery Armed',
              'TV independent · S5 Wi-Fi offline · surround IR unavailable')
ui=ui.replace('TV Ready · S5 On Wi-Fi · IR Bridge Stopped · USB Recovery Armed',
              'TV independent · S5 IR bridge reconnecting')
now=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
oldrow=re.search(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+',row)
assert oldrow, 'live TV iframe link missing'
row=row[:oldrow.start()]+('/local/c720p-tv-surround-v21.html?v=TV_S5_NETWORK_GUARD_V26_'+now)+row[oldrow.end():]
assert ui.count(MARK)==1
assert '  busy=false;await refresh();' not in ui[ui.index(MARK):ui.index('\nrefresh().catch',ui.index(MARK))]
assert 'finally{' in ui[ui.index(MARK):ui.index('\nrefresh().catch',ui.index(MARK))]
assert '/grundig-tv/hdmi3-fast' in ui
assert ui.count('e.tv.onclick=')==1 and ui.count('e.hts.onclick=')==1
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'verified_macro_fixes':True,
                   'fix_stuck_busy':True,'no_partial_tv_on_if_s5_offline':True,
                   'manual_bluetooth_path_kept':True,'versions_bumped':True}))
 sys.exit(0)
back=Path('/home/jespern/c720p-backups')/('tv-surround-s5-preflight-v26-'+now)
back.mkdir(parents=True,exist_ok=False)
for p in (UI,ROW):
 shutil.copy2(p,back/(p.name+'.before'))
try:
 for p,txt in ((UI,ui),(ROW,row)):
  mode=p.stat().st_mode
  p.chmod(0o644);p.write_text(txt,encoding='utf-8');p.chmod(mode)
 print(json.dumps({'ok':True,'installed':True,'backup':str(back),
                   'ui_version':MARK,'iframe_cache_busted':True}))
except:
 for p in (UI,ROW):shutil.copy2(back/(p.name+'.before'),p)
 raise
