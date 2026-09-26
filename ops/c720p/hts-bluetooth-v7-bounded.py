from pathlib import Path
import shutil,datetime,subprocess,time,json,urllib.request,re
base=Path("/home/jespern/c720p-home-hub")
helper=base/"bin/c720p-bluetooth-helper-server.py"
conn=base/"bin/c720p-samsung-bluetooth-connect.sh"
ts=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
for p in (helper,conn):
    shutil.copy2(p,str(p)+f".backup-bt-v7-{ts}")

s=helper.read_text(encoding="utf-8")
s=s.replace('"bluetoothctl scan off >/dev/null 2>&1 || true; "
        "bluetoothctl cancel-pairing 8C:C8:CD:8B:06:3B >/dev/null 2>&1 || true; "
        "sleep 0.3"',
            '"bluetoothctl scan off >/dev/null 2>&1 || true; sleep 0.2"')
helper.write_text(s,encoding="utf-8")

s=conn.read_text(encoding="utf-8")
s=s.replace('SOURCE_CYCLES=8','SOURCE_CYCLES=0')
s=s.replace('  timeout 9 bluetoothctl connect "$MAC" 2>&1 || true','  timeout 5 bluetoothctl connect "$MAC" 2>&1 || true')
s=s.replace('  bluetoothctl cancel-pairing "$MAC" >/dev/null 2>&1 || true\n','')
s=s.replace('  sleep 0.3\n','  sleep 0.2\n',1)
# tighten bounded BT READY pair/connect window
s=s.replace('timeout 8 bluetoothctl scan bredr','timeout 6 bluetoothctl scan bredr')
s=s.replace('  sleep 1.2\n','  sleep 0.7\n',1)
s=s.replace('  timeout 7 bluetoothctl --agent NoInputNoOutput pair "$MAC" 2>&1 || true','  timeout 6 bluetoothctl --agent NoInputNoOutput pair "$MAC" 2>&1 || true')
s=s.replace('    timeout 7 bluetoothctl connect "$MAC" 2>&1 || true','    timeout 5 bluetoothctl connect "$MAC" 2>&1 || true')
s=s.replace('  sleep 1.2\n','  sleep 0.5\n',1)

old='''if ! is_connected; then
  # The receiver's Input/FUNCTION button cycles eight sources. Test the C720P
  # connection window after every press, so arbitrary starting sources converge
  # to BT within one complete bounded cycle.
  for i in $(seq 1 "$SOURCE_CYCLES"); do
    cycle_source "$i"
    echo "Quick pair/connect after source-cycle $i"
    if quick_pair_connect; then
      echo "Paired and connected after source-cycle $i"
      break
    fi
  done
fi
'''
new='''if ! is_connected; then
  # The orchestrator has already put the receiver on BT deterministically.
  # Stay on BT and retry pairing once; source cycling here would move away from
  # the desired input and make recovery slower.
  echo "Retry pair/connect once while staying in BT READY"
  sleep 0.7
  quick_pair_connect || true
fi
'''
if old not in s:
    raise SystemExit("old source-cycle fallback not found")
s=s.replace(old,new,1)
conn.write_text(s,encoding="utf-8")

subprocess.run(["python3","-m","py_compile",str(helper)],check=True)
subprocess.run(["bash","-n",str(conn)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BT_HELPER="+subprocess.run(["systemctl","--user","is-active","c720p-bluetooth-helper.service"],text=True,capture_output=True).stdout.strip())
print("CANCEL_PAIRING_REFS_HELPER="+str(helper.read_text().count("cancel-pairing")))
print("CANCEL_PAIRING_REFS_CONNECTOR="+str(conn.read_text().count("cancel-pairing")))
print("RESULT=BT_V7_PATCHED")
