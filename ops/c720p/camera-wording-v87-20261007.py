from pathlib import Path
import shutil, datetime
HOME=Path('/home/jespern')
ROOT=HOME/'c720p-home-hub'
WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=HOME/'c720p-backups'/f'camera-wording-v87-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)
pairs=[
 ('New Camera Security','Camera Security'),
 ('C720P New Camera Playback','C720P Camera Playback'),
 ('New camera clips','Camera clips'),
 ('New camera motion detected','Camera motion detected'),
 ('new camera motion detected','camera motion detected'),
 ('Live · New camera','Live · Camera'),
 ('New camera live stream','Camera live stream'),
 ('PRIMARY · New camera','PRIMARY · Camera'),
 ('new IP Webcam','camera')
]
candidates=[]
for base in [ROOT/'bin', ROOT/'config']:
    if base.exists():
        for p in base.rglob('*'):
            if p.is_file() and p.suffix.lower() in {'.py','.sh','.js','.html','.json','.yaml','.yml','.txt'}:
                candidates.append(p)
for p in [WWW/'frontyard-security-new'/'index.html',WWW/'frontyard-security-new'/'clips.html',WWW/'c720p-release'/'home-live-primary-v2.html',WWW/'c720p-surveillance.html',WWW/'c720p-drive-saved.html']:
    if p.exists(): candidates.append(p)
changed=[]
for p in dict.fromkeys(candidates):
    try: s=p.read_text(encoding='utf-8')
    except Exception: continue
    n=s
    for a,b in pairs: n=n.replace(a,b)
    if n!=s:
        rel=str(p).replace('/','__').lstrip('_')
        shutil.copy2(p,BACK/(rel+'.before'))
        p.write_text(n,encoding='utf-8')
        changed.append(str(p))
p=WWW/'c720p-drive-saved.html'
if p.exists():
    s=p.read_text(encoding='utf-8')
    if 'function cleanReason(' not in s:
        s=s.replace("const params=new URLSearchParams(location.search);","function cleanReason(v){return String(v||'').replace(/^New camera\\b/i,'Camera')}\nconst params=new URLSearchParams(location.search);")
        s=s.replace("(e.reason?' — '+e.reason:'')","(e.reason?' — '+cleanReason(e.reason):'')")
        p.write_text(s,encoding='utf-8'); changed.append(str(p))
print('CHANGED_COUNT='+str(len(changed)))
for x in changed: print('CHANGED='+x)
print('BACKUP='+str(BACK))
