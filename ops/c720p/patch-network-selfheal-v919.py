#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess,os

HOME=Path('/home/jespern')
BASE=HOME/'c720p-home-hub'
DNS=BASE/'bin/c720p-dns-watchdog.sh'
AGENT=BASE/'bin/c720p-agent-self-watchdog.sh'
UNITDIR=HOME/'.config/systemd/user'
STAMP=time.strftime('%Y%m%d_%H%M%S')
BACK=HOME/'c720p-backups'/f'v919-network-selfheal-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)
for p in (DNS,AGENT,UNITDIR/'c720p-dns-watchdog.timer',UNITDIR/'c720p-agent-self-watchdog.timer',UNITDIR/'c720p-no-suspend.service'):
    if p.exists():
        shutil.copy2(p,BACK/(p.name+'.before'))

DNS.write_text(r'''#!/usr/bin/env bash
set -u
IFACE='wlp1s0'
PROFILES=('COVID VACCIN 5G' 'COVID VACCIN' 'Noordbruis')
LOG='/home/jespern/c720p-home-hub/logs/dns-watchdog.log'
ENDPOINT='/home/jespern/.config/c720p-agent/endpoint'
CONTROL_HOST=$(python3 - "$ENDPOINT" <<'PY2'
from pathlib import Path
from urllib.parse import urlsplit
import sys
try:
    s=Path(sys.argv[1]).read_text().strip()
    print(urlsplit(s).hostname or 'uiqntazgnrxwliaidkmy.supabase.co')
except Exception:
    print('uiqntazgnrxwliaidkmy.supabase.co')
PY2
)
SECONDARY='www.googleapis.com'
log(){ printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
resolve4(){ timeout 4 getent ahostsv4 "$1" >/dev/null 2>&1; }
gateway_ok(){ timeout 2 ping -c1 -W1 192.168.178.1 >/dev/null 2>&1; }
active_conn(){ timeout 5 nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null | awk -F: -v i="$IFACE" '$2==i{print $1;exit}'; }

control=0; secondary=0
resolve4 "$CONTROL_HOST" && control=1
resolve4 "$SECONDARY" && secondary=1
if [ "$control" -eq 1 ] && [ "$secondary" -eq 1 ] && gateway_ok; then
  log "NETWORK=HEALTHY control=$CONTROL_HOST secondary=$SECONDARY connection=$(active_conn || true)"
  exit 0
fi

timeout 5 nmcli radio wifi on >/dev/null 2>&1 || true
con="$(active_conn || true)"
if [ -z "$con" ] || ! gateway_ok; then
  log "NETWORK=DEGRADED active=${con:-none} action=multi_profile_reconnect"
  for p in "${PROFILES[@]}"; do
    timeout 5 nmcli -t -f NAME connection show 2>/dev/null | grep -Fxq "$p" || continue
    timeout 8 nmcli connection modify "$p" connection.autoconnect yes connection.autoconnect-retries 0 802-11-wireless.powersave 2 >/dev/null 2>&1 || true
    timeout 28 nmcli connection up "$p" ifname "$IFACE" >/dev/null 2>&1 || true
    sleep 3
    con="$(active_conn || true)"
    if [ -n "$con" ] && gateway_ok; then
      log "WIFI=RECOVERED profile=$con"
      break
    fi
  done
fi

con="$(active_conn || true)"
if [ -n "$con" ]; then
  timeout 8 nmcli connection modify "$con" ipv4.ignore-auto-dns yes ipv4.dns '1.1.1.1,8.8.8.8,192.168.178.1' >/dev/null 2>&1 || true
  timeout 8 nmcli device reapply "$IFACE" >/dev/null 2>&1 || true
fi
timeout 5 resolvectl flush-caches >/dev/null 2>&1 || true
sleep 2

control2=0; secondary2=0; gw=0
resolve4 "$CONTROL_HOST" && control2=1
resolve4 "$SECONDARY" && secondary2=1
gateway_ok && gw=1
if [ "$gw" -eq 1 ] && [ "$control2" -eq 1 ]; then
  log "NETWORK=RECOVERED control=$control2 secondary=$secondary2 gateway=$gw connection=${con:-none}"
  systemctl --user start c720p-security-tunnel-watchdog.service >/dev/null 2>&1 || true
else
  log "NETWORK=STILL_DEGRADED control=$control2 secondary=$secondary2 gateway=$gw connection=${con:-none}"
fi
exit 0
''')
DNS.chmod(0o755)

