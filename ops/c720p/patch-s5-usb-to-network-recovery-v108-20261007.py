#!/usr/bin/env python3
from pathlib import Path
import datetime, py_compile, shutil, subprocess

BASE=Path("/home/jespern/c720p-home-hub")
P=BASE/"bin/c720p-s5-rediscover.py"
BACKUPS=Path("/home/jespern/c720p-backups")
MARKER="C720P_S5_USB_TO_NETWORK_BOOTSTRAP_V108"

stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup=BACKUPS/f"s5-usb-network-bootstrap-v108-{stamp}"
backup.mkdir(parents=True,exist_ok=False)
shutil.copy2(P,backup/(P.name+".before"))

s=P.read_text(encoding="utf-8")
if MARKER not in s:
    fn_anchor="def atomic_state(obj):\n"
    fn=r'''# C720P_S5_USB_TO_NETWORK_BOOTSTRAP_V108
def usb_s5_identity():
 rows=run(['adb','devices','-l'],4)
 if not rows:
  return False,{'present':False,'reason':'adb_devices_failed'}
 present=False
 for line in rows.stdout.splitlines()[1:]:
  parts=line.split()
  if len(parts)>=2 and parts[0]==EXPECTED_SERIAL and parts[1]=='device':
   present=True;break
 if not present:
  return False,{'present':False,'reason':'trusted_usb_s5_not_present'}
 model=run(['adb','-s',EXPECTED_SERIAL,'shell','getprop','ro.product.model'],4)
 serial=run(['adb','-s',EXPECTED_SERIAL,'shell','getprop','ro.serialno'],4)
 pkg=run(['adb','-s',EXPECTED_SERIAL,'shell','pm','path',PKG],5)
 m=model.stdout.strip() if model and model.returncode==0 else ''
 sn=serial.stdout.strip() if serial and serial.returncode==0 else ''
 package_ok=bool(pkg and pkg.returncode==0 and 'package:' in pkg.stdout)
 ok=bool(m==EXPECTED_MODEL and sn==EXPECTED_SERIAL and package_ok)
 return ok,{'present':True,'model':m,'serial':sn,'package_ok':package_ok,'identity_ok':ok}

def usb_to_network_bootstrap(prefix):
 ok,ident=usb_s5_identity()
 out={'ok':False,'identity':ident}
 if not ok:return out
 # Only the exact trusted SM-G900F/serial may reach this point.
 run(['adb','-s',EXPECTED_SERIAL,'shell','svc','wifi','enable'],6)
 time.sleep(.8)
 ipr=run(['adb','-s',EXPECTED_SERIAL,'shell','ip','-4','-o','addr','show','dev','wlan0'],5)
 txt=ipr.stdout if ipr and ipr.returncode==0 else ''
 m=re.search(r'\\binet\\s+((?:\\d{1,3}\\.){3}\\d{1,3})/',txt)
 ip=m.group(1) if m else ''
 if not ip:
  route=run(['adb','-s',EXPECTED_SERIAL,'shell','ip','route'],5)
  txt=route.stdout if route and route.returncode==0 else ''
  m=re.search(r'\\bsrc\\s+((?:\\d{1,3}\\.){3}\\d{1,3})',txt)
  ip=m.group(1) if m else ''
 if not ip:
  out['reason']='trusted_usb_s5_has_no_wifi_ipv4';return out
 if prefix and not ip.startswith(prefix):
  out.update(reason='trusted_usb_s5_on_wrong_lan',ip=ip,prefix=prefix);return out

 for cmd in (
  ['adb','-s',EXPECTED_SERIAL,'shell','settings','put','global','adb_enabled','1'],
  ['adb','-s',EXPECTED_SERIAL,'shell','settings','put','global','wifi_sleep_policy','2'],
  ['adb','-s',EXPECTED_SERIAL,'shell','setprop','persist.adb.tcp.port','5555'],
  ['adb','-s',EXPECTED_SERIAL,'shell','setprop','service.adb.tcp.port','5555'],
 ):
  run(cmd,6)
 tcp=run(['adb','-s',EXPECTED_SERIAL,'tcpip','5555'],8)
 time.sleep(1.3)
 target=f'{ip}:5555'
 conn=run(['adb','connect',target],8)
 time.sleep(.4)
 net_ok,meta=verify(target)
 out.update(ok=bool(net_ok),ip=ip,target=target,
            tcpip_rc=None if tcp is None else tcp.returncode,
            connect_rc=None if conn is None else conn.returncode,
            network_identity=meta,
            source='trusted_usb_s5_to_network_adb')
 if net_ok:
  out['harden']=harden_network_bridge(target)
 return out

'''
    if fn_anchor not in s:
        raise SystemExit("function anchor missing")
    s=s.replace(fn_anchor,fn+fn_anchor,1)

    main_anchor=" result={'timestamp':now,'current_host':curh,'current_port':curp,'prefix':pref,'status':'no_change','candidates':[]}\n"
    main_insert=main_anchor+" usb=usb_to_network_bootstrap(pref);result['usb_bootstrap']=usb\n"
    if main_anchor not in s:
        raise SystemExit("main anchor missing")
    s=s.replace(main_anchor,main_insert,1)

P.write_text(s,encoding="utf-8")
py_compile.compile(str(P),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-s5-rediscover.timer"],check=True,timeout=20)

# Safe live probe: with no S5 USB attached it only records trusted_usb_s5_not_present.
probe=subprocess.run([str(P)],text=True,capture_output=True,timeout=45)

print("S5_USB_TO_NETWORK_BOOTSTRAP_V108=OK")
print("BACKUP="+str(backup))
print("PROBE_RC="+str(probe.returncode))
print("PROBE_OUT="+(probe.stdout or "").strip().replace("\n"," | ")[:3000])
print("PROBE_ERR="+(probe.stderr or "").strip().replace("\n"," | ")[:1500])
print("MARKER="+str(MARKER in P.read_text(encoding="utf-8")))
