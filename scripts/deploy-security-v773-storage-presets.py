#!/usr/bin/env python3
from pathlib import Path

# Patch current v772 Security source in-place for v773 deployment.
wp=Path('cloudflare/workers/admin-gate/src/worker.js')
w=wp.read_text()
old="const ADMIN_BUILD = 'v772-security-direct-origin-controls';"
new="const ADMIN_BUILD = 'v773-security-storage-presets';"
if old not in w:
    raise SystemExit('v772 build marker missing')
w=w.replace(old,new,1)
wp.write_text(w)

p=Path('security/index.html')
s=p.read_text()
# Make the existing status row able to hold storage telemetry cleanly.
s=s.replace('.live-meta{display:flex;justify-content:space-between;gap:16px;', '.live-meta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;', 1)
old='<div class="live-meta"><span>New IP camera</span><span id="newLast">Last motion: —</span></div>'
new='<div class="live-meta"><span>New IP camera</span><span id="newLast">Last motion: —</span><span id="newStorage">Storage: —</span></div>'
if old not in s: raise SystemExit('new live meta marker missing')
s=s.replace(old,new,1)
old='<div class="live-meta"><span>Existing S3 camera</span><span id="s3Last">Last motion: —</span></div>'
new='<div class="live-meta"><span>Existing S3 camera</span><span id="s3Last">Last motion: —</span><span id="s3Storage">Storage: —</span></div>'
if old not in s: raise SystemExit('s3 live meta marker missing')
s=s.replace(old,new,1)
old="const controlNames={torch:'Torch',flashmode:'Flash mode'"
new="const controlNames={preset:'Preset',profile_mode:'Auto profile',torch:'Torch',flashmode:'Flash mode'"
if old not in s: raise SystemExit('control names marker missing')
s=s.replace(old,new,1)
old="  function applySourceStatus(camera,data){"
new="  function storageText(data){const used=Number(data?.archive_used_mb),quota=Number(data?.archive_quota_mb),pct=Number(data?.archive_usage_percent),free=Number(data?.disk_free_mb),mins=Number(data?.estimated_minutes_remaining),hours=Number(data?.retention_unsaved_hours);const a=Number.isFinite(used)&&Number.isFinite(quota)?`${used.toFixed(1)}/${quota.toFixed(0)} MB${Number.isFinite(pct)?` (${pct.toFixed(0)}%)`:''}`:'—';const b=Number.isFinite(mins)?` · ~${mins.toFixed(0)} min capacity`:'';const c=Number.isFinite(free)?` · disk ${(free/1024).toFixed(2)} GB free`:'';const d=Number.isFinite(hours)?` · unsaved ${hours}h`:'';return `Storage: ${a}${b}${c}${d}`}\n  function applySourceStatus(camera,data){"
if old not in s: raise SystemExit('applySourceStatus marker missing')
s=s.replace(old,new,1)
old="$('newLast').textContent=`Last motion: ${n.last_event_at||'—'}`;$('s3Last').textContent=`Last motion: ${s.last_event_at||'—'}`;"
new="$('newLast').textContent=`Last motion: ${n.last_event_at||'—'}`;$('s3Last').textContent=`Last motion: ${s.last_event_at||'—'}`;$('newStorage').textContent=storageText(n);$('s3Storage').textContent=storageText(s);"
if old not in s: raise SystemExit('refresh storage marker missing')
s=s.replace(old,new,1)
p.write_text(s)
