#!/usr/bin/env python3
from pathlib import Path
import shutil, time

TARGET = Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
MARKER = "C720P_HTS_OFF_AUTHORITATIVE_POLL_V1054"
text = TARGET.read_text(encoding="utf-8")

if MARKER in text:
    print("RESULT=ALREADY_APPLIED")
    raise SystemExit(0)

old = '''  while(Date.now()<deadline){
    await sleep(750);
    const r=await reqBluetooth("/state","GET",1800);
    if(!r.ok||!r.data)continue;
    const connected=!!r.data.bluetooth_connected;
    const sink=!!r.data.audio_sink_present;
    const sinkDefault=!!r.data.audio_sink_default;
    if(target==="on"&&connected&&sink&&sinkDefault)return true;
    if(target==="off"&&!connected&&!sink)return true
  }
'''
new = '''  while(Date.now()<deadline){
    await sleep(750);
    if(target==="off"){
      // C720P_HTS_OFF_AUTHORITATIVE_POLL_V1054
      // Poll the receiver power endpoint so OFF reconciliation is actively
      // driven even while BlueZ/helper state is stale.
      const p=await req("/ht-e6500/power-state","GET",1800);
      const ps=p.ok&&p.data?String(p.data.state||"").toLowerCase():"unknown";
      if(ps==="off")return true
    }
    const r=await reqBluetooth("/state","GET",1800);
    if(!r.ok||!r.data)continue;
    const connected=!!r.data.bluetooth_connected;
    const sink=!!r.data.audio_sink_present;
    const sinkDefault=!!r.data.audio_sink_default;
    if(target==="on"&&connected&&sink&&sinkDefault)return true;
    if(target==="off"&&!connected&&!sink)return true
  }
'''
if old not in text:
    raise SystemExit("wait_for_hts_anchor_missing")

stamp=time.strftime("%Y%m%d_%H%M%S")
backup=Path("/home/jespern/c720p-backups")/f"v1054-hts-off-authoritative-poll-{stamp}"
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(TARGET,backup/(TARGET.name+".before"))
TARGET.write_text(text.replace(old,new,1),encoding="utf-8")

print("PATCH=APPLIED")
print("VERSION=v1054")
print("OFF_AUTHORITATIVE_POWER_POLL=1")
print("POWER_RETRY_ADDED=0")
print("BACKUP="+str(backup))