AGENT.write_text(r'''#!/usr/bin/env bash
set -u
HB=/home/jespern/.cache/c720p-agent/runner-heartbeat
LOG=/home/jespern/c720p-home-hub/logs/agent-self-watchdog.log
DNS=/home/jespern/c720p-home-hub/bin/c720p-dns-watchdog.sh
now=$(date +%s); age=999999
if [ -s "$HB" ]; then
  t=$(cat "$HB" 2>/dev/null || echo 0)
  age=$(python3 - "$now" "$t" <<'PY2'
import sys
try: print(max(0,int(float(sys.argv[1])-float(sys.argv[2]))))
except Exception: print(999999)
PY2
)
fi
state=$(systemctl --user is-active c720p-agent-runner.service 2>/dev/null || true)
busy=0
pgrep -af '/home/jespern/.cache/c720p-agent/jobs/[0-9]+\.sh' >/dev/null 2>&1 && busy=1
log(){ printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

if [ "$state" != active ] || [ "$age" -gt 90 ]; then
  log "AGENT_SELF_WATCHDOG=RECOVER state=$state heartbeat_age=${age}s busy=$busy"
  timeout 70 "$DNS" >/dev/null 2>&1 || true
  systemctl --user restart c720p-agent-runner.service >/dev/null 2>&1 || true
  sleep 3
  systemctl --user start c720p-security-tunnel-watchdog.service >/dev/null 2>&1 || true
else
  log "AGENT_SELF_WATCHDOG=HEALTHY heartbeat_age=${age}s busy=$busy"
fi
exit 0
''')
AGENT.chmod(0o755)

(UNITDIR/'c720p-dns-watchdog.timer').write_text('''[Unit]\nDescription=Check C720P WLAN/DNS health every 30 seconds\n[Timer]\nOnBootSec=20s\nOnUnitActiveSec=30s\nAccuracySec=2s\nPersistent=true\n[Install]\nWantedBy=timers.target\n''')
(UNITDIR/'c720p-agent-self-watchdog.timer').write_text('''[Unit]\nDescription=Check C720P outbound agent liveness every 30 seconds\n[Timer]\nOnBootSec=25s\nOnUnitActiveSec=30s\nAccuracySec=2s\nPersistent=true\n[Install]\nWantedBy=timers.target\n''')

# C720P_NO_SUSPEND_V919
(UNITDIR/'c720p-no-suspend.service').write_text('''[Unit]\nDescription=Keep dedicated C720P hub awake\nAfter=graphical-session.target\n\n[Service]\nType=simple\nExecStart=/usr/bin/systemd-inhibit --what=sleep:idle:handle-lid-switch --who=C720P-Hub --why=Dedicated Home Assistant hub must remain online --mode=block /usr/bin/sleep infinity\nRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n''')

subprocess.run(['bash','-n',str(DNS)],check=True)
subprocess.run(['bash','-n',str(AGENT)],check=True)
subprocess.run(['systemctl','--user','daemon-reload'],check=True)
subprocess.run(['systemctl','--user','enable','--now','c720p-dns-watchdog.timer','c720p-agent-self-watchdog.timer','c720p-no-suspend.service'],check=False)
subprocess.run([str(DNS)],timeout=80,check=False)
subprocess.run(['systemctl','--user','start','c720p-security-tunnel-watchdog.service'],check=False)
if os.environ.get('C720P_V919_DEFER_AGENT_RESTART') != '1':
    subprocess.run([
        'systemd-run','--user','--unit',f'c720p-agent-refresh-v919-{STAMP}',
        '--on-active=20s','/usr/bin/systemctl','--user','restart','c720p-agent-runner.service'
    ],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
else:
    print('V919_AGENT_RESTART=DEFERRED_TO_ACTIVE_JOB')

print('BACKUP='+str(BACK))
print('RESULT=V919_NETWORK_SELFHEAL_PATCHED')
