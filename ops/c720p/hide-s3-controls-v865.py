#!/usr/bin/env python3
from pathlib import Path
import datetime,shutil
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
for p in roots:
    if not p.is_file():continue
    s=p.read_text()
    marker="/* C720P_V865_HIDE_S3_CONTROL */"
    if marker in s:continue
    css=marker+"<style>button[data-action=\"live\"],button[data-action=\"live-camera\"],.c720p-live-v4b{display:none!important}</style>"
    if "</head>" in s:s=s.replace("</head>",css+"</head>",1)
    else:s=css+s
    shutil.copy2(p,p.with_name(p.name+".before-v865-hide-s3-"+stamp))
    tmp=p.with_suffix(p.suffix+".tmp");tmp.write_text(s);tmp.replace(p)
    changed.append(str(p))
print("\n".join(changed))
