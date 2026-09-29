#!/usr/bin/env python3
import socket,time,subprocess,pathlib,json,re
MAC="30:14:4a:14:77:ac"
BT="8C:C8:CD:8B:06:3B"
def sh(cmd,timeout=30,limit=18000):
    try:
        p=subprocess.run(["bash","-lc",cmd],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return f"RC={p.returncode}\n"+(p.stdout or "")[-limit:]
    except Exception as e:return "ERR="+repr(e)
print("=== BEFORE_NEIGH ===")
print(sh("ip neigh show; arp -an 2>/dev/null || true",8,10000))
print("=== HA_MATCHES ===")
print(sh("grep -Rni --exclude='*.log' --exclude='*.db*' -E '30:14:4a:14:77:ac|8C:C8:CD:8B:06:3B|HT-E6500|SamsungHTS|surround|receiver' /opt/homeassistant/config/.storage /opt/homeassistant/config/*.yaml 2>/dev/null | head -220",15,18000))
# Standard magic packet to both global and local directed broadcasts.
mac=bytes.fromhex(MAC.replace(":",""))
pkt=b"\xff"*6+mac*16
for dest in [("255.255.255.255",9),("255.255.255.255",7),("192.168.178.255",9),("192.168.178.255",7)]:
    try:
        s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1)
        for _ in range(5): s.sendto(pkt,dest);time.sleep(.08)
        s.close();print("WOL_SENT",dest)
    except Exception as e: print("WOL_ERR",dest,repr(e))
# Populate neighbor cache and observe for 20 seconds.
for n in range(1,6):
    print("=== PROBE",n,"===")
    print(sh("command -v nmap >/dev/null && nmap -sn -n 192.168.178.0/24 >/dev/null 2>&1 || true; ip neigh show | grep -i '30:14:4a:14:77:ac' || true; bluetoothctl info 8C:C8:CD:8B:06:3B 2>&1 | head -20",20,6000))
    time.sleep(2)
print("=== ARPSCAN ===")
print(sh("command -v arp-scan >/dev/null && sudo -n arp-scan --localnet 2>/dev/null | grep -i '30:14:4a:14:77:ac' || true",20,6000))
print("RESULT=HTS_WAKE_PATHS_PROBED")
