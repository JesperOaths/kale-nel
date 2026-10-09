#!/usr/bin/env python3
"""Restore trusted Galaxy S5 network ADB over IPv6, without altering Wi-Fi credentials.

Uses S5's MAC-stable IPv6 address on the same /64 as the C720P.
Checks model/serial on the network *before* changing live surround service.
Backs up scripts/units; restarts only surround service; verifies live API.
"""
from pathlib import Path
import datetime,ipaddress,json,os,re,shutil,socket,subprocess,sys,time,urllib.request
BASE=Path('/home/jespern/c720p-home-hub')
SERVER=BASE/'bin/ht-e6500-surround-server.py'
RECONNECT=BASE/'bin/openclaw-s5-adb-connect.sh'
UNIT=Path('/home/jespern/.config/systemd/user/ht-e6500-surround.service')
OC=Path('/home/jespern/.config/systemd/user/openclaw-s5-adb-connect.service')
HOST='[fd00::1:7a4b:87ff:fe80:eee0]'
TARGET=HOST+':5555'
EXPECTED_MODEL='SM-G900F';EXPECTED_SERIAL='993e96d0'
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=Path('/home/jespern/c720p-backups')/('s5-ipv6-adb-restoration-'+STAMP)
def run(c,timeout=20):
 return subprocess.run(c,text=True,capture_output=True,timeout=timeout)
def adb(*args,t=12):
 return run(['adb',*args],t)
def verify():
 c=adb('connect',TARGET,t=10)
 if c.returncode!=0:raise RuntimeError('ADB IPv6 connection failed: '+c.stdout+' '+c.stderr)
 model=adb('-s',TARGET,'shell','getprop','ro.product.model').stdout.strip()
 serial=adb('-s',TARGET,'shell','getprop','ro.serialno').stdout.strip()
 pkg=adb('-s',TARGET,'shell','pm','path','com.bruis.s5irbridge')
 if (model,serial)!=(EXPECTED_MODEL,EXPECTED_SERIAL) or 'package:' not in pkg.stdout:
  raise RuntimeError('S5 IPv6 identity or IR package mismatch; refuse misrouting')
 return {'model':model,'serial':serial,'bridge_installed':True}
# Check same prefix and transport, not only an assumed address string.
iface=run(['ip','-6','-o','addr','show','dev','wlp1s0'],t:=8)
assert iface.returncode==0
ipv6=ipaddress.ip_address(HOST.strip('[]'))
assert any(ipv6 in ipaddress.ip_interface(k.split('/')[0]+'/'+k.split('/')[1]).network for k in re.findall(r'[0-9a-fA-F:]+/64',iface.stdout))
who=verify()
src=SERVER.read_text()
rec=RECONNECT.read_text()
unit=UNIT.read_text(); oc=OC.read_text()
if 'C720P_S5_IPV6_LAN_SUPPORT_V120' not in src:
 old='''def host_on_current_lan(host):
    try:
        _start, _end, acer_ip = lan_scan_range()
'''
 new='''def host_on_current_lan(host):
    # C720P_S5_IPV6_LAN_SUPPORT_V120: IPv4 DHCP subnets may differ despite
    # identical Wi-Fi SSID/BSSID; trusted S5 IPv6 can share the C720P's /64.
    try:
        candidate = ipaddress.ip_address(str(host).strip("[]"))
        if candidate.version == 6:
            local = run(["ip", "-6", "-o", "addr", "show", "dev", HT_E6500_IFACE], timeout=4)
            for item in (local.get("stdout") or "").split():
                if "/" in item and ":" in item:
                    try:
                        net = ipaddress.ip_interface(item).network
                        if net.prefixlen == 64 and candidate in net:
                            return True
                    except ValueError:
                        pass
            return False
    except ValueError:
        pass
    try:
        _start, _end, acer_ip = lan_scan_range()
'''
 assert src.count(old)==1, 'LAN guard anchor changed'
 src=src.replace(old,new,1)
 old='''with socket.create_connection((str(host), int(port)), timeout=timeout):'''
 new='''with socket.create_connection((str(host).strip("[]"), int(port)), timeout=timeout):'''
 assert src.count(old)==1
 src=src.replace(old,new,1)
