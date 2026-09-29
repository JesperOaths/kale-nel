#!/usr/bin/env python3
import subprocess,socket,urllib.request,time,json

IFACE="wlp1s0"; ALIAS="192.168.1.254/24"; HOST="192.168.1.15"
def sh(cmd,timeout=20,limit=12000):
    try:
        p=subprocess.run(["bash","-lc",cmd],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return f"RC={p.returncode}\n"+(p.stdout or "")[-limit:]
    except Exception as e:return "ERR="+repr(e)
added=False
try:
    print("=== ROUTE_BEFORE ===")
    print(sh("ip -4 addr show dev wlp1s0; ip -4 route"))
    add=subprocess.run(["sudo","-n","ip","addr","add",ALIAS,"dev",IFACE],text=True,capture_output=True)
    if add.returncode==0: added=True
    elif "File exists" in (add.stderr or ""): added=False
    print("ALIAS_ADD_RC",add.returncode,(add.stderr or "").strip())
    time.sleep(1)
    print("=== PING ===")
    print(sh(f"ping -c 3 -W 1 {HOST} || true",8))
    print("=== ARP ===")
    print(sh(f"ip neigh show {HOST} || true; arp -an | grep '{HOST}' || true",5))
    print("=== TCP_PORTS ===")
    ports=[80,443,55000,56001,7676,8000,8001,8080,9000]
    for port in ports:
        s=socket.socket();s.settimeout(1)
        try:
            s.connect((HOST,port));print("OPEN",port)
        except Exception as e: print("CLOSED",port,type(e).__name__)
        finally:s.close()
    print("=== DMR ===")
    for path in ["/smp_14_","/","/description.xml","/dmr.xml"]:
        try:
            with urllib.request.urlopen(f"http://{HOST}:7676{path}",timeout=3) as r:
                body=r.read(10000).decode("utf-8","replace")
                print("HTTP",path,r.status,body[:9000])
        except Exception as e: print("HTTPERR",path,repr(e))
finally:
    if added:
        subprocess.run(["sudo","-n","ip","addr","del",ALIAS,"dev",IFACE],text=True,capture_output=True)
    print("ALIAS_REMOVED",added)
print("RESULT=OLD_SUBNET_PROBED")
