#!/usr/bin/env python3
"""Append a read-only System status panel to the current Security hub.

Pure source transform; no network, camera, report generation or deployment.
The original hub remains an exact byte prefix. The caller owns fresh-source
hash checks, cache versioning, private backups and guarded deployment.
"""
import argparse
import hashlib
import json
from pathlib import Path

VERSION = "security_component_health_ui_v1"
FILES = ("security-hub-v30.js",)
MARKER = "// SECURITY_COMPONENT_HEALTH_UI_V1"
ANCHORS = (
    "/* SECURITY_HUB_V30: unified navigation and camera controls. */",
    "const paneFor=id=>$(id==='camera'?'panel-controls':'panel-'+id);",
    "function show(id){if(!tabs.some(t=>t[0]===id))return;current=id;",
    "show('live');refreshHealth();setInterval(refreshHealth,15000);",
)

SCRIPT = r'''// SECURITY_COMPONENT_HEALTH_UI_V1: independent metadata reports, never capture readiness.
(()=>{'use strict';
 const live=document.getElementById('panel-live'),controls=document.getElementById('panel-controls');
 const liveHost=live?.querySelector('.live-below'),controlHost=controls?.querySelector('.controls');
 if(!liveHost||!controlHost||document.getElementById('security-component-health-live'))return;
 const create=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const panels=[];
 for(const [name,host]of [['live',liveHost],['controls',controlHost]]){
  const panel=create('section');panel.id='security-component-health-'+name;
  panel.setAttribute('aria-label','System status');
  panel.style.cssText='grid-column:1/-1;min-width:0;margin-top:16px;padding:14px;border:1px solid #3d5d6d;border-radius:12px;background:#122733;color:#eef8ff;overflow-wrap:anywhere';
  const title=create('h2','System status');title.style.cssText='font-size:17px;margin:0 0 8px';
  const summary=create('p','Checking independent system reports…');summary.setAttribute('role','status');
  const rows=create('dl');rows.style.cssText='display:grid;grid-template-columns:minmax(100px,auto) 1fr;gap:7px 14px;font-size:12px;line-height:1.5';
  const note=create('p','Read-only reports. Capture status is shown separately. Appearance and pose observations do not confirm a person’s identity.');note.style.cssText='font-size:12px;color:#b4cbd4;margin:10px 0 0';
  panel.append(title,summary,rows,note);host.append(panel);panels.push({summary,rows});
 }
 const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
 const count=x=>nonnegative(x)&&Number.isSafeInteger(x)?x:null;
 const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
 const boolean=x=>typeof x==='boolean'?x:null;
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const fields={
  infrastructure:{counts:['root_available_bytes','root_total_bytes','original_digest_matches','original_digest_mismatches','originals_indexed'],numbers:['external_clock_minus_hub_seconds'],booleans:['ntp_synchronized','original_integrity_coverage_complete']},
  evidence:{counts:['recordings_indexed','tracked_observations','observations_with_colour','observations_with_direction','observations_with_measured_posture','observations_with_measured_gait_cadence','face_supported_candidates','unassigned_appearances'],numbers:[],booleans:[]},
  saved_timing:{counts:['paired_recordings'],numbers:[],booleans:['reported_complete','joint_same_recording_required','full_frame_decode_verified']}
 };
 function contract(data){
  if(!object(data)||data.ok!==true||data.schema_version!=='security_component_health_v1'||!object(data.components)||typeof data.observed_at_utc!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(data.observed_at_utc)||!Number.isFinite(Date.parse(data.observed_at_utc)))return null;
  const result={};
  for(const [key,types]of Object.entries(fields)){
   const raw=data.components[key];if(!object(raw)||!['current','stale','unavailable'].includes(raw.status)||!(raw.age_seconds===null||nonnegative(raw.age_seconds)))return null;
   const row={status:raw.status,age_seconds:raw.age_seconds};
   for(const [kind,names]of Object.entries(types))for(const name of names){
    const value=raw[name],parsed=kind==='counts'?count(value):kind==='numbers'?number(value):boolean(value);
    if(value!==undefined&&value!==null&&parsed===null)return null;
    row[name]=parsed;
   }
   result[key]=row;
  }
  return result;
 }
 const known=x=>x===null?'Not reported':String(x);
 const yes=x=>x===true?'Yes':x===false?'No':'Not reported';
 const age=x=>x===null?'age unknown':x<60?Math.floor(x)+' seconds old':x<3600?Math.floor(x/60)+' minutes old':Math.floor(x/3600)+' hours old';
 const report=row=>({current:'Current',stale:'Stale',unavailable:'Unavailable'})[row.status]+' · '+age(row.age_seconds);
 const bytes=x=>x===null?'Not reported':x<1073741824?(x/1048576).toFixed(0)+' MiB':(x/1073741824).toFixed(1)+' GiB';
 function render(data){
  const rows=[];let summary='System reports unavailable';
  if(data){
   const i=data.infrastructure,e=data.evidence,t=data.saved_timing;
   const low=i.root_available_bytes!==null&&i.root_total_bytes!==null&&i.root_total_bytes>0&&(i.root_available_bytes<2147483648||i.root_available_bytes/i.root_total_bytes<0.10);
   const mismatch=i.original_digest_mismatches!==null&&i.original_digest_mismatches>0;
   const warnings=[];if(low)warnings.push('Storage space is low');if(i.ntp_synchronized===false)warnings.push('Clock is not synchronized');if(i.external_clock_minus_hub_seconds!==null&&Math.abs(i.external_clock_minus_hub_seconds)>30)warnings.push('Clock offset exceeds 30 seconds');if(mismatch)warnings.push('Original integrity mismatch requires review');
   if(t.reported_complete===false||t.joint_same_recording_required===false)warnings.push('Saved timing checks require review');
   if(Object.values(data).some(x=>x.status!=='current'))warnings.push('Some reports are stale or unavailable');
   summary=warnings.length?warnings.join(' · '):'Independent reports loaded';
   rows.push(['Infrastructure report',report(i)],['Storage',bytes(i.root_available_bytes)+' free of '+bytes(i.root_total_bytes)],
    ['Clock','Synchronized: '+yes(i.ntp_synchronized)+' · External clock offset: '+(i.external_clock_minus_hub_seconds===null?'Not reported':i.external_clock_minus_hub_seconds.toFixed(1)+' seconds')],
    ['Original integrity','Digest matches: '+known(i.original_digest_matches)+' · Mismatches: '+known(i.original_digest_mismatches)+' · Hash coverage complete: '+yes(i.original_integrity_coverage_complete)+' · Originals indexed: '+known(i.originals_indexed)],
    ['Evidence report',report(e)],['Observation coverage','Recordings: '+known(e.recordings_indexed)+' · Tracked observations: '+known(e.tracked_observations)+' · Colour: '+known(e.observations_with_colour)+' · Direction: '+known(e.observations_with_direction)],
    ['Pose coverage','Measured posture: '+known(e.observations_with_measured_posture)+' · Measured gait cadence: '+known(e.observations_with_measured_gait_cadence)],
    ['Review coverage','Supported face candidates: '+known(e.face_supported_candidates)+' · Unassigned appearances: '+known(e.unassigned_appearances)],
    ['Saved timing report',report(t)],['Saved timing checks','Reported complete: '+yes(t.reported_complete)+' · Paired recordings: '+known(t.paired_recordings)+' · Same-recording pairing required: '+yes(t.joint_same_recording_required)+' · Full-frame decoding verified: '+yes(t.full_frame_decode_verified)]);
  }else rows.push(['Reports','Unavailable · no current system report could be read']);
  for(const panel of panels){panel.summary.textContent=summary;panel.rows.replaceChildren();for(const [label,value]of rows)panel.rows.append(create('dt',label),create('dd',value));}
 }
 let busy=false,ended=false,lastAttempt=null;
 const visible=()=>!ended&&!document.hidden&&(!live.hidden||!controls.hidden);
 async function refresh(){
  const now=performance.now();if(!visible()||busy||(lastAttempt!==null&&now-lastAttempt<60000))return;
  const relay=window.C720PSecureRelay;if(typeof relay?.fetch!=='function')return;
  busy=true;lastAttempt=now;const controller=new AbortController();let timeout;
  try{
   const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('report_timeout'));},10000);});
   const read=async()=>{
    const response=await relay.fetch('/new/api/security-component-health',{cache:'no-store',signal:controller.signal});
    if(!response?.ok)throw Error('report_unavailable');
    const data=contract(await response.json());if(!data)throw Error('report_contract');return data;
   };
   const data=await Promise.race([read(),deadline]);
   if(!ended)render(data);
  }catch(_){if(!ended)render(null);}
  finally{clearTimeout(timeout);busy=false;}
 }
 const observer=new MutationObserver(refresh);observer.observe(live,{attributes:true,attributeFilter:['hidden']});observer.observe(controls,{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('visibilitychange',refresh);
 let timer=setInterval(refresh,15000);
 window.addEventListener('pagehide',()=>{ended=true;clearInterval(timer);timer=null;observer.disconnect();});
 window.addEventListener('pageshow',()=>{ended=false;observer.observe(live,{attributes:true,attributeFilter:['hidden']});observer.observe(controls,{attributes:true,attributeFilter:['hidden']});if(timer===null)timer=setInterval(refresh,15000);refresh();});
 refresh();
})();'''


