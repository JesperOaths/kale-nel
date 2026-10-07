from pathlib import Path
import json,re,subprocess
W=Path('/opt/homeassistant/config/www')
out={}
# Static file assertions.
extra=(W/'c720p-extra-row-v85.html').read_text(encoding='utf-8',errors='ignore')
voice=(W/'c720p-voice-banner.html').read_text(encoding='utf-8',errors='ignore')
clock=(W/'c720p-time-mini.html').read_text(encoding='utf-8',errors='ignore')
spotify=(W/'c720p-spotify-compact-v1.html').read_text(encoding='utf-8',errors='ignore')
photo=(W/'c720p-google-photos-inner-security.html').read_text(encoding='utf-8',errors='ignore')
out['sensor_labels']={'bathroom':'<span class="sensorName">Bathroom</span>' in extra,'living_room':'<span class="sensorName">Living Room</span>' in extra}
out['agenda']={'icon_css':'C720P_AGENDA_ICONS_V94' in extra,'icon_js':'C720P_AGENDA_ICON_DECORATOR_V94' in extra}
out['voice']={'v94':'C720P_VOICE_REFLOW_V94' in voice,'fit_js':'C720P_VOICE_TEXT_FIT_V94' in voice,'no_v94_ellipsis':'C720P_VOICE_REFLOW_V94' in voice and 'text-overflow:clip!important' in voice}
out['clock']={'local_time':'Local Time' in clock,'seconds':'id="seconds"' in clock,'week':'id="week"' in clock}
out['spotify']={'v94':'C720P_SPOTIFY_LAYOUT_V94' in spotify,'shuffle':'data-control="shuffle"' in spotify,'vol_down':'data-control="volumeDown"' in spotify,'mute':'data-control="mute"' in spotify,'vol_up':'data-control="volumeUp"' in spotify,'play_pause':'id="playPause"' in spotify}
out['photo']={'static_map':'const SMART_FRAMING_V94=' in photo,'apply':'c720pApplyAnalyzedFrame(hidden,url,frame)' in photo}
report=json.loads((W/'c720p-photo-framing-v94.json').read_text())
out['photo_report']={'count':len(report),'zoom_min':min(v['zoomPct'] for v in report.values()),'zoom_max':max(v['zoomPct'] for v in report.values()),'contain':sum(v['fit']=='contain' for v in report.values()),'cover':sum(v['fit']=='cover' for v in report.values()),'focus_unique':len({(v['x'],v['y']) for v in report.values()})}

# Lovelace cleanup / capitalization.
d=json.loads(Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub').read_text())
home=next(x for x in d['data']['config']['views'] if x.get('path')=='home')
lights=next(x for x in d['data']['config']['views'] if x.get('path')=='lights')
dupes={'light.woonkamer_plafond','switch.lamp_woonkamer_socket_1','light.lsc_smart_gls_a60_3','light.c720p_bedroom_main_lamp','light.plafond_office'}
summary_cards=0; group_hold=0; double_more=0; names=[]
def walk(x):
 global summary_cards,group_hold,double_more
 if isinstance(x,dict):
  if x.get('type')=='entities':
   ids={e.get('entity') for e in x.get('entities',[]) if isinstance(e,dict)}
   if len(ids&dupes)>=4: summary_cards+=1
  ent=str(x.get('entity') or '')
  if ent.startswith('light.c720p_ui_') and x.get('hold_action',{}).get('action')=='more-info': group_hold+=1
  if ent.startswith(('light.','switch.')) and x.get('double_tap_action',{}).get('action')=='more-info': double_more+=1
  if 'name' in x:names.append(x['name'])
  for v in x.values():walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
walk(home);walk(lights)
out['light_cleanup']={'duplicate_summary_cards':summary_cards,'group_more_info_holds':group_hold,'double_tap_more_info':double_more}
out['capitalization']={'all_lights':'All Lights' in names,'living_room':'Living Room' in names,'living_ceiling':'Living Ceiling' in names,'office_ceiling':'Office Ceiling' in names}

# Browser rendering for the modified standalone components.
def dom(url,budget):
 r=subprocess.run(['chromium','--headless','--disable-gpu','--no-sandbox',f'--virtual-time-budget={budget}','--dump-dom',url],text=True,capture_output=True,timeout=45)
 return r.returncode,r.stdout,r.stderr
base='http://127.0.0.1:8123/local/'
rc,cdom,_=dom(base+'c720p-time-mini.html?c720p_build=CLOCK_V94_20261007',2500)
out['clock_browser']={'rc':rc,'has_week':bool(re.search(r'id="week"[^>]*>Week \d+',cdom)),'has_time':bool(re.search(r'id="time"[^>]*>\d{2}:\d{2}',cdom))}
rc,sdom,_=dom(base+'c720p-spotify-compact-v1.html?v=SPOTIFY_V94_20261007',2500)
out['spotify_browser']={'rc':rc,'buttons':len(re.findall(r'<button',sdom)),'shuffle':'data-control="shuffle"' in sdom,'mute':'data-control="mute"' in sdom}
rc,pdom,_=dom(base+'c720p-google-photos-inner-security.html?v=PHOTO_ANALYZED_V94_20261007',8000)
out['photo_browser']={'rc':rc,'framed_nodes':len(re.findall(r'data-framing-v94="1"',pdom)),'zoom_values':re.findall(r'data-zoom-pct="([^"]+)"',pdom)[:4]}

print(json.dumps(out,ensure_ascii=False,indent=2))
