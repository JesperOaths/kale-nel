#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess, re, os, time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
REDISCOVER=BIN/"c720p-s5-rediscover.py"
CONNECT=BIN/"openclaw-s5-adb-connect.sh"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"s5-network-adb-selfheal-v117-{STAMP}"
BACK.mkdir(parents=True, exist_ok=True)
for p in (REDISCOVER, CONNECT):
    if not p.exists(): raise SystemExit(f"missing required file: {p}")
    shutil.copy2(p, BACK/(p.name+".before"))
rediscover = r'''#!/usr/bin/env python3
import concurrent.futures,json,os,re,socket,subprocess,time
from pathlib import Path
IFACE='wlp1s0';PKG='com.bruis.s5irbridge';EXPECTED_MODEL='SM-G900F';EXPECTED_SERIAL='993e96d0'
UNIT=Path('/home/jespern/.config/systemd/user/ht-e6500-surround.service')
OC=Path('/home/jespern/.config/systemd/user/openclaw-s5-adb-connect.service')
STATE=Path('/home/jespern/c720p-home-hub/state/s5-rediscovery.json');BACKUPS=Path('/home/jespern/c720p-backups')
def run(c,t=5):
 try:return subprocess.run(c,text=True,capture_output=True,timeout=t)
 except Exception:return None
def local_prefix():
 r=run(['ip','-4','-o','addr','show','dev',IFACE],3)
 if not r:return None
 m=re.search(r'\binet\s+(\d+\.\d+\.\d+)\.\d+/',r.stdout);return m.group(1)+'.' if m else None
def env_value(path,key):
 try:s=path.read_text()
 except Exception:return ''
 m=re.search(r'^Environment='+re.escape(key)+r'=(.+)$',s,re.M);return m.group(1).strip() if m else ''
def open_port(ip,p,timeout=.12):
 s=socket.socket();s.settimeout(timeout)
 try:return s.connect_ex((ip,p))==0
 except Exception:return False
 finally:s.close()
def adb_rows():
 r=run(['adb','devices','-l'],4);rows=[]
 if not r:return rows
 for line in r.stdout.splitlines()[1:]:
  parts=line.split()
  if len(parts)>=2:rows.append((parts[0],parts[1],line))
 return rows
def verify(target):
 conn=run(['adb','connect',target],5) if ':' in target else None
 state=run(['adb','-s',target,'get-state'],4);model=run(['adb','-s',target,'shell','getprop','ro.product.model'],4);serial=run(['adb','-s',target,'shell','getprop','ro.serialno'],4);pkg=run(['adb','-s',target,'shell','pm','path',PKG],5)
 m=(model.stdout if model else '').strip();sn=(serial.stdout if serial else '').strip()
 ok=bool(state and state.returncode==0 and 'device' in state.stdout and model and model.returncode==0 and m==EXPECTED_MODEL and serial and serial.returncode==0 and sn==EXPECTED_SERIAL and pkg and pkg.returncode==0 and 'package:' in pkg.stdout)
 return ok,{'connect_rc':None if conn is None else conn.returncode,'state_rc':None if state is None else state.returncode,'model':m,'serial':sn,'package_rc':None if pkg is None else pkg.returncode}
def usb_recover(prefix):
 if not any(t==EXPECTED_SERIAL and s=='device' for t,s,_ in adb_rows()):return {'present':False,'ok':False,'reason':'usb_not_present'}
 ok,ident=verify(EXPECTED_SERIAL)
 if not ok:return {'present':True,'ok':False,'reason':'usb_identity_failed','identity':ident}
 ipr=run(['adb','-s',EXPECTED_SERIAL,'shell','ip','-4','-o','addr','show','dev','wlan0'],5);txt=(ipr.stdout if ipr else '');m=re.search(r'\binet\s+((?:\d{1,3}\.){3}\d{1,3})/',txt);ip=m.group(1) if m else ''
 if not ip:
  rr=run(['adb','-s',EXPECTED_SERIAL,'shell','ip','route'],5);rt=(rr.stdout if rr else '');m=re.search(r'\bsrc\s+((?:\d{1,3}\.){3}\d{1,3})',rt);ip=m.group(1) if m else ''
 if not ip:return {'present':True,'ok':False,'reason':'usb_s5_has_no_wifi_ipv4','identity':ident}
 if prefix and not ip.startswith(prefix):return {'present':True,'ok':False,'reason':'usb_s5_not_on_current_lan','ip':ip,'prefix':prefix,'identity':ident}
 tcp=run(['adb','-s',EXPECTED_SERIAL,'tcpip','5555'],8);time.sleep(1.2);target=f'{ip}:5555';conn=run(['adb','connect',target],8);time.sleep(.4);net_ok,net_ident=verify(target)
 return {'present':True,'ok':bool(net_ok),'ip':ip,'target':target,'tcpip_rc':None if tcp is None else tcp.returncode,'connect_rc':None if conn is None else conn.returncode,'identity':net_ident,'source':'trusted_usb_to_network_adb'}
def atomic(o):
 STATE.parent.mkdir(parents=True,exist_ok=True);tmp=STATE.with_suffix('.tmp');tmp.write_text(json.dumps(o,indent=2,sort_keys=True)+'\n');os.replace(tmp,STATE)
def patch_unit(path,host,port):
 s=path.read_text();s2=re.sub(r'^Environment=S5_HOST=.*$',f'Environment=S5_HOST={host}',s,flags=re.M);s2=re.sub(r'^Environment=S5_PORT=.*$',f'Environment=S5_PORT={port}',s2,flags=re.M)
 if s2==s:return False
 t=path.with_suffix(path.suffix+'.tmp-s5');t.write_text(s2);os.replace(t,path);return True
def apply_target(target,result):
 host,ps=target.rsplit(':',1);port=int(ps);curh=env_value(UNIT,'S5_HOST');curp=int(env_value(UNIT,'S5_PORT') or 5555);result['verified']=target
 if host==curh and port==curp:result['status']='healthy';atomic(result);print('S5_REDISCOVER=HEALTHY target='+target);return 0
 stamp=time.strftime('%Y%m%d_%H%M%S');b=BACKUPS/f's5-autodiscover-repoint-{stamp}';b.mkdir(parents=True,exist_ok=False)
 for p in (UNIT,OC):(b/(p.name+'.before')).write_bytes(p.read_bytes())
 try:
  patch_unit(UNIT,host,port);patch_unit(OC,host,port);subprocess.run(['systemctl','--user','daemon-reload'],check=True,timeout=10);subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'],check=True,timeout=15);time.sleep(1)
  if subprocess.run(['systemctl','--user','is-active','--quiet','ht-e6500-surround.service']).returncode:raise RuntimeError('surround service failed after repoint')
 except Exception:
  UNIT.write_bytes((b/(UNIT.name+'.before')).read_bytes());OC.write_bytes((b/(OC.name+'.before')).read_bytes());subprocess.run(['systemctl','--user','daemon-reload']);subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service']);raise
 result.update(status='recovered',backup=str(b));atomic(result);print('S5_REDISCOVER=RECOVERED target='+target+' backup='+str(b));return 0
def main():
 pref=local_prefix();now=time.strftime('%Y-%m-%dT%H:%M:%S%z');curh=env_value(UNIT,'S5_HOST');curp=int(env_value(UNIT,'S5_PORT') or 5555);result={'timestamp':now,'current_host':curh,'current_port':curp,'prefix':pref,'status':'no_change','candidates':[],'version':'v117-network-adb-selfheal'}
 usb=usb_recover(pref);result['usb_recovery']=usb
 if usb.get('ok') and usb.get('target'):result['recovery_source']='trusted_usb_to_network_adb';return apply_target(usb['target'],result)
 if curh and pref and curh.startswith(pref) and open_port(curh,curp,.2):
  ok,meta=verify(f'{curh}:{curp}');result['configured_verify']=meta
  if ok:result.update(status='healthy',verified=f'{curh}:{curp}');atomic(result);print('S5_REDISCOVER=HEALTHY target='+f'{curh}:{curp}');return 0
 targets=set(t for t,s,_ in adb_rows() if s=='device' and ':' in t)
 r=run(['adb','mdns','services'],4)
 if r:
  for m in re.finditer(r'((?:\d{1,3}\.){3}\d{1,3}:\d+)',r.stdout):targets.add(m.group(1))
 if pref:
  ips=[pref+str(i) for i in range(2,255)]
  with concurrent.futures.ThreadPoolExecutor(max_workers=96) as ex:
   for ip,is_open in zip(ips,ex.map(lambda x:open_port(x,5555),ips)):
    if is_open:targets.add(ip+':5555')
 good=[]
 for target in sorted(targets):
  ok,meta=verify(target);result['candidates'].append({'target':target,'verified':ok,**meta})
  if ok:good.append(target)
  elif target!=f'{curh}:{curp}':run(['adb','disconnect',target],2)
 if len(good)!=1:result['status']='none' if not good else 'ambiguous';atomic(result);print('S5_REDISCOVER=NO_CHANGE verified='+str(len(good))+' candidates='+str(len(targets)));return 0
 result['recovery_source']='identity_verified_network_scan';return apply_target(good[0],result)
if __name__=='__main__':raise SystemExit(main())
'''
connect = r'''#!/usr/bin/env bash
set -euo pipefail
S5_HOST="${S5_HOST:-192.168.1.12}";S5_PORT="${S5_PORT:-5555}";ADB="${ADB:-adb}";EXPECTED_SERIAL="993e96d0";EXPECTED_MODEL="SM-G900F";PKG="com.bruis.s5irbridge";TARGET="${S5_HOST}:${S5_PORT}"
LOCAL_IP="$(ip -4 -o addr show dev wlp1s0 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}')"
if [ -n "$LOCAL_IP" ] && [ "${S5_HOST%.*}" != "${LOCAL_IP%.*}" ]; then exit 0; fi
"$ADB" start-server >/dev/null 2>&1 || true;timeout 5 "$ADB" connect "$TARGET" >/dev/null 2>&1 || true
state="$(timeout 4 "$ADB" -s "$TARGET" get-state 2>/dev/null || true)";[ "$state" = "device" ] || exit 0
model="$(timeout 4 "$ADB" -s "$TARGET" shell getprop ro.product.model 2>/dev/null | tr -d '\r')";serial="$(timeout 4 "$ADB" -s "$TARGET" shell getprop ro.serialno 2>/dev/null | tr -d '\r')";pkg="$(timeout 5 "$ADB" -s "$TARGET" shell pm path "$PKG" 2>/dev/null || true)"
if [ "$model" != "$EXPECTED_MODEL" ] || [ "$serial" != "$EXPECTED_SERIAL" ] || [[ "$pkg" != package:* ]]; then "$ADB" disconnect "$TARGET" >/dev/null 2>&1 || true;exit 0;fi
"$ADB" -s "$TARGET" shell settings put global adb_enabled 1 >/dev/null 2>&1 || true
"$ADB" -s "$TARGET" shell settings put global stay_on_while_plugged_in 0 >/dev/null 2>&1 || true
"$ADB" -s "$TARGET" shell settings put system screen_off_timeout 15000 >/dev/null 2>&1 || true
'''
REDISCOVER.write_text(rediscover,encoding="utf-8");CONNECT.write_text(connect,encoding="utf-8");REDISCOVER.chmod(0o755);CONNECT.chmod(0o755)
subprocess.run(["python3","-m","py_compile",str(REDISCOVER)],check=True,timeout=20);subprocess.run(["bash","-n",str(CONNECT)],check=True,timeout=20);subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20);subprocess.run(["systemctl","--user","restart","c720p-s5-rediscover.timer"],check=True,timeout=20)
probe=subprocess.run([str(REDISCOVER)],text=True,capture_output=True,timeout=45)
print("BACKUP="+str(BACK));print("REDISCOVER_RC="+str(probe.returncode));print("REDISCOVER_OUT="+(probe.stdout or "").strip().replace("\n"," | ")[:4000]);print("REDISCOVER_ERR="+(probe.stderr or "").strip().replace("\n"," | ")[:2000]);print("RESULT=S5_NETWORK_ADB_SELFHEAL_V117_APPLIED")
