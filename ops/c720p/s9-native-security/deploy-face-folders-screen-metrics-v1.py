#!/usr/bin/env python3
"""Patch only the existing anonymous movement evidence lines in face folders.

Shows S9 4K image speed and path straightness if actually measured. Never
extrapolates posture, gait, physical speed, or cross-video identity.
"""
import datetime,os,shutil,subprocess,tempfile
from pathlib import Path
FILE=Path("/opt/homeassistant/config/www/frontyard-security-new/security-face-folders-v22.html")
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-face-folders-screen-metrics-v1")
ORIGINAL="""    body.append(el('small','',String(track.id||'Anonymous person')+
      ' · '+colour+' clothing · movement: '+direction+
      ' · posture: not measured · gait: not measurable from sampled frames'));"""
REPLACEMENT="""    const measuredSpeed=Number(track.image_speed_body_heights_per_second);
    const speed=track.image_speed_body_heights_per_second!=null&&Number.isFinite(measuredSpeed)&&
      measuredSpeed>=0&&measuredSpeed<=8?' · image speed: '+measuredSpeed.toFixed(2)+' body-heights/s':'';
    const path=track.image_path_straightness!=null&&Number.isFinite(Number(track.image_path_straightness))?
      ' · image path straightness: '+Math.round(100*Number(track.image_path_straightness))+'%':'';
    body.append(el('small','',String(track.id||'Anonymous person')+
      ' · '+colour+' clothing · image direction: '+direction+speed+path+
      ' · posture: not measured · gait: no cadence model'));"""
def main():
 if not FILE.is_file() or FILE.is_symlink():raise RuntimeError("unexpected_live_page")
 before=FILE.read_text()
 if REPLACEMENT in before:
  print("S9_FACE_FOLDER_IMAGE_METRICS_ALREADY_DEPLOYED");return
 if before.count(ORIGINAL)!=1 or "SECURITY FACE FOLDERS V22" not in before:
  raise RuntimeError("live_face_folder_structure_changed")
 updated=before.replace(ORIGINAL,REPLACEMENT,1)
 if updated.count("image_speed_body_heights_per_second")!=1 or "gait: no cadence model" not in updated:
  raise RuntimeError("unsafe_mislabelled_motion_ui")
 BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BACK/(stamp+".html");shutil.copy2(FILE,backup)
 fd,temp=tempfile.mkstemp(prefix=".s9face2d-",dir=FILE.parent)
 try:
  with os.fdopen(fd,"w") as out:out.write(updated);out.flush();os.fsync(out.fileno())
  st=FILE.stat()
  os.chmod(temp,st.st_mode&0o777)
  os.replace(temp,FILE)
  check=FILE.read_text()
  if check!=updated:raise RuntimeError("applied_document_changed")
  print("S9_FACE_FOLDERS_MOVEMENT_EVIDENCE_UI_LIVE",{"backup":str(backup),
    "anonymous_clip_only":True,"pose_model_claim":False,"gait_recognition_claim":False},flush=True)
 except BaseException:
  shutil.copy2(backup,FILE)
  raise
 finally:
  if os.path.exists(temp):os.unlink(temp)
if __name__=="__main__":main()
