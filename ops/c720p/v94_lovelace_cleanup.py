from pathlib import Path
import json,shutil,datetime,re,subprocess,time

CFG=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
W=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=Path('/home/jespern/c720p-backups')/f'v94-layout-{STAMP}';BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(CFG,BACK/'lovelace.c720p_hub.before')
d=json.loads(CFG.read_text())
views=d['data']['config']['views']
home=next(x for x in views if x.get('path')=='home')
lights=next(x for x in views if x.get('path')=='lights')

# Remove the redundant "all individual lights again" card from the Lights view.
dupe_set={'light.woonkamer_plafond','switch.lamp_woonkamer_socket_1','light.lsc_smart_gls_a60_3','light.c720p_bedroom_main_lamp','light.plafond_office'}
removed=[]
def prune(x,path='lights'):
    if isinstance(x,dict):
        for k,v in list(x.items()):
            if isinstance(v,list):
                nv=[]
                for i,item in enumerate(v):
                    if isinstance(item,dict) and item.get('type')=='entities':
                        ids={e.get('entity') for e in item.get('entities',[]) if isinstance(e,dict) and e.get('entity')}
                        if len(ids & dupe_set)>=4:
                            removed.append((path+'/'+k+f'[{i}]',sorted(ids)));continue
                    prune(item,path+'/'+k+f'[{i}]');nv.append(item)
                x[k]=nv
            else: prune(v,path+'/'+k)
    elif isinstance(x,list):
        for i,v in enumerate(x):prune(v,path+f'[{i}]')
prune(lights)

# Clean light interactions: ordinary tap toggles individual lights; hold is the one colour/details path.
# Group tiles no longer open floating colour dialogs on hold/double-tap.
def clean_actions(x):
    if isinstance(x,dict):
        ent=str(x.get('entity') or '')
        if ent.startswith(('light.','switch.')):
            x.pop('double_tap_action',None)
            if ent.startswith('light.c720p_ui_'):
                x.pop('hold_action',None)
            else:
                if x.get('type') is None or x.get('type')=='entity':
                    x.setdefault('tap_action',{'action':'toggle'})
                    if ent.startswith('light.'): x.setdefault('hold_action',{'action':'more-info'})
        for v in x.values():clean_actions(v)
    elif isinstance(x,list):
        for v in x:clean_actions(v)
clean_actions(home);clean_actions(lights)

# Consistent display capitalization / English naming.
name_map={
 'All lights':'All Lights','Living':'Living Room','Living ceiling':'Living Ceiling','Living lamp':'Living Lamp',
 'Living socket lamp':'Living Socket Lamp','Socket lamp':'Socket Lamp','Bedroom lamp':'Bedroom Lamp',
 'Slaapkamer Lamp':'Bedroom Lamp','Office ceiling':'Office Ceiling','Office Plafond':'Office Ceiling'
}
def names(x):
    if isinstance(x,dict):
        if x.get('name') in name_map:x['name']=name_map[x['name']]
        for v in x.values():names(v)
    elif isinstance(x,list):
        for v in x:names(v)
names(home);names(lights)

# Cache-bust relevant V94 components while preserving outer card dimensions.
aspects={}
def bump(x):
    if isinstance(x,dict):
        if x.get('type')=='iframe':
            u=str(x.get('url',''));a=x.get('aspect_ratio')
            if 'c720p-voice-banner.html' in u: aspects['voice']=a;x['url']='/local/c720p-voice-banner.html?c720p_build=VOICE_REFLOW_V94_20261007'
            elif 'c720p-time-mini.html' in u: aspects['clock']=a;x['url']='/local/c720p-time-mini.html?c720p_build=CLOCK_V94_20261007'
            elif 'c720p-spotify-compact-v1.html' in u: aspects['spotify']=a;x['url']='/local/c720p-spotify-compact-v1.html?v=SPOTIFY_V94_20261007'
            elif 'c720p-extra-row-v85.html' in u: aspects['extra']=a;x['url']='/local/c720p-extra-row-v85.html?v=AGENDA_SENSORS_PHOTO_V94_20261007'
        for v in x.values():bump(v)
    elif isinstance(x,list):
        for v in x:bump(v)
bump(home)
tmp=CFG.with_suffix('.tmp-v94');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(CFG)

# Nested photo caches.
for p in [W/'c720p-extra-row-v85.html',W/'c720p-release/home-live-primary-v2.html']:
    shutil.copy2(p,BACK/(p.name+'.before'))
p=W/'c720p-extra-row-v85.html';s=p.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-release/home-live-primary-v2\.html\?[^"\']*','/local/c720p-release/home-live-primary-v2.html?v=PHOTO_ANALYZED_V94_20261007',s)
p.write_text(s,encoding='utf-8')
p=W/'c720p-release/home-live-primary-v2.html'
try:p.chmod(0o644)
except Exception:pass
s=p.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+','/local/c720p-google-photos-inner-security.html?v=PHOTO_ANALYZED_V94_20261007',s)
p.write_text(s,encoding='utf-8')
try:p.chmod(0o444)
except Exception:pass

# Restart once to clear already-open duplicate floating light dialogs and activate the new view config.
r=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if r.returncode!=0:raise SystemExit(r.stdout+r.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}:break
    time.sleep(1)
else:raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)

print('REMOVED_DUPLICATE_CARDS='+str(len(removed)))
for x in removed:print('REMOVED='+repr(x))
print('PRESERVED_ASPECTS='+json.dumps(aspects,sort_keys=True))
print('BACKUP='+str(BACK))
print('V94_LAYOUT=OK')
