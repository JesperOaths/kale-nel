#!/usr/bin/env python3
"""Regression: the LAN relay face rule is narrow, authenticated and reversible."""
import contextlib
import importlib.util
import io
import os
import py_compile
import re
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
DEPLOY=ROOT/"deploy-face-snapshot-lan-relay-v55.py"
spec=importlib.util.spec_from_file_location("face_lan_v55",DEPLOY)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
content=DEPLOY.read_text()
py_compile.compile(str(DEPLOY),doraise=True)
assert mod.ANCHOR.count("saved/(clip|snap)")==1
assert mod.NEW.count("saved/face/")==1
assert "m.group(2)" in mod.NEW
assert "self.archive(" in mod.NEW
assert "if not self.authorized(): return self.empty(401)" in content
assert "original_media_modified" in content
for invalid in ["../../etc/passwd","motion_1__p__1_0.jpg",
                "motion_1792000000000__abc__42_3.jpg","image.jpg"]:
 assert not mod.FACE.fullmatch(invalid),invalid
good="motion_1792000000000__pending_1__6365_0.jpg"
assert mod.FACE.fullmatch(good)

old=(
 "class Handler:\n"
 " def authorized(self):return True\n"
 " def empty(self,status):pass\n"
 " def archive(self,*args,**kwargs):pass\n"
 " def go(self,head=False):\n"
 "  path='/new/api/saved'\n"
 "  if not self.authorized(): return self.empty(401)\n"
 "  # SECURITY_DRIVE_PERSON_READONLY_V22\n"
 +mod.ANCHOR+
 "  if m:return self.archive(m.group(1),'/saved/'+m.group(2)+'/'+urllib.parse.quote(m.group(3)),head)\n"
 " def do_HEAD(self): self.go(True)\n"
)
items={"motion_1792000000000.mp4"}
faces=[good,"motion_1792000000000__pending_2__8300_0.jpg",
       "motion_1792000000000__pending_3__9100_0.jpg"]

def run(path,apply,health=True):
 original=sys.argv
 sys.argv=[str(DEPLOY)]+(["--apply"] if apply else [])
 try:
  with patch.object(mod,"TARGET",path),patch.object(mod,"BACK",path.parent/"backup"),\
       patch.object(mod,"service",return_value="active"),\
       patch.object(mod,"inventory",return_value=(items,faces)),\
       patch.object(mod,"jpeg",return_value={"size":600,"digest16":"ab12","cors":"*"}),\
       patch.object(mod,"healthy",side_effect=None if health else RuntimeError("failure")) as h,\
       patch.object(mod,"request",return_value=(b'{}',{})):
   if health:h.return_value={"original_recordings":1,"jpeg_samples":3}
   capture=io.StringIO()
   try:
    with contextlib.redirect_stdout(capture):mod.main()
   except RuntimeError:
    if health:raise
   return capture.getvalue()
 finally:sys.argv=original

with tempfile.TemporaryDirectory(prefix="face-lan-v55-") as tmp:
 root=Path(tmp);target=root/"relay.py";target.write_text(old)
 before=target.read_bytes()
 assert "DRY_RUN" in run(target,False)
 assert target.read_bytes()==before
 assert "VERIFIED" in run(target,True)
 updated=target.read_text()
 assert updated.count(mod.MARK)==1
 assert updated.index(mod.NEW)<updated.index(mod.ANCHOR)
 assert updated.index("if not self.authorized(): return self.empty(401)")<updated.index(mod.NEW)
 assert "ALREADY_VERIFIED" in run(target,True)
 assert target.read_text()==updated
 # The alternate pathway must restore the exact original bytes.
 target.write_text(old)
 log=run(target,True,False)
 assert "ROLLED_BACK" in log
 assert target.read_text()==old
 # Unexpected/authentication-free relay sources are rejected.
 target.write_text(old.replace("if not self.authorized(): return self.empty(401)","pass"))
 try:run(target,False)
 except RuntimeError:pass
 else:raise AssertionError("unauthenticated route accepted")
print("SECURITY_FACE_RELAY_V55_SOURCE_DRYRUN_ROLLBACK_TEST_PASS")
