#!/usr/bin/env python3
"""Make S5 IR online status update TV+Surround button descriptions too."""
from pathlib import Path
import datetime,json,re,shutil,sys
W=Path('/opt/homeassistant/config/www')
U=W/'c720p-tv-surround-v21.html'
R=W/'c720p-weather-row.html'
u=U.read_text();r=R.read_text()
marker='C720P_TV_SURROUND_LABEL_REFRESH_V28'
if marker in u:
 print(json.dumps({'ok':True,'already_applied':True}));sys.exit(0)
before='''  if(!irReady){
    label(e.up,"Volume +",s5Problem);
    label(e.down,"Volume −",s5Problem);
  }
'''
after='''  // C720P_TV_SURROUND_LABEL_REFRESH_V28
  // Recompute volume subtitles on every refresh, not just when offline.
  if(!irReady){
    label(e.up,"Volume +",s5Problem);
    label(e.down,"Volume −",s5Problem);
  }else{
    label(e.up,"Volume +","Samsung HT-E6500 · S5 wireless IR");
    label(e.down,"Volume −","Samsung HT-E6500 · S5 wireless IR");
  }
'''
assert u.count(before)==1,'Cannot locate original stale subtitle block'
u=u.replace(before,after,1)
m=re.search(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+',r)
assert m
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
r=r[:m.start()]+('/local/c720p-tv-surround-v21.html?v=S5_IR_LABELS_V28_'+stamp)+r[m.end():]
assert u.count(marker)==1
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'label_refresh':True,'cache_bust':True}));sys.exit(0)
backup=Path('/home/jespern/c720p-backups')/('s5-ir-labels-v28-'+stamp)
backup.mkdir(parents=True,exist_ok=False)
for p in (U,R):shutil.copy2(p,backup/(p.name+'.before'))
try:
 for p,s in ((U,u),(R,r)):
  mode=p.stat().st_mode
  p.write_text(s);p.chmod(mode)
except BaseException:
 for p in (U,R):shutil.copy2(backup/(p.name+'.before'),p)
 raise
print(json.dumps({'ok':True,'version':marker,'backup':str(backup)},indent=2))
