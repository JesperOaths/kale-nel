from pathlib import Path
import re,subprocess,time,json,shutil,datetime
HOME=Path('/home/jespern'); WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S'); BACK=HOME/'c720p-backups'/f'home-v86-{STAMP}'; BACK.mkdir(parents=True,exist_ok=True)
py=r'''import json,pathlib,shutil,time
p=pathlib.Path('/config/.storage/lovelace.c720p_hub'); b=pathlib.Path('/config/.storage/lovelace.c720p_hub.before-home-v86-'+time.strftime('%Y%m%d_%H%M%S')); shutil.copy2(p,b); d=json.loads(p.read_text()); views=d['data']['config']['views']; home=next(x for x in views if x.get('path')=='home'); security=next(x for x in views if x.get('path')=='front-yard-security'); root=home['cards'][0]; grid=root['cards'][0]; cols=grid['cards']; spotify=cols[0]['cards'][1]; spotify['aspect_ratio']='55%'; spotify['url']='/local/c720p-spotify-compact-v1.html?v=HOME_FILL_V86_20261007'; office=cols[1]['cards'][1]; style=(office.get('card_mod') or {}).get('style','')+'\n/* C720P_HOME_FILL_V86 */\nha-card{min-height:96px!important;}\n'; office.setdefault('card_mod',{})['style']=style; voice=cols[1]['cards'][2]; voice['aspect_ratio']='29%'; voice['url']='/local/c720p-voice-banner.html?c720p_build=HOME_FILL_V86_20261007'; cols[2]['cards'][2]['aspect_ratio']='22.5%'; cols[3]['cards'][2]['aspect_ratio']='23.2%'; root['cards'][1]['url']='/local/c720p-weather-row.html?v=WEATHER_NEAT_V86_20261007'; root['cards'][2]['url']='/local/c720p-extra-row-v85.html?v=AGENDA_RADIATOR_V86_20261007'; security['cards'][0]['url']='/local/c720p-surveillance.html?v=CAMERA_SAVED_V86_20261007'; tmp=p.with_suffix('.tmp-home-v86'); tmp.write_text(json.dumps(d,separators=(',',':'))); tmp.replace(p); print('LOVELACE_BACKUP='+str(b)); print('SPOTIFY_ASPECT='+spotify['aspect_ratio']); print('OFFICE_MIN_HEIGHT=96'); print('WEATHER_URL='+root['cards'][1]['url']); print('EXTRA_URL='+root['cards'][2]['url']); print('SECURITY_URL='+security['cards'][0]['url'])'''
r=subprocess.run(['docker','exec','homeassistant','python3','-c',py],text=True,capture_output=True,timeout=30)
if r.returncode!=0: raise SystemExit('Lovelace update failed: '+r.stdout+' '+r.stderr)
print(r.stdout.strip()); rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit('HA restart failed: '+rr.stdout+' '+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')
w=subprocess.run(['bash','-lc',"DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],text=True,capture_output=True).stdout.strip()
if w: subprocess.run(['bash','-lc',f'DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r'],check=False)
print('RESULT=HOME_POLISH_CAMERA_SAVED_V86_APPLIED')
