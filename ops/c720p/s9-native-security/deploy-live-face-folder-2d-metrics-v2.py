#!/usr/bin/env python3
"""Guarded update of the actual live S9 People & Faces clip-only movement UI.

Do not replace page or remove existing optional pose metrics. Append the new
bounded 2D measurements where present; label unavailable posture/cadence
accurately. Back up and validate JS with node or Chromium before publishing.
"""
from pathlib import Path
import datetime,os,re,shutil,subprocess,tempfile
P=Path("/opt/homeassistant/config/www/frontyard-security-new/security-face-folders-v22.html")
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-actual-face-folder-2d-ui-v1")
ANCHOR=" if(number(track.sample_count)>0)parts.push(track.sample_count+' sampled frames');return parts.join(' · ');"
INSERT=""" const imageSpeed=number(track.image_speed_body_heights_per_second);
 if(imageSpeed!==null&&imageSpeed>=0&&imageSpeed<=8)
  parts.push(imageSpeed.toFixed(2)+' body-heights/s in camera image · not physical speed');
 const imagePath=number(track.image_path_straightness);
 if(imagePath!==null&&imagePath>=0&&imagePath<=1)
  parts.push(Math.round(100*imagePath)+'% camera-image path straightness');
 const boxAspect=number(track.image_detector_box_aspect_ratio);
 if(boxAspect!==null&&boxAspect>=0&&boxAspect<=6)
  parts.push(boxAspect.toFixed(2)+' detector box width/height');
"""
OLD="if(!entry.track.pose_metrics)body.append(el('small','','Posture and walking review pending'));"
NEW="if(!entry.track.pose_metrics)body.append(el('small','','Posture and walking cadence: not measured without validated pose keypoints'));"
def main():
 before=P.read_text()
 if "body-heights/s in camera image · not physical speed" in before:
  print("S9_FACE_FOLDER_2D_UI_ALREADY_APPLIED");return
 if before.count(ANCHOR)!=1 or before.count(OLD)!=1 or before.count("function trackText(track,includeID=true)")!=1:
  raise RuntimeError("unexpected_ui_structure")
 after=before.replace(ANCHOR,INSERT+ANCHOR,1).replace(OLD,NEW,1)
 if after.count("function trackText(track,includeID=true)")!=1 or "gait_availability==='available_projected_ankle_cycle'" not in after:
  raise RuntimeError("existing_optional_pose_metrics_contract_dropped")
 # Extract all script blocks into JS and check at least syntax validity.
 js_parts=re.findall(r"<script(?:\s[^>]*)?>([\s\S]*?)</script>",after,flags=re.I)
 if not js_parts:raise RuntimeError("no_inline_scripts")
 checker=shutil.which("node")
 if checker:
  for code in js_parts:
   if not code.strip():continue
   p=subprocess.run([checker,"--check"],input=code,text=True,capture_output=True,timeout=18)
   if p.returncode:raise RuntimeError("JS_syntax_failed_"+p.stderr[-330:])
 BACK.mkdir(parents=True,mode=0o700,exist_ok=True)
 backup=BACK/(datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".html")
 shutil.copy2(P,backup)
 fd,temp=tempfile.mkstemp(prefix=".s9-face-live-",dir=P.parent)
 try:
  with os.fdopen(fd,"w") as out:out.write(after);out.flush();os.fsync(out.fileno())
  os.chmod(temp,P.stat().st_mode&0o777)
  os.replace(temp,P)
  if P.read_text()!=after:raise RuntimeError("readback_changed")
  print("S9_ACTUAL_FACE_FOLDER_IMAGE_METRICS_DEPLOYED",{"backup":str(backup),
    "source_4k_unchanged":True,"pose_and_gait_not_falsified":True,
    "javascript_syntax_checked":bool(checker)},flush=True)
 except BaseException:
  shutil.copy2(backup,P)
  raise
 finally:
  if os.path.exists(temp):os.unlink(temp)
if __name__=="__main__":main()
