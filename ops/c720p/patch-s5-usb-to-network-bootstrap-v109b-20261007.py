#!/usr/bin/env python3
from pathlib import Path
import datetime, py_compile, re, shutil, subprocess

BASE=Path("/home/jespern/c720p-home-hub")
P=BASE/"bin/c720p-s5-rediscover.py"
BACKUPS=Path("/home/jespern/c720p-backups")
MARKER="C720P_S5_USB_TO_NETWORK_BOOTSTRAP_V109B"
stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup=BACKUPS/f"s5-usb-network-bootstrap-v109b-{stamp}"
backup.mkdir(parents=True,exist_ok=False)
shutil.copy2(P,backup/(P.name+".before"))
s=P.read_text(encoding="utf-8")

if MARKER not in s:
    helper=r'''
# C720P_S5_USB_TO_NETWORK_BOOTSTRAP_V109B
def adb_rows():
 r=run(['adb','devices','-l'],4);rows=[]
 if not r:return rows
 for line in r.stdout.splitlines()[1:]:
  parts=line.split()
  if len(parts)>=2:rows.append((parts[0],parts[1]))
 return rows

def usb_to_network(prefix):
 if not any(t==EXPECTED_SERIAL and st=='device' for t,st in adb_rows()):
  return {'ok':False,'present':False}
 q=run(['adb','-s',EXPECTED_SERIAL,'shell','pm','path',PKG],5)
 m=run(['adb','-s',EXPECTED_SERIAL,'shell','getprop','ro.product.model'],4)
 sn=run(['adb','-s',EXPECTED_SERIAL,'shell','getprop','ro.serialno'],4)
 model=(m.stdout.strip() if m and m.returncode==0 else '')
 serial=(sn.stdout.strip() if sn and sn.returncode==0 else '')
 package_ok=bool(q and q.returncode==0 and 'package:' in q.stdout)
 if not (package_ok and model==EXPECTED_MODEL and serial==EXPECTED_SERIAL):
  return {'ok':False,'present':True,'model':model,'serial':serial,'package_ok':package_ok}
 ipr=run(['adb','-s',EXPECTED_SERIAL,'shell','ip','-4','-o','addr','show','dev','wlan0'],5)
 txt=(ipr.stdout if ipr else '')
 mm=re.search(r'\binet\s+((?:\d{1,3}\.){3}\d{1,3})/',txt)
 ip=mm.group(1) if mm else ''
 if not ip:
  rr=run(['adb','-s',EXPECTED_SERIAL,'shell','ip','route'],5);rt=(rr.stdout if rr else '')
  mm=re.search(r'\bsrc\s+((?:\d{1,3}\.){3}\d{1,3})',rt);ip=mm.group(1) if mm else ''
 if not ip:return {'ok':False,'present':True,'reason':'no_wifi_ipv4'}
 if prefix and not ip.startswith(prefix):return {'ok':False,'present':True,'reason':'not_current_lan','ip':ip}
 run(['adb','-s',EXPECTED_SERIAL,'shell','svc','wifi','enable'],5)
 run(['adb','-s',EXPECTED_SERIAL,'shell','settings','put','global','wifi_sleep_policy','2'],5)
 tcp=run(['adb','-s',EXPECTED_SERIAL,'tcpip','5555'],8)
 target=f'{ip}:5555';run(['adb','connect',target],8)
 ok,meta=verify(target)
 if not ok:return {'ok':False,'present':True,'target':target,'network_verify':meta,'tcpip_rc':None if tcp is None else tcp.returncode}
 return {'ok':True,'present':True,'target':target,'network_verify':meta,'harden':harden_network_bridge(target)}

'''
    idx=s.find("def atomic_state(obj):")
    if idx<0: raise SystemExit("atomic_state anchor missing")
    s=s[:idx]+helper+s[idx:]

    pat=re.compile(r"(\s*result=\{'timestamp':now,'current_host':curh,'current_port':curp,'prefix':pref,'status':'no_change','candidates':\[\]\}\n)")
    m=pat.search(s)
    if not m: raise SystemExit("result initializer anchor missing")
    inject=m.group(1)+""" # Trusted USB recovery: exact S5 only. Restore legacy network ADB automatically.
 usb=usb_to_network(pref)
 result['usb_bootstrap']=usb
 if usb.get('ok') and usb.get('target'):
  target=usb['target'];host,port=target.rsplit(':',1);port=int(port)
  if host!=curh or port!=curp:
   stamp=time.strftime('%Y%m%d_%H%M%S');b=BACKUPS/f's5-usb-autorepoint-{stamp}';b.mkdir(parents=True,exist_ok=False)
   for p in (UNIT,OC):(b/(p.name+'.before')).write_bytes(p.read_bytes())
   try:
    patch_unit(UNIT,host,port);patch_unit(OC,host,port)
    subprocess.run(['systemctl','--user','daemon-reload'],check=True,timeout=10)
    subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'],check=True,timeout=15)
   except Exception:
    UNIT.write_bytes((b/(UNIT.name+'.before')).read_bytes());OC.write_bytes((b/(OC.name+'.before')).read_bytes())
    subprocess.run(['systemctl','--user','daemon-reload']);subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'])
    raise
   result['backup']=str(b)
  result.update(status='recovered_from_usb',verified=target)
  atomic_state(result);print('S5_REDISCOVER=USB_TO_NETWORK target='+target);return 0
"""
    s=s[:m.start()]+inject+s[m.end():]

P.write_text(s,encoding="utf-8")
py_compile.compile(str(P),doraise=True)
print("S5_USB_TO_NETWORK_BOOTSTRAP_V109B=OK")
print("BACKUP="+str(backup))
print("MARKER="+str(MARKER in P.read_text()))
