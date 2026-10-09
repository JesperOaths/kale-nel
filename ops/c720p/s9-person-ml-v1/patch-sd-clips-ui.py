#!/usr/bin/env python3
"""Make the existing S9 Camera Clips panel play local verified SD files."""
from pathlib import Path
import shutil,datetime
p=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
s=p.read_text()
if "if(!rec.drive_verified || !rec.remote_name)" not in s:
 if "if(!(rec.sd_verified || rec.drive_verified)" in s:
  print("SD_PLAYER_ALREADY_CONFIGURED");raise SystemExit(0)
 raise RuntimeError("S9 player source changed")
backup=p.with_name("clips.html.before-sd-local-"+datetime.datetime.now().strftime("%Y%m%d%H%M%S"))
shutil.copy2(p,backup)
s=s.replace("if(!rec.drive_verified || !rec.remote_name){toast('MicroSD copy awaiting Drive verification');return}","if(!(rec.sd_verified || rec.drive_verified) || !(rec.name || rec.remote_name)){toast('Video is not verified on SD');return}",1)
s=s.replace("encode(rec.remote_name));","encode(rec.name||rec.remote_name));",1)
s=s.replace("S9+ recording · verified Drive backup","S9+ recording · verified microSD original",1)
s=s.replace("Original retained on phone microSD. Manage Drive copy in Saved Clips.","Verified original is stored on S9+ microSD; no cloud upload needed.",1)
s=s.replace("Could not load Drive copy: ","Could not open S9+ microSD recording: ",1)
s=s.replace("High-resolution originals stored on phone. Green means verified in Google Drive; amber means pending backup.","Original recordings and thumbnails are saved on S9+ microSD. No Drive upload required.",1)
s=s.replace("rec.drive_verified?'':' pending'","(rec.drive_verified||rec.sd_verified)?'':' pending'",1)
s=s.replace("rec.drive_verified?'Play verified Drive recording':'Stored on S9+ microSD; Drive backup pending'","rec.sd_verified?'Play verified microSD recording':(rec.drive_verified?'Play Drive recording':'Recording not verified')",1)
s=s.replace("rec.drive_verified?'✓ Drive verified':'◷ SD only, backup pending'","rec.sd_verified?'✓ microSD verified':(rec.drive_verified?'✓ Drive verified':'◷ Verification pending')",1)
part=p.with_suffix(".html.sdnew")
part.write_text(s)
part.chmod(p.stat().st_mode & 0o777)
part.replace(p)
print("SD_CLIPS_PLAYER_PATCHED",backup)
