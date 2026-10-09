#!/usr/bin/env python3
"""Fix offline Bluetooth status read without blocking S5 IR recovery."""
from pathlib import Path
import json,datetime,shutil,sys
www=Path('/opt/homeassistant/config/www')
ui=www/'c720p-tv-surround-v21.html'
row=www/'c720p-weather-row.html'
text=ui.read_text()
r=row.read_text()
if 'C720P_TV_SURROUND_MACRO_S5_PREFLIGHT_V27' in text:
 print(json.dumps({'ok':True,'already_applied':True}));sys.exit(0)
a='''    const audio=await req(8790,"/state","GET",5500);
    const btAvailable=!!(audio.live_ready||audio.bluetooth_connected||audio.audio_sink_present);
'''
b='''    // A disconnected Samsung receiver reports ok:false in /state. It is
    // expected, not a fatal error. Still attempt S5 network recovery.
    let btAvailable=mediaReady;
    try{
      const audio=await req(8790,"/state","GET",5500);
      btAvailable=!!(audio.live_ready||audio.bluetooth_connected||audio.audio_sink_present);
    }catch(_){btAvailable=false}
'''
assert text.count(a)==1, 'expected version 26 Bluetooth preflight not found'
text=text.replace(a,b,1)
text=text.replace('C720P_TV_SURROUND_MACRO_S5_PREFLIGHT_V26','C720P_TV_SURROUND_MACRO_S5_PREFLIGHT_V27')
assert text.count('C720P_TV_SURROUND_MACRO_S5_PREFLIGHT_V27')==1
assert '  }finally{' in text
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
import re
m=re.search(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+',r)
assert m
r=r[:m.start()]+('/local/c720p-tv-surround-v21.html?v=TV_S5_NETWORK_GUARD_V27_'+stamp)+r[m.end():]
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'recoverable_bluetooth_status':True}));sys.exit(0)
backup=Path('/home/jespern/c720p-backups')/('tv-surround-v27-'+stamp)
backup.mkdir(parents=True,exist_ok=False)
for p in (ui,row):shutil.copy2(p,backup/(p.name+'.before'))
try:
 for p,s in ((ui,text),(row,r)):
  mode=p.stat().st_mode;p.chmod(0o644);p.write_text(s);p.chmod(mode)
except Exception:
 for p in (ui,row):shutil.copy2(backup/(p.name+'.before'),p)
 raise
print(json.dumps({'ok':True,'version':'TV_S5_NETWORK_GUARD_V27','backup':str(backup)}))
