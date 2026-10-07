from pathlib import Path
import datetime
import py_compile
import re
import shutil
import subprocess

BASE = Path("/home/jespern/c720p-home-hub")
REDISCOVER = BASE / "bin/c720p-s5-rediscover.py"
CONNECT = BASE / "bin/openclaw-s5-adb-connect.sh"
BACKUPS = Path("/home/jespern/c720p-backups")
MARKER = "C720P_S5_NETWORK_PERSISTENCE_V99"

stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup = BACKUPS / f"s5-network-persistence-v99-{stamp}"
backup.mkdir(parents=True, exist_ok=False)
for p in (REDISCOVER, CONNECT):
    shutil.copy2(p, backup / (p.name + ".before"))

# 1) Whenever the configured network ADB target is reachable, explicitly keep Wi-Fi
# awake during screen sleep. Keep the screen itself allowed to sleep.
s = CONNECT.read_text(encoding="utf-8")
if MARKER not in s:
    anchor = '"$ADB" -s "${S5_HOST}:${S5_PORT}" shell settings put global adb_enabled 1 >/dev/null 2>&1 || true\n'
    insert = anchor + (
        f'# {MARKER}\n'
        '"$ADB" -s "${S5_HOST}:${S5_PORT}" shell svc wifi enable >/dev/null 2>&1 || true\n'
        '"$ADB" -s "${S5_HOST}:${S5_PORT}" shell settings put global wifi_sleep_policy 2 >/dev/null 2>&1 || true\n'
    )
    if anchor not in s:
        raise SystemExit("connect helper anchor not found")
    s = s.replace(anchor, insert, 1)
    CONNECT.write_text(s, encoding="utf-8")

# 2) Make rediscovery identity-safe and apply the same network persistence settings
# as soon as the S5 is rediscovered at any DHCP address.
s = REDISCOVER.read_text(encoding="utf-8")
if MARKER not in s:
    const_anchor = "IFACE='wlp1s0'; PKG='com.bruis.s5irbridge'\n"
    const_insert = (
        const_anchor
        + "EXPECTED_MODEL='SM-G900F'; EXPECTED_SERIAL='993e96d0'\n"
        + f"# {MARKER}\n"
    )
    if const_anchor not in s:
        raise SystemExit("rediscovery constants anchor not found")
    s = s.replace(const_anchor, const_insert, 1)

    verify_pat = re.compile(
        r"def verify\(target\):\n"
        r" r=run\(\['adb','connect',target\],5\)\n"
        r" q=run\(\['adb','-s',target,'shell','pm','path',PKG\],5\)\n"
        r" ok=.*?\n"
        r" return ok,\{.*?\}\n",
        re.S,
    )
    verify_repl = """def verify(target):
 r=run(['adb','connect',target],5)
 q=run(['adb','-s',target,'shell','pm','path',PKG],5)
 m=run(['adb','-s',target,'shell','getprop','ro.product.model'],4)
 sn=run(['adb','-s',target,'shell','getprop','ro.serialno'],4)
 model=(m.stdout.strip() if m and m.returncode==0 else '')
 serial=(sn.stdout.strip() if sn and sn.returncode==0 else '')
 package_ok=bool(q and q.returncode==0 and 'package:' in q.stdout)
 ok=bool(package_ok and model==EXPECTED_MODEL and serial==EXPECTED_SERIAL)
 return ok,{'connect_rc':None if r is None else r.returncode,'package_rc':None if q is None else q.returncode,'model':model,'serial':serial,'identity_ok':ok}

def harden_network_bridge(target):
 steps=[]
 for cmd in (
  ['adb','-s',target,'shell','svc','wifi','enable'],
  ['adb','-s',target,'shell','settings','put','global','wifi_sleep_policy','2'],
 ):
  r=run(cmd,6)
  steps.append({'cmd':cmd[4:],'returncode':None if r is None else r.returncode})
 check=run(['adb','-s',target,'shell','settings','get','global','wifi_sleep_policy'],5)
 value='' if check is None else check.stdout.strip()
 return {'ok':bool(check and check.returncode==0 and value=='2'),'wifi_sleep_policy':value,'steps':steps}
"""
    s2, n = verify_pat.subn(verify_repl, s, count=1)
    if n != 1:
        raise SystemExit("rediscovery verify function anchor not found")
    s = s2

    s = s.replace(
        "result.update(status='healthy',verified=f'{curh}:{curp}',verify=meta);atomic_state(result);print('S5_REDISCOVER=HEALTHY target='+f'{curh}:{curp}');return 0",
        "target=f'{curh}:{curp}'; result.update(status='healthy',verified=target,verify=meta,harden=harden_network_bridge(target));atomic_state(result);print('S5_REDISCOVER=HEALTHY target='+target);return 0",
        1,
    )
    s = s.replace(
        "result.update(status='healthy',verified=target);atomic_state(result);print('S5_REDISCOVER=HEALTHY target='+target);return 0",
        "result.update(status='healthy',verified=target,harden=harden_network_bridge(target));atomic_state(result);print('S5_REDISCOVER=HEALTHY target='+target);return 0",
        1,
    )
    s = s.replace(
        "result.update(status='recovered',verified=target,backup=str(b));atomic_state(result);print('S5_REDISCOVER=RECOVERED target='+target+' backup='+str(b));return 0",
        "result.update(status='recovered',verified=target,backup=str(b),harden=harden_network_bridge(target));atomic_state(result);print('S5_REDISCOVER=RECOVERED target='+target+' backup='+str(b));return 0",
        1,
    )
    REDISCOVER.write_text(s, encoding="utf-8")

py_compile.compile(str(REDISCOVER), doraise=True)
subprocess.run(["bash", "-n", str(CONNECT)], check=True)

print("S5_NETWORK_PERSISTENCE_V99=OK")
print("BACKUP=" + str(backup))
print("REDISCOVER_MARKER=" + str(MARKER in REDISCOVER.read_text()))
print("CONNECT_MARKER=" + str(MARKER in CONNECT.read_text()))
