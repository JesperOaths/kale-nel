#!/usr/bin/env python3
"""Extend native S9 SD security groups; never lose non-person motion recordings."""
from pathlib import Path
import datetime,shutil
p=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
raw=p.read_text()
old="const buckets=[['one_person','One person detected'],['multiple_people','Multiple people detected'],['unreviewed','Unreviewed or older recordings']];"
new="""const buckets=[['one_person','One person detected'],['multiple_people','Multiple people detected'],
      ['vehicle','Vehicles without confirmed people'],['animal','Animals without confirmed people'],
      ['motion_other','Other motion / no confirmed person'],['unreviewed','Unreviewed or older recordings']];"""
oldselect="const selected=recordings.filter(r=>(r.scene_category||'unreviewed')===bucket).slice(0,80);"
newselect="""const selected=recordings.filter(r=>{
        const g=r.scene_category||'unreviewed';
        const tags=Array.isArray(r.content_categories)?r.content_categories:[];
        if(bucket==='vehicle')return g==='motion_other'&&tags.includes('vehicle');
        if(bucket==='animal')return g==='motion_other'&&!tags.includes('vehicle')&&tags.includes('animal');
        if(bucket==='motion_other')return g==='motion_other'&&!tags.includes('vehicle')&&!tags.includes('animal');
        if(bucket==='unreviewed')return !['one_person','multiple_people','motion_other'].includes(g);
        return g===bucket;
      }).slice(0,80);"""
oldmeta="b.textContent=rec.timestamp+(rec.person_count?' · '+rec.person_count+' person(s) detected':'');"
newmeta="""const tags=Array.isArray(rec.content_categories)?rec.content_categories.filter(t=>['person','vehicle','animal','other_motion'].includes(t)):[];
      b.textContent=rec.timestamp+(rec.resolution==='3840x2160'?' · 4K':'')+
        (rec.person_count?' · '+rec.person_count+' person(s) detected':'')+
        (tags.length?' · '+tags.join(' + '):'');"""
if old in raw and oldselect in raw and oldmeta in raw:
 updated=raw.replace(old,new,1).replace(oldselect,newselect,1).replace(oldmeta,newmeta,1)
 backup=p.with_name(p.name+".before-native-groups-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
 shutil.copy2(p,backup)
 part=p.with_suffix(".html.groups-tmp")
 part.write_text(updated)
 part.chmod(p.stat().st_mode&0o777)
 part.replace(p)
 print("NATIVE_GROUPS_OK","BACKUP",backup)
elif new in raw and newselect in raw:
 print("NATIVE_GROUPS_ALREADY_PRESENT")
else:raise SystemExit("Missing expected S9 UI anchor: left original unchanged")
