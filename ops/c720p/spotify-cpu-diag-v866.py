#!/usr/bin/env python3
from __future__ import annotations
import os, pathlib, subprocess, time

def run(args, timeout=12):
    try:
        p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout,check=False)
        return p.stdout.strip()
    except Exception as e:
        return f"ERR {type(e).__name__}: {e}"

print("===SYSTEM===")
print(time.strftime("%Y-%m-%dT%H:%M:%S%z"))
print(run(["uname","-a"]))
print("NPROC="+str(os.cpu_count() or 0))
try: print("LOAD="+pathlib.Path("/proc/loadavg").read_text().strip())
except Exception as e: print("LOAD_ERR="+repr(e))

print("===CPUFREQ===")
for cpu in sorted(pathlib.Path("/sys/devices/system/cpu").glob("cpu[0-9]*")):
    f=cpu/"cpufreq"
    if not f.is_dir(): continue
    vals={}
    for name in ("scaling_governor","scaling_min_freq","scaling_max_freq","scaling_cur_freq"):
        try: vals[name]=(f/name).read_text().strip()
        except Exception: vals[name]="?"
    print(cpu.name+" "+ " ".join(f"{k}={v}" for k,v in vals.items()))

print("===THERMAL===")
for z in sorted(pathlib.Path("/sys/class/thermal").glob("thermal_zone*")):
    try: print(z.name, (z/"type").read_text().strip(), (z/"temp").read_text().strip())
    except Exception: pass

print("===MEMORY===")
print(run(["free","-m"]))
print(run(["swapon","--show"]))

print("===TOPCPU===")
print(run(["bash","-lc","ps -eo pid,ppid,ni,pri,pcpu,pmem,rss,comm,args --sort=-pcpu | head -35"]))
print("===TOPRSS===")
print(run(["bash","-lc","ps -eo pid,ppid,ni,pri,pcpu,pmem,rss,comm,args --sort=-rss | head -25"]))

print("===BROWSERS===")
print(run(["bash","-lc","ps -eo pid,ppid,ni,pcpu,pmem,args | grep -Ei '[c]hromium|[f]irefox|open.spotify.com' | head -60"]))
print("===USER_UNITS===")
print(run(["bash","-lc","systemctl --user --no-pager --type=service --state=running | head -80"]))
print("===USER_TIMERS===")
print(run(["bash","-lc","systemctl --user --no-pager list-timers --all | head -100"]))
print("===AUDIO===")
print(run(["bash","-lc","pactl info 2>/dev/null | grep -E 'Server Name|Default Sink|Default Source' || true; pactl list short sinks 2>/dev/null || true"]))
print("===DISK===")
print(run(["df","-h","/"]))
print("RESULT=CPU_SPOTIFY_DIAG_DONE")
