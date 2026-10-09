#!/usr/bin/env python3
"""Version TV surround iframe in parent weather dashboard after V132 safe label patch.
No TV, Samsung HTS, Bluetooth, ADB or IR actions.
"""
from pathlib import Path
import datetime,shutil,json
parent=Path('/opt/homeassistant/config/www/c720p-weather-row.html')
widget=Path('/opt/homeassistant/config/www/c720p-tv-surround-v21.html')
assert 'C720P_TV_HTS_ACCURATE_INPUT_LABELS_V132' in widget.read_text(), 'V132 widget must be installed'
old='/local/c720p-tv-surround-v21.html?v=HTS_VERIFIED_INPUT_GUARDS_V131_20261009'
new='/local/c720p-tv-surround-v21.html?v=HTS_ACCURATE_BT_STATUS_V132_20261010'
s=parent.read_text()
if new in s:
 print(json.dumps({'ok':True,'already_applied':True,'new_source':new}))
 raise SystemExit(0)
assert s.count(old)==1,f'Expected one previous iframe source; found {s.count(old)}'
bak=Path('/home/jespern/c720p-backups')/('tv-hts-parent-cache-v132-'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'))
bak.mkdir(parents=True,exist_ok=False)
oldfile=bak/(parent.name+'.before')
shutil.copy2(parent,oldfile)
try:
 s=s.replace(old,new,1)
 tmp=parent.with_suffix('.v132.tmp')
 tmp.write_text(s)
 tmp.chmod(parent.stat().st_mode)
 tmp.replace(parent)
 assert parent.read_text().count(new)==1
 print(json.dumps({'ok':True,'backup':str(oldfile),'new_source':new,'revised_widget_loaded_on_next_page_refresh':True,'emitted_ir':False}))
except Exception:
 shutil.copy2(oldfile,parent)
 raise
