from pathlib import Path
import shutil,datetime,re,json,subprocess,time

HOME=Path('/home/jespern')
W=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
B=HOME/'c720p-backups'/f'photo-autosync-v104-{STAMP}'
B.mkdir(parents=True,exist_ok=True)

sync=HOME/'c720p-home-hub/bin/google-photos-shared-album-sync.py'
unit=HOME/'.config/systemd/user/google-photos-shared-album-sync.service'
extra=W/'c720p-extra-row-v85.html'
cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
for p in [sync,unit,extra,cfg]:
    if p.exists():shutil.copy2(p,B/(p.name+'.before'))

# The new sync script is downloaded separately to .new so setup can atomically install it.
new=Path('/tmp/google-photos-shared-album-sync-v2.py')
if not new.exists():raise SystemExit('new sync script missing')
shutil.copy2(new,sync)
sync.chmod(0o755)

us=unit.read_text(encoding='utf-8')
us=re.sub(r'^ExecStart=.*$', 'ExecStart=/home/jespern/c720p-home-hub/.venv-webdriver/bin/python /home/jespern/c720p-home-hub/bin/google-photos-shared-album-sync.py',us,flags=re.M)
unit.write_text(us,encoding='utf-8')

# Make nested photo wrapper cache-busting dynamic on every kiosk load.
s=extra.read_text(encoding='utf-8')
s,n=re.subn(r"f\.src='/local/c720p-release/home-live-primary-v2\.html\?v=[^']+';",
            "f.src='/local/c720p-release/home-live-primary-v2.html?v=PHOTO_AUTO_'+Date.now();",s,count=1)
if n!=1:raise SystemExit('photo wrapper iframe assignment not found')
extra.write_text(s,encoding='utf-8')

# One-time outer cache bump, preserving exact aspect ratio.
d=json.loads(cfg.read_text())
aspect=None
def walk(x):
    global aspect
    if isinstance(x,dict):
        if x.get('type')=='iframe' and 'c720p-extra-row-v85.html' in str(x.get('url','')):
            aspect=x.get('aspect_ratio')
            x['url']='/local/c720p-extra-row-v85.html?v=PHOTO_AUTOSYNC_V104_20261007'
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
tmp=cfg.with_suffix('.tmp-photoauto');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

subprocess.run(['systemctl','--user','daemon-reload'],check=True,timeout=20)
subprocess.run(['systemctl','--user','enable','--now','google-photos-shared-album-sync.timer'],check=True,timeout=30)

r=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if r.returncode!=0:raise SystemExit(r.stdout+r.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}:break
    time.sleep(1)
else:raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)

print('ASPECT_PRESERVED='+str(aspect))
print('BACKUP='+str(B))
print('AUTOSYNC_SETUP=OK')
