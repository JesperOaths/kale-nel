#!/usr/bin/env python3
"""Static regressions: only recreatable cache paths are eligible."""
import importlib.util
import tempfile
from pathlib import Path
src=Path(__file__).with_name("reclaim-browser-caches-20261014.py")
spec=importlib.util.spec_from_file_location("cache_sweep",src)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
assert set(mod.ONLY_CACHES)=={
 "Default/Service Worker/CacheStorage","Default/Cache",
 "Default/Code Cache","Default/GPUCache",
 "Default/ShaderCache","Default/GrShaderCache","Default/DawnCache",
 "GPUPersistentCache"}
for dangerous in ("IndexedDB","Local Storage","Cookies","Sessions","Registrations","Widevine"):
 assert all(dangerous not in item for item in mod.ONLY_CACHES)
with tempfile.TemporaryDirectory() as root:
 p=Path(root)/"profile"
 p.mkdir()
 (p/"Default").mkdir()
 (p/"Default"/"Cache").mkdir()
 (p/"Default"/"IndexedDB").mkdir()
 assert mod.valid_cache(p,p/"Default"/"Cache")
 assert not mod.valid_cache(p,p/"Default"/"IndexedDB")
 assert not mod.valid_cache(p,Path(root)/"elsewhere")
 s=(p/"Default"/"Code Cache")
 s.symlink_to(p/"Default"/"IndexedDB",target_is_directory=True)
 assert not mod.valid_cache(p,s)
source=src.read_text()
assert "if active(unit) or browser_references(profile)" in source
assert 'if rec["was_active"]:' in source
assert "finally:" in source
assert "if not phone_health():" in source
assert 'parser.add_argument("--apply",action="store_true")' in source
print("C720P_BROWSER_CACHE_ONLY_SCOPE_PASS")
