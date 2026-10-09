#!/usr/bin/env python3
from pathlib import Path
p=Path('/tmp/manual-lamp-camera-ownership-v1.py')
s=p.read_text()
old='eco.write_text(s);aut.write_text(a)'
new="""Path('/tmp/eco-manual-ownership.yaml').write_text(s)
 aut.write_text(a)
 copy=run(['docker','cp','/tmp/eco-manual-ownership.yaml','homeassistant:/config/packages/c720p_energy_saver_v1.yaml'],45)
 if copy.returncode: raise RuntimeError('docker cp: '+copy.stderr[-500:])"""
assert s.count(old)==1
s=s.replace(old,new,1)
old="shutil.copy2(back/'eco.before',eco);shutil.copy2(back/'automations.before',aut)"
new="""run(['docker','cp',str(back/'eco.before'),'homeassistant:/config/packages/c720p_energy_saver_v1.yaml'],45)
 shutil.copy2(back/'automations.before',aut)"""
assert s.count(old)==1
s=s.replace(old,new,1)
p.write_text(s)
import py_compile
py_compile.compile(str(p),doraise=True)
print('permission_patch_ok')
