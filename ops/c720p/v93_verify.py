from pathlib import Path
import json,re,subprocess,time
W=Path('/opt/homeassistant/config/www')
checks={}
def text(name):
    return (W/name).read_text(encoding='utf-8',errors='ignore')
voice=text('c720p-voice-banner.html')
tv=text('c720p-tv-surround-v21.html')
spotify=text('c720p-spotify-compact-v1.html')
photo=text('c720p-google-photos-inner-security.html')
saved=text('c720p-drive-saved.html')
surv=text('c720p-surveillance.html')
checks['voice_marker']='C720P_VOICE_SPACE_V93' in voice
checks['spotify_marker']='C720P_SPOTIFY_CONTROLS_V93' in spotify
checks['photo_marker']='C720P_PHOTO_SMART_FRAME_V93' in photo
checks['photo_schedule']='c720pScheduleSmartFrame(hidden,frame)' in photo
checks['saved_marker']='C720P_SAVED_GALLERY_V93' in saved
checks['saved_v88_thumbs']='C720P_SAVED_VISUAL_CARDS_V88' in saved and 'snapshot_name' in saved
checks['security_v93_url']='SAVED_GALLERY_V93_20261007' in surv
checks['find_ir_removed']='Find IR +' not in tv
checks['surround_capitalized']='TV & Surround' in tv
checks['volume_swap_script']='C720P_TV_VOLUME_ORDER_V93' in tv

# Lovelace URL/aspect audit.
cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
d=json.loads(cfg.read_text())
ifr=[]
def walk(x):
    if isinstance(x,dict):
        if x.get('type')=='iframe':ifr.append((x.get('url'),x.get('aspect_ratio')))
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
for k,needle in [('voice','c720p-voice-banner'),('spotify','c720p-spotify-compact'),('security','c720p-surveillance'),('extra','c720p-extra-row-v85')]:
    m=[x for x in ifr if needle in str(x[0])]
    checks[k+'_lovelace']=m[:3]

# Browser-executed DOM checks.
def dom(url,out,budget=7000):
    p=subprocess.run(['chromium','--headless','--disable-gpu','--no-sandbox',f'--virtual-time-budget={budget}','--dump-dom',url],
                     text=True,capture_output=True,timeout=40)
    Path(out).write_text(p.stdout,encoding='utf-8')
    return p.stdout,p.stderr,p.returncode

base='http://127.0.0.1:8123/local/'
td,te,tr=dom(base+'c720p-tv-surround-v21.html?v=TV_SURROUND_V93_20261007','/tmp/v93-tv-dom.html',5000)
# Extract visible button order.
checks['tv_buttons']=[re.sub(r'<[^>]+>','',x).strip() for x in re.findall(r'<button[^>]*>(.*?)</button>',td,re.S|re.I)]
pd,pe,pr=dom(base+'c720p-google-photos-inner-security.html?v=PHOTO_SMART_V93_20261007','/tmp/v93-photo-dom.html',7000)
checks['photo_dom_smart_fit']=re.findall(r'data-smart-fit="([^"]+)"',pd)[:6]
sd,se,sr=dom(base+'c720p-drive-saved.html?camera=camera&v=SAVED_GALLERY_V93_20261007','/tmp/v93-saved-dom.html',10000)
checks['saved_clip_nodes']=len(re.findall(r'class="clip"',sd))
checks['saved_thumb_nodes']=len(re.findall(r'class="thumb"',sd))
checks['saved_has_delete']='>Delete<' in sd
checks['saved_has_snapshot_badges']='thumbBadge' in sd
checks['browser_returncodes']={'tv':tr,'photo':pr,'saved':sr}
print(json.dumps(checks,ensure_ascii=False,indent=2))
