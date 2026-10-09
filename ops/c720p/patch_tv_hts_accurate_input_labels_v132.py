#!/usr/bin/env python3
"""Accuracy-only labels for the C720P TV/HTS panel.

V132. Does not change power, infrared, Wi-Fi, Bluetooth or input commands.
Makes the BT READY prerequisite and unverified HDMI input explicit.
All replacements are exact and atomic with rollback.
"""
from pathlib import Path
import datetime,shutil,subprocess,json,re
ui=Path('/opt/homeassistant/config/www/c720p-tv-surround-v21.html')
txt=ui.read_text()
MARK='C720P_TV_HTS_ACCURATE_INPUT_LABELS_V132'
if MARK in txt:
 print(json.dumps({'ok':True,'already_applied':True}))
 raise SystemExit
pairs=[
 ('<button type="button" id="macro" class="macro">TV → HDMI 3 → Bluetooth<span class="sub">TV · input · HTS · C720P audio</span></button>',
  '<button type="button" id="macro" class="macro">Connect Bluetooth<span class="sub">HTS must already show BT READY · HDMI 3 unverified</span></button>'),
 ('label(e.macro,"Surround ready","HDMI 3 · Samsung Bluetooth verified");',
  'label(e.macro,"Bluetooth audio connected","Samsung audio verified · TV HDMI 3 requires on-screen check");'),
 ('status("TV + surround audio verified","ok");',
  'status("HTS Bluetooth audio verified; HDMI 3 not screen-verified","ok");'),
 ('label(e.macro,"Connecting surround","TV → HDMI 3 → HTS Bluetooth");',
  'label(e.macro,"Connecting Samsung Bluetooth","Receiver must already be in BT READY mode");'),
 ('label(e.macro,"Connect Surround","TV → HDMI 3 → Bluetooth · S5 bridge auto-recovery");',
  'label(e.macro,"Bluetooth input unverified","No automatic Samsung IR input selection · S5 checks available");'),
 ('label(e.macro,"TV → HDMI 3 → Bluetooth","TV · input · HTS · C720P audio");',
  'label(e.macro,"Connect Bluetooth","HTS BT READY required · TV HDMI 3 sent, not visually verified");'),
 ('status("Controls ready");',
  'status("Bluetooth input requires receiver BT READY; no automatic IR source sweep","bad");'),
 ('status("TV + surround Bluetooth audio verified","ok");',
  'status("Samsung Bluetooth audio connected; TV HDMI 3 not screen-verified","ok");'),
]
for old,new in pairs:
 n=txt.count(old)
 if n!=1:
  raise ValueError(f"Expected one exact anchor, found {n}: {old[:92]}")
 txt=txt.replace(old,new,1)
# Only a visible warning is changed; no JavaScript flows, URLs or APIs are affected.
txt=txt.replace('</body>',f'<!-- {MARK} -->\n</body>',1)
assert MARK in txt
assert txt.count('e.macro.onclick=async()=>')==1
assert 'C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131' in txt
bak=Path('/home/jespern/c720p-backups')/('tv-hts-labels-v132-'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'))
bak.mkdir(parents=True,exist_ok=False)
snapshot=bak/(ui.name+'.before')
shutil.copy2(ui,snapshot)
try:
 tmp=ui.with_suffix('.v132.tmp')
 tmp.write_text(txt)
 tmp.chmod(ui.stat().st_mode)
 tmp.replace(ui)
 final=ui.read_text()
 assert final==txt
 assert all(new in final for _,new in pairs)
 print(json.dumps({'ok':True,'version':'V132','backup':str(snapshot),'label_replacements':len(pairs),'macro_logic_changed':False,'transmitted_ir':False}))
except Exception:
 shutil.copy2(snapshot,ui)
 raise
