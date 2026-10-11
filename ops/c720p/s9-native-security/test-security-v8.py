#!/usr/bin/env python3
"""Source-safe V8 Security audit regression and JS parse checks."""
import importlib.util
import re
import subprocess
import tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
TEMPLATE=(ROOT/"security-review-v8.html").read_text()
DEPLOY=ROOT/"deploy-security-audit-v8.py"
spec=importlib.util.spec_from_file_location("security_v8_deploy",DEPLOY)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

assert "gejast-auth-gate.js" in TEMPLATE
assert 'mode=today' in mod.ROOT_JS
assert 'mode=evidence' in mod.ROOT_JS
assert 's9SavedFolderFrame' in mod.ROOT_JS
assert 's9v8-evidence' in mod.ROOT_JS
assert 'site=' not in mod.ROOT_JS
assert 'fps<24' in TEMPLATE
assert 'requestVideoFrameCallback' in TEMPLATE
assert 'getVideoPlaybackQuality' in TEMPLATE
assert 'requestVideoFrameCallback' in mod.PERFORMANCE_JS
assert 'face-appearances.html' in str(mod.FACES)
assert 's9-phone-thumbs' in mod.change_face(
  '<html><head></head><body>const clipOK=/^motion_[0-9]{13}[.]mp4$/;'
  + "function clipStamp(rec){const name=String(rec.clip_no||'');return clipOK.test(name)?Number(name.slice(7,20)):0;}"
  + "function addVisual(card,item){}"
  + "function addTrackClues(card,item){}"
  + '</body></html>')
assert '/new/api/saved' in TEMPLATE
assert 'Europe/Amsterdam' in TEMPLATE
assert "mode==='today'" in TEMPLATE
assert 'Number(rec.sampled_frames)' in TEMPLATE
assert 'person_detected_frames_050' in TEMPLATE
assert 'uncalibrated model outputs' in TEMPLATE
assert 'gejast-auth-gate.js' in TEMPLATE
assert 'original 4k retained' in TEMPLATE.lower()
assert '.replaceAll' in TEMPLATE
with tempfile.TemporaryDirectory(prefix="security-v8-parse-") as directory:
 d=Path(directory)
 parts=[('review',re.findall(r'<script[^>]*id="s9v8-review-script"[^>]*>(.*?)</script>',TEMPLATE,re.S)),
   ('root',[mod.ROOT_JS.split('>',1)[1].rsplit("</script>",1)[0]]),
   ('players',[mod.PERFORMANCE_JS.split('>',1)[1].rsplit("</script>",1)[0]])]
 for name,bodies in parts:
  assert len(bodies)==1,name
  file=d/(name+".js");file.write_text(bodies[0])
  subprocess.run(["node","--check",str(file)],check=True,timeout=12)
print("S9_SECURITY_V8_JS_AND_LAYOUT_CONTRACT_PASS")
