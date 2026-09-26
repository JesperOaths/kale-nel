#!/usr/bin/env python3
from pathlib import Path
import datetime,os,re,shutil,subprocess

ROOT=Path("/opt/homeassistant/config/www")
PAT=re.compile(r"(S3 camera|camera\\.s3|s3-clips|s3-saved|/security/s3)",re.I)
MARKER="C720P_V865B_HIDE_S3_ONLY"
INJECTION=r'''<!-- C720P_V865B_HIDE_S3_ONLY -->
<style>
iframe[src*="s3" i],a[href*="/security/s3" i],a[href*="s3-clips" i],a[href*="s3-saved" i],
[data-camera="s3" i],[data-device="s3" i],[data-source="s3" i],
#s3Card,.s3-card,.camera-s3{display:none!important}
</style>
<script>
document.addEventListener("DOMContentLoaded",()=>{
 const rx=/(^|[^a-z0-9])s3([^a-z0-9]|$)|camera\.s3|\/security\/s3|s3-clips|s3-saved/i;
 for(const el of document.querySelectorAll('a,button,iframe,.card,.tile,.scene,.camera-card,[role="button"],details,summary')){
   const blob=[el.id,el.className,el.getAttribute?.('href'),el.getAttribute?.('src'),el.getAttribute?.('onclick'),el.getAttribute?.('data-action'),el.getAttribute?.('data-camera'),el.getAttribute?.('data-device'),el.getAttribute?.('data-source'),el.innerText].filter(Boolean).join(' ');
   if(rx.test(blob))el.style.setProperty('display','none','important');
 }
});
</script>'''

stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
changed=[]
skipped=[]
backup_root=Path("/home/jespern/c720p-home-hub/backups")
backup_root.mkdir(parents=True,exist_ok=True)

for p in ROOT.rglob("*.html"):
    try:s=p.read_text(errors="ignore")
    except Exception:continue
    if not PAT.search(s) or MARKER in s:continue
    if "c720p-release" in p.parts or not os.access(p,os.W_OK):
        skipped.append(str(p));continue
    try:
        shutil.copy2(p,p.with_name(p.name+".before-v865b-hide-s3-"+stamp))
    except Exception:
        (backup_root/(p.name+".before-v865b-hide-s3-"+stamp)).write_text(s)
    if "</head>" in s:s=s.replace("</head>",INJECTION+"</head>",1)
    else:s=INJECTION+s
    tmp=p.with_suffix(p.suffix+".v865b.tmp")
    tmp.write_text(s)
    tmp.replace(p)
    changed.append(str(p))

# The S3 is intentionally parked. Disable only recurring work dedicated to it.
for unit in ("c720p-s3-profile-guard.timer","c720p-s3-battery-camera-gate.timer"):
    subprocess.run(["systemctl","--user","disable","--now",unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

print("changed",len(changed))
for x in changed:print(x)
print("skipped",len(skipped))
for x in skipped:print(x)
