#!/usr/bin/env python3
from pathlib import Path
import datetime,shutil,subprocess

roots=[
 Path("/opt/homeassistant/config/www/c720p-scenes-compact.html"),
 Path("/opt/homeassistant/config/www/c720p-scenes-compact-v6.html"),
 Path("/opt/homeassistant/config/www/c720p-scenes-compact-v7.html"),
 Path("/opt/homeassistant/config/www/c720p-scenes-compact-v7b.html"),
 Path("/opt/homeassistant/config/www/c720p-scenes-s3-v1.html"),
 Path("/opt/homeassistant/config/www/c720p-release/home-scenes-s3-v1.html"),
]
stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
changed=[]

# Hide only controls/cards that are actually about the retired S3 camera.
# Do not hide generic "live" controls because those are also used by S9+.
injection=r'''<!-- C720P_V865A_HIDE_S3_ONLY -->
<style>
[data-camera="s3"],[data-device="s3"],[data-source="s3"],
a[href*="/security/s3"],a[href*="s3-clips"],a[href*="s3-saved"],
#s3Card,.s3-card,.camera-s3{display:none!important}
</style>
<script>
document.addEventListener("DOMContentLoaded",()=>{
  const looksS3=(el)=>{
    const blob=[
      el.id,el.className,el.getAttribute?.("href"),el.getAttribute?.("onclick"),
      el.getAttribute?.("data-action"),el.getAttribute?.("data-camera"),
      el.getAttribute?.("data-device"),el.getAttribute?.("data-source"),
      el.textContent
    ].filter(Boolean).join(" ").toLowerCase();
    return /(^|[^a-z0-9])s3([^a-z0-9]|$)|camera\.s3|\/security\/s3|s3-clips|s3-saved/.test(blob);
  };
  for(const el of document.querySelectorAll("a,button,.card,.tile,.scene,.camera-card,[role=button]")){
    if(looksS3(el)) el.style.setProperty("display","none","important");
  }
});
</script>'''

for p in roots:
    if not p.is_file():continue
    s=p.read_text(errors="ignore")
    if "C720P_V865A_HIDE_S3_ONLY" in s:continue
    # Remove the earlier over-broad patch if present.
    s=s.replace('/* C720P_V865_HIDE_S3_CONTROL */<style>button[data-action="live"],button[data-action="live-camera"],.c720p-live-v4b{display:none!important}</style>',"")
    if "</head>" in s:s=s.replace("</head>",injection+"</head>",1)
    else:s=injection+s
    shutil.copy2(p,p.with_name(p.name+".before-v865a-hide-s3-"+stamp))
    tmp=p.with_suffix(p.suffix+".tmp");tmp.write_text(s);tmp.replace(p)
    changed.append(str(p))

# S3 is intentionally parked for now. Stop only S3-specific recurring work;
# leave S9+, Home Assistant and the generic camera-return infrastructure alone.
for unit in ("c720p-s3-profile-guard.timer","c720p-s3-battery-camera-gate.timer"):
    subprocess.run(["systemctl","--user","disable","--now",unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

print("\n".join(changed))
