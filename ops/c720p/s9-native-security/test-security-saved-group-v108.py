#!/usr/bin/env python3
"""Synthetic source-only V108 saved-clips edit control and concurrency boundaries."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("safe_saved_group_v108",ROOT/"deploy-security-saved-group-edit-v108.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
source=(ROOT/"security-people-v45.js").read_text()
newblock=mod.b.block(source," if(item.decision==='approved'){",mod.END)
oldblock=""" if(item.decision==='approved'){
  if(state.folder)tools.append(control('↩ Return to review queue',
    ()=>manualLink({source:item.source||'sd',name:item.name||item.clip,clip:item.clip},null),'secondary'));
  else tools.append(control('Saved ✓',()=>{},'secondary'));
"""
# Replay old live action without altering any other feature. The actual live
# deployment must separately pass an exact SHA256 check.
old=source.replace(newblock,oldblock,1)
if source==old:raise AssertionError("old action unexpectedly unchanged")
for marker in mod.MUST_RETAIN:
    if marker not in old:old+="\n// "+marker+"\n"
patched=mod.patch_js(old,source)
assert "＋ Edit people" in patched and "Saved ✓" not in patched
assert "↩ Return to review queue" in patched
assert patched.count("＋ Edit people")==1
assert all(marker in patched for marker in mod.MUST_RETAIN)
with tempfile.TemporaryDirectory() as directory:
    script=Path(directory)/"people.js";script.write_text(patched)
    subprocess.run(["node","--check",str(script)],capture_output=True,check=True)
try:
    mod.patch_js(old.replace("if(state.folder)tools.append", "if(true)tools.append",1),source)
except RuntimeError:pass
else:raise AssertionError("Concurrent edit did not fail closed")
print("SECURITY_SAVED_GROUP_V108_SOURCE_ONLY_PASS")
