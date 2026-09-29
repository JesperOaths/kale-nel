#!/usr/bin/env python3
import socket,time,subprocess
mac='30:14:4a:14:77:ac'
raw=bytes.fromhex(mac.replace(':',''))
pkt=b'\xff'*6+raw*16
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1)
for addr in ('255.255.255.255','192.168.178.255'):
    for _ in range(3):
        try: s.sendto(pkt,(addr,9))
        except Exception as e: print('SENDERR',addr,repr(e))
        time.sleep(.15)
print('WOL_SENT',mac)
for i in range(1,31):
    arp=subprocess.run(['ip','neigh'],text=True,capture_output=True).stdout
    hits=[x for x in arp.splitlines() if mac.lower() in x.lower()]
    if hits:
        print('FOUND',i,hits)
        break
    time.sleep(.7)
else:
    print('FOUND_NONE')
print(subprocess.run(['ip','neigh'],text=True,capture_output=True).stdout[-5000:])
