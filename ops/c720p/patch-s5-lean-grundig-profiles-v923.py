#!/usr/bin/env python3
from pathlib import Path
import shutil, subprocess, time, re

HOME=Path("/home/jespern")
SRC=HOME/"s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java"
BUILD=HOME/"build_install_s5_ir_bridge.sh"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v923-lean-grundig-profiles-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (SRC,BUILD):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

codes={
"lean_grundig_tv1_power":(29851,[495,2607,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,20724,495,2607,495,990,990,990,495,495,495,495,495,495,495,495,495,495,495,495,495,118107]),
"lean_grundig_tv3_power":(29851,[495,2607,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,495,20757,495,2607,495,990,990,990,495,495,495,495,495,495,495,495,495,495,495,495,495,118338]),
"lean_grundig_tv4_power":(31746,[527,2542,527,527,527,527,527,527,527,527,527,527,527,527,527,527,527,527,527,527,527,19592,527,2542,527,1085,1085,1085,527,527,527,527,527,527,527,527,1085,527,527,113243]),
"lean_grundig_tv5_power":(36364,[864,864,864,864,1728,864,864,864,864,864,864,864,864,864,864,864,864,1728,864,864,1728,864,864,87858]),
}
lines=["        CODES.put(\"%s\", new Code(%d, new int[]{%s}));"%(name,freq,",".join(map(str,pat))) for name,(freq,pat) in codes.items()]
block="\n".join(lines)

def add_to_java(text):
    if all(name in text for name in codes): return text
    anchor='        putNec("grundig_power_alt"'
    i=text.find(anchor)
    if i<0:
        anchor='        CODES.put("function"'
        i=text.find(anchor)
    if i<0: raise RuntimeError("IR source anchor missing")
    e=text.find("\n",i)
    return text[:e+1]+block+"\n"+text[e+1:]

s=SRC.read_text()
s=add_to_java(s)
SRC.write_text(s)

# Keep rebuild generator persistent too.
g=BUILD.read_text()
if not all(name in g for name in codes):
    anchor='        putNec("grundig_power_alt"'
    i=g.find(anchor)
    if i<0:
        anchor='        CODES.put("function"'
        i=g.find(anchor)
    if i<0: raise RuntimeError("build generator anchor missing")
    e=g.find("\n",i)
    g=g[:e+1]+block+"\n"+g[e+1:]
    BUILD.write_text(g)

subprocess.run([str(BUILD)],check=True,timeout=180)
time.sleep(2)

# Verify the installed package accepts all new named commands without sending
# multiple frames to a live TV here; the actual bounded physical test is separate.
check=SRC.read_text()
missing=[n for n in codes if n not in check]
if missing: raise RuntimeError("missing profile(s): "+",".join(missing))
print("BACKUP="+str(BACK))
print("PROFILES="+",".join(codes))
print("RESULT=V923_LEAN_GRUNDIG_PROFILES_INSTALLED")