# Fix ip neigh lookup on bracketed v6 display
src=src.replace('run(["ip", "neigh", "show", str(S5_HOST)], timeout=2)',
                'run(["ip", "-6", "neigh", "show", str(S5_HOST).strip("[]")], timeout=2) if str(S5_HOST).startswith("[") else run(["ip", "neigh", "show", str(S5_HOST)], timeout=2)')
# Avoid IPv4-only cutoff on IPv6 target; literal fixed grep for brackets.
if 'C720P_S5_IPV6_RECONNECT_V120' not in rec:
 a='''if [ -n "$LOCAL_IP" ] && [ "${S5_HOST%.*}" != "${LOCAL_IP%.*}" ]; then'''
 b='''# C720P_S5_IPV6_RECONNECT_V120
if [[ "$S5_HOST" != \[* ]] && [ -n "$LOCAL_IP" ] && [ "${S5_HOST%.*}" != "${LOCAL_IP%.*}" ]; then'''
 assert rec.count(a)==1
 rec=rec.replace(a,b,1)
rec=rec.replace('grep -q "${S5_HOST}:${S5_PORT}"','grep -Fq -- "${S5_HOST}:${S5_PORT}"')
def set_host(u):
 patt=r'^Environment=S5_HOST=.*$'
 assert len(re.findall(patt,u,re.M))==1,'Unit host anchor missing'
 return re.sub(patt,'Environment=S5_HOST='+HOST,u,flags=re.M)
unit=set_host(unit);oc=set_host(oc)
assert src.count('C720P_S5_IPV6_LAN_SUPPORT_V120')==1
assert 'C720P_S5_IPV6_RECONNECT_V120' in rec
assert 'Environment=S5_HOST='+HOST in unit
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'identity':who,'target':TARGET,
 'server_ipv6_guard':True,'reconnector_ipv6':True,'restore_usb_unchanged':True}))
 sys.exit(0)
BACK.mkdir(parents=True,exist_ok=False)
files={SERVER:src,RECONNECT:rec,UNIT:unit,OC:oc}
for p in files:shutil.copy2(p,BACK/(p.name+'.before'))
try:
 for p,txt in files.items():
  m=p.stat().st_mode
  p.write_text(txt);p.chmod(m)
 check=run(['python3','-m','py_compile',str(SERVER)],timeout=12)
 if check.returncode:raise RuntimeError(check.stderr)
 sh=run(['bash','-n',str(RECONNECT)],timeout=8)
 if sh.returncode:raise RuntimeError(sh.stderr)
 run(['systemctl','--user','daemon-reload'],timeout=12)
 restart=run(['systemctl','--user','restart','ht-e6500-surround.service'],timeout=25)
 if restart.returncode:raise RuntimeError(restart.stderr)
 time.sleep(1.3)
 with urllib.request.urlopen('http://127.0.0.1:8789/health',timeout=15) as resp:
  h=json.load(resp)
 if h.get('s5_transport')!='adb_network' or not h.get('s5_connected'):
  raise RuntimeError('Live S5 IPv6 network transport not verified: '+str({k:h.get(k) for k in ('s5_transport','s5_connected','configured_target')}))
 assert h.get('configured_target')==TARGET, h.get('configured_target')
 print(json.dumps({'ok':True,'identity':who,'target':TARGET,
  's5_connected':h['s5_connected'],'s5_transport':h['s5_transport'],
  'reconnector_ready':True,'backup':str(BACK)},indent=2))
except BaseException:
 for p in files:shutil.copy2(BACK/(p.name+'.before'),p)
 run(['systemctl','--user','daemon-reload'],timeout=12)
 run(['systemctl','--user','restart','ht-e6500-surround.service'],timeout=25)
 raise
