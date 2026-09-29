#!/usr/bin/env python3
import pathlib,json,glob,subprocess,hashlib,os,re
B=pathlib.Path("/home/jespern/c720p-home-hub")
def run(cmd,timeout=20,limit=26000):
    try:
        p=subprocess.run(["bash","-lc",cmd],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return f"RC={p.returncode}\n"+(p.stdout or "")[-limit:]
    except Exception as e:return "ERR="+repr(e)

print("=== PIPELINE_SUMMARIES ===")
for f in sorted(glob.glob(str(B/"logs/tv-hts-bluetooth-pipeline-*.json")))[-80:]:
    try:
        d=json.loads(pathlib.Path(f).read_text())
        print(pathlib.Path(f).name,
              "ok=",d.get("ok"),"state=",d.get("state"),"failure=",d.get("failure"),
              "bt=",d.get("bluetooth_connected"),"hts=",d.get("hts_input"),
              "markers=",",".join(d.get("result_markers") or []))
    except Exception: pass
print("=== LAST_SUCCESS_DETAIL ===")
succ=[]
for f in glob.glob(str(B/"logs/tv-hts-bluetooth-pipeline-*.json")):
    try:
        d=json.loads(pathlib.Path(f).read_text())
        if d.get("ok") is True and (d.get("bluetooth_connected") is True or d.get("state")=="connected_verified"):
            succ.append((f,d))
    except Exception: pass
if succ:
    f,d=sorted(succ,key=lambda x:x[0])[-1]
    print("FILE",f)
    print(json.dumps(d,indent=2)[-24000:])
print("=== CONNECTOR_SUCCESS_LOGS ===")
for f in sorted(glob.glob(str(B/"logs/samsung-bluetooth-connect-*.log")))[-60:]:
    txt=pathlib.Path(f).read_text(errors="ignore")
    if re.search(r"Connected: yes|bluetooth_connected.?[:=].?true|Paired and connected|SINK|default",txt,re.I):
        print("---",pathlib.Path(f).name,"---")
        print(txt[-5000:])
print("=== MANUAL_SOURCE_TREE ===")
print(run("find /home/jespern/s5-ir-bridge-manual -maxdepth 5 -type f -printf '%p\n' 2>/dev/null | sort",10,12000))
print("=== IRRECEIVER_SOURCE ===")
print(run("find /home/jespern/s5-ir-bridge-manual -type f \( -name '*IrReceiver*' -o -name '*.java' \) -print -exec sed -n '1,320p' {} \;",15,30000))
for p in ["/home/jespern/patch_s5_ir_bridge_final_verified_remote.py",
          "/home/jespern/build_install_s5_ir_bridge.sh",
          "/home/jespern/patch_s5_ir_bridge_exact_source_candidates.py",
          "/home/jespern/patch_s5_ir_bridge_source_only_candidates.py"]:
    q=pathlib.Path(p)
    if q.exists():
        print("=== FILE",p,"===")
        print(q.read_text(errors="ignore")[-26000:])
print("=== APK_HASHES ===")
for p in [
 "/tmp/s5irbridge-v875.apk",
 "/home/jespern/c720p-backups/s5-ir-function-fix-20260926-210547/s5-ir-live-before.apk",
 "/home/jespern/c720p-home-hub/tmp/s5-ir-parity/installed-current.apk",
 "/home/jespern/c720p-backups/s5-ir-before-grundig-restore-20260926_081834/current-after.apk",
 "/home/jespern/c720p-backups/s5-ir-before-grundig-restore-20260926_081834/current-before.apk"
]:
 q=pathlib.Path(p)
 if q.exists(): print(q.stat().st_size,hashlib.sha256(q.read_bytes()).hexdigest(),p)
