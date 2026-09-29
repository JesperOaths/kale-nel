#!/usr/bin/env python3
import json, pathlib, subprocess, time, glob

def run(argv, timeout=20, limit=14000):
    try:
        p=subprocess.run(argv,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        out=(p.stdout or "")
        return f"RC={p.returncode}\n"+out[-limit:]
    except Exception as e:
        return "ERR="+repr(e)

base=pathlib.Path("/home/jespern/c720p-home-hub")
helper=base/"bin/c720p-bluetooth-helper-server.py"
server=base/"bin/ht-e6500-surround-server.py"
connector=base/"bin/c720p-samsung-bluetooth-connect.sh"
out=[]
out.append("TIME="+time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()))
for name,p in [("HELPER",helper),("SERVER",server),("CONNECTOR",connector)]:
    out.append(f"=== {name}_EXISTS === {p.exists()} {p}")
out.append("=== BTCTL_SHOW ===\n"+run(["bash","-lc","bluetoothctl show; echo ---; bluetoothctl devices; echo ---; bluetoothctl info 8C:C8:CD:8B:06:3B || true"],15,9000))
out.append("=== RFKILL ===\n"+run(["bash","-lc","rfkill list bluetooth 2>/dev/null || true"],5,3000))
out.append("=== HELPER_RELEVANT ===\n"+run(["bash","-lc",f"grep -nE 'def (prepare_hts_bluetooth|connect_audio|_quick_bt_connect|bt_connected_info|run)|bluetooth-mode|function-fast|BT_READY|CONNECT=|STATE=' {helper} | head -260"],8,12000))
out.append("=== SERVER_RELEVANT ===\n"+run(["bash","-lc",f"grep -nE 'def (send_ir|run_sequence|bluetooth_menu_sequence|ensure_hts_power)|function-fast|bluetooth-mode|/ht-e6500/dvd|/ht-e6500/function|S5|adb|ir' {server} | head -360"],8,18000))
out.append("=== CONNECTOR_CONTENT ===\n"+run(["bash","-lc",f"sed -n '1,320p' {connector}"],8,18000))
logs=sorted(glob.glob(str(base/"logs/tv-hts-v874-test-*.json")))
if logs:
    p=pathlib.Path(logs[-1]); out.append("=== V874_TEST_LOG === "+str(p)+"\n"+p.read_text(errors="ignore")[-30000:])
plogs=sorted(glob.glob(str(base/"logs/tv-hts-bluetooth-pipeline-*.json")))
if plogs:
    p=pathlib.Path(plogs[-1]); out.append("=== LAST_PIPELINE_LOG === "+str(p)+"\n"+p.read_text(errors="ignore")[-30000:])
for p in [base/"state/c720p-samsung-bluetooth.json",base/"state/tv-hts-bluetooth-state.json",base/"state/ht-e6500-power.json"]:
    if p.exists(): out.append("=== STATE "+str(p)+" ===\n"+p.read_text(errors="ignore")[-10000:])
out.append("=== SERVICES ===\n"+run(["bash","-lc","systemctl --user is-active ht-e6500-surround.service c720p-bluetooth-helper.service; systemctl --user --no-pager --full status ht-e6500-surround.service c720p-bluetooth-helper.service | tail -120"],10,12000))
print("\n".join(out))
