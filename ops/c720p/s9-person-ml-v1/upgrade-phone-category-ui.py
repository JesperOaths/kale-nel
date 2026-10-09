#!/usr/bin/env python3
from pathlib import Path
import shutil,datetime
p=Path('/opt/homeassistant/config/www/frontyard-security-new/clips.html')
s=p.read_text()
if 's9-phone-section' not in s: raise RuntimeError('S9 phone clips extension missing')
if 's9-phone-category-v1' in s: print('ALREADY_CATEGORIZED'); raise SystemExit(0)
start="    for(const rec of recordings.slice(0,80)){"
end="      section.append(btn);\n    }\n    root.append(section);"
assert start in s and end in s,'UI source changed'
s=s.replace(start, """    // Categories never imply an identified person across separate recordings.
    const buckets=[['one_person','One person detected'],['multiple_people','Multiple people detected'],['unreviewed','Unreviewed or older recordings']];
    for(const [bucket,label] of buckets){
      const selected=recordings.filter(r=>(r.scene_category||'unreviewed')===bucket).slice(0,80);
      if(!selected.length)continue;
      const sub=document.createElement('div');sub.className='s9phone-meta';
      sub.style.cssText='font-size:12px;font-weight:900;color:#9ee8ff;margin:10px 2px 7px';
      sub.textContent=label+' · '+selected.length;
      section.append(sub);
      for(const rec of selected){""",1)
s=s.replace(end,"      section.append(btn);\n      }\n    }\n    root.append(section);",1)
s=s.replace("      const b=document.createElement('div');b.className='meta';b.textContent=rec.timestamp;",
"""      const b=document.createElement('div');b.className='meta';
      b.textContent=rec.timestamp+(rec.person_count?' · '+rec.person_count+' person(s) detected':'');""",1)
s=s.replace('s9-phone-section', 's9-phone-section',1)
backup=p.with_name('clips.html.before-scene-categories-'+datetime.datetime.now().strftime('%Y%m%d%H%M%S'))
shutil.copy2(p,backup);p.write_text(s)
print('s9-phone-category-v1',len(s),str(backup))