def patch_asset(name, text):
    if name not in FILES:
        raise ValueError("unsupported_health_ui_asset")
    newline = "\r\n" if "\r\n" in text else "\n"
    normalized = text.replace("\r\n", "\n")
    for anchor in ANCHORS:
        if normalized.count(anchor) != 1:
            raise ValueError("unexpected_health_ui_hub_anchor")
    suffix = ("\n" + SCRIPT + "\n").replace("\n", newline)
    if MARKER in text:
        if text.count(MARKER) != 1 or not text.endswith(suffix):
            raise ValueError("partial_or_foreign_health_ui")
        return text
    return text + suffix


def stage(source_root, output_dir=None):
    source_root = Path(source_root).resolve(strict=True)
    output_dir = Path(output_dir).resolve() if output_dir is not None else None
    if output_dir is not None and (output_dir == source_root or output_dir in source_root.parents or source_root in output_dir.parents):
        raise ValueError("output_must_be_separate_from_source")
    prepared, result = {}, {"version": VERSION, "files": {}}
    for name in FILES:
        source = source_root / name
        if source.is_symlink() or not source.is_file():
            raise ValueError("invalid_source_asset")
        before = source.read_bytes()
        after = patch_asset(name, before.decode("utf-8")).encode("utf-8")
        prepared[name] = after
        result["files"][name] = {"before_sha256": hashlib.sha256(before).hexdigest(), "after_sha256": hashlib.sha256(after).hexdigest(), "changed": before != after}
    if output_dir is not None:
        for name in (*FILES, "component-health-ui-manifest.json"):
            if (output_dir / name).exists():
                raise ValueError("stage_output_already_exists")
        output_dir.mkdir(parents=True, exist_ok=True)
        for name, content in prepared.items():
            with (output_dir / name).open("xb") as target:
                target.write(content)
        with (output_dir / "component-health-ui-manifest.json").open("x", encoding="utf-8") as target:
            json.dump(result, target, indent=2)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    print(json.dumps(stage(args.source_root, args.output_dir), indent=2))
