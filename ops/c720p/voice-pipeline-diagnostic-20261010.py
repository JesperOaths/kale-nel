#!/usr/bin/env python3
"""Read-only C720P Assist diagnostic. No restarts, deletions, or credentials."""
import json, shutil, socket, subprocess, time
from pathlib import Path

def command(*args, timeout=12):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return {"exit":p.returncode,"output":(p.stdout+p.stderr)[-9000:]}
    except Exception as e: return {"error":str(e)}

def port(p):
    try:
        s=socket.create_connection(("127.0.0.1",p),timeout=1); s.close(); return True
    except OSError:return False

def disk(path):
    u=shutil.disk_usage(path)
    return {"free_mb":round(u.free/1048576,1),"used_pct":round(u.used/u.total*100,1)}

def main():
    result={"timestamp":time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "ports":{str(p):port(p) for p in [8123,10200,10300,10400,10701,8790]},
            "disk":disk("/")}
    for service in ["c720p-openwakeword-v53e.service","c720p-heygoogle-onnx-wake.service","c720p-wyoming-satellite.service"]:
        result[service]=command("systemctl","--user","show",service,"--property=ActiveState,SubState,ExecMainStatus,NRestarts")
        result[service+"_journal"]=command("journalctl","--user","-u",service,"-n","70","--no-pager","--output=short-iso")
    result["docker"]=command("docker","ps","--format","{{.Names}} {{.Status}}")
    result["ha_errors"]=command("docker","logs","--tail","180","homeassistant")
    # Logs can contain personal speech; retain locally and do not upload by default.
    out=Path.home()/"c720p-voice-diagnostic.json"
    out.write_text(json.dumps(result,indent=2),encoding="utf-8")
    out.chmod(0o600)
    print("Saved local private diagnostic:",out)
    print("Ports:",result["ports"],"Disk:",result["disk"])
    print("Review local journal/HA errors for 'intent-not-supported', audio capture, satellite timeouts, STT or TTS failures.")
if __name__=="__main__":main()
