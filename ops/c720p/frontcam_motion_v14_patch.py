from pathlib import Path
import subprocess,py_compile,time,json,shutil
p=Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
shutil.copy2(p,"/home/jespern/c720p-backups/frontcam-motion-before-v15.py")
s=p.read_text()
for a,b in [("frontcam-motion-v14","frontcam-motion-v15"),("FRONTCAM_MOTION_V14","FRONTCAM_MOTION_V15"),("AMBIENT_LIGHT_ON=42.0","AMBIENT_LIGHT_ON=48.0"),("AMBIENT_LIGHT_OFF=32.0","AMBIENT_LIGHT_OFF=36.0"),("tdiff=cv2.absdiff(compensated,prev)","tdiff=cv2.medianBlur(cv2.absdiff(compensated,prev),3)"),("and temporal_largest>=16.0","and temporal_largest>=14.0"),("                if step<=45.0:\n","                ratio=float(temporal_largest)/max(1.0,dark_track_area)\n                if step<=26.0 and 0.25<=ratio<=4.0:\n"),("and temporal_largest>=55.0","and temporal_largest>=48.0"),("and dark_track_displacement>=1.0)","and dark_track_displacement>=1.2)"),("and dark_track_displacement>=1.5)","and dark_track_displacement>=2.8)"),("dark_confirmed=bool(cautious_dark_ok and dark_temporal_streak>=3)","dark_confirmed=bool(cautious_dark_ok and dark_temporal_streak>=4)")]:
    s=s.replace(a,b,1)
s=s.replace("            dark_track_centroid=temporal_centroid\n        else:\n","            dark_track_centroid=temporal_centroid\n            dark_track_area=max(1.0,float(temporal_largest))\n        else:\n",1)
s=s.replace("            dark_track_centroid=None\n            dark_track_displacement=0.0\n","            dark_track_centroid=None\n            dark_track_area=0.0\n            dark_track_displacement=0.0\n",1)
p.write_text(s)
py_compile.compile(str(p),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True)
time.sleep(8)
print(json.dumps(json.loads(Path("/home/jespern/c720p-home-hub/state/frontcam-motion-living-lamp.json").read_text()),indent=2))
