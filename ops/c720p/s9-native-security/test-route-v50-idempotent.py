#!/usr/bin/env python3
"""Dry-run actual Security route installation against the existing V50 redirect."""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile

REPO=Path(__file__).resolve().parents[3]
INSTALLER=REPO/"ops/c720p/s9-native-security/deploy-people-v45.py"
spec=importlib.util.spec_from_file_location("security_installer",INSTALLER)
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

def run_case(legacy,expected=True):
 with tempfile.TemporaryDirectory() as folder:
  root=Path(folder)
  installer.DEST={key:root/key for key in
     ("html","js","people50","tracks50","legacy","shell","tracks","hub","entry")}
  for key in ("html","js","tracks"):
   installer.DEST[key].write_bytes((REPO/installer.ORIG[key]).read_bytes())
  # Real outer Home Assistant page is a small wrapper, not historical inline JS.
  installer.DEST["shell"].write_text('<!doctype html><html><body>Security shell</body></html>')
  installer.DEST["hub"].write_text(
   "/* s9-people-v45-real-route */\\n"
   "const tabs=[['faces','People & faces','◎',"
   "'security-people-v45.html?v=s9pf-v49-folder-first-20261018&'],"
   "['tracks','Tracks & movement','◇',"
   "'security-tracks-v7.html?v=route-v50-20261018&']];")
  installer.DEST["entry"].write_text(
   '/* s9-people-v45-real-route */ <script src="security-hub-v30.js?v=people-faces-v50-route-correction-20261018"></script>')
  installer.DEST["legacy"].write_text(legacy)
  installer.archive=lambda:{"motion_1792000000000.mp4"}
  installer.get=lambda url,limit=220000:(REPO/("ops/"+url.split("/ops/",1)[1])).read_bytes()
  old_args=sys.argv
  sys.argv=[str(INSTALLER),"--ref","a"*40,"--dry-run"]
  output=io.StringIO()
  try:
   with contextlib.redirect_stdout(output):
    try:
     installer.main()
     succeeded=True
    except RuntimeError:
     succeeded=False
  finally:
   sys.argv=old_args
  assert succeeded is expected,(succeeded,expected,output.getvalue())
  if expected:
   assert "S9_PEOPLE_V45_LIVE_ROUTE_DRY_RUN_PASS" in output.getvalue()
   assert '"legacy"' in output.getvalue()
   assert '"tracks50"' in output.getvalue()

run_case("<html>Review candidate recordings</html>")
run_case('<html><script>location.replace("/local/frontyard-security-new/security-people-v45.html?v=route-v50-20261018")</script></html>')
run_case('<html><script>location.replace("security-people-v50.html?v=security-visible-route-v50-20261018")</script></html>')
run_case("<html>Unknown custom page</html>",False)
print("SECURITY_V50_REDEPLOY_DRY_RUN_PASS")
