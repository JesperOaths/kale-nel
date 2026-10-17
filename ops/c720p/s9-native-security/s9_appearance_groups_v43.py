"""Persistent provisional clothing-colour groups. No identity features or automatic approvals."""
import contextlib,hashlib

def schema(c):
 c.executescript('''CREATE TABLE IF NOT EXISTS appearance_groups_v43(
 folder TEXT PRIMARY KEY REFERENCES folders(id),created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS appearance_candidates_v43(
 folder TEXT NOT NULL REFERENCES folders(id),clip TEXT NOT NULL,source_sha256 TEXT NOT NULL,
 snapshot TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(clip,source_sha256));''')

def compatible(a,b,backend):
 # Compare clothing HSV only. Complete-link membership prevents a chain of
 # marginally similar colours from bridging two different colour cohorts.
 distances=[backend.bhattacharyya(a[key],b[key]) for key in ('upper_hsv32','lower_hsv32')]
 return max(distances)<=.30 and sum(distances)/2<=.20

def sync(b,items,ledger,skips,scope,catalog):
 from s9_folder_review_v40 import eligible_snapshot,group_clips,snapshot
 occupied={(r['clip'],r['source_sha256']) for r in ledger if r['decision']=='approved'}
 excluded={(r['clip'],r['source_sha256']) for r in skips if r['item']}
 rejected={(r['folder'],r['clip'],r['source_sha256']) for r in ledger if r['decision']=='rejected'}
 confirmed={(r['folder'],r['clip'],r['source_sha256']):r for r in ledger if r['decision']=='approved'}
 candidates=group_clips([i for i in items if (i['clip'],i['source_sha256']) not in occupied|excluded],[],b)
 candidates.sort(key=lambda i:(i['recorded_ms'],i['clip']))
 # Bounded metadata work on the hub; no image decoding or camera inference.
 with contextlib.closing(b.db()) as c:
  schema(c);c.execute('BEGIN IMMEDIATE');changed=False
  existing=[dict(r) for r in c.execute('SELECT * FROM appearance_candidates_v43')]
  seen={(r['clip'],r['source_sha256']) for r in existing};groups={r['folder']:[] for r in c.execute('SELECT folder FROM appearance_groups_v43 ORDER BY created,folder')}
  for r in existing:
   if (r['folder'],r['clip'],r['source_sha256']) in rejected:continue
   anchor=eligible_snapshot(confirmed.get((r['folder'],r['clip'],r['source_sha256']),r)['snapshot'],b,scope,catalog)
   if anchor:groups[r['folder']].append(anchor)
  for item in [i for i in candidates if (i['clip'],i['source_sha256']) not in seen][:256]:
   key=(item['clip'],item['source_sha256'])
   if key in seen:continue
   matches=[(sum(sum(b.bhattacharyya(item[k],a[k]) for k in ('upper_hsv32','lower_hsv32'))/2 for a in anchors)/len(anchors),folder)
       for folder,anchors in groups.items() if anchors and all(compatible(item,a,b) for a in anchors)]
   if matches:folder=min(matches)[1]
   else:
    folder='P'+hashlib.sha256(('clothing-v43|'+item['clip']+'|'+item['source_sha256']).encode()).hexdigest()[:20];label='Appearance #'+str(len(groups)+1)
    c.execute('INSERT INTO folders VALUES(?,?,?,?)',(folder,label,'Provisional clothing-colour group. Review every clip before keeping it.',b.now()))
    c.execute('INSERT INTO appearance_groups_v43 VALUES(?,?)',(folder,b.now()));groups[folder]=[]
   c.execute('INSERT INTO appearance_candidates_v43 VALUES(?,?,?,?,?)',(folder,item['clip'],item['source_sha256'],snapshot(item),b.now()))
   groups[folder].append(item);seen.add(key);changed=True
  if changed:c.execute('UPDATE revision SET value=value+1')
  c.commit()
 return changed

def read(b):
 with contextlib.closing(b.db()) as c:
  schema(c)
  return {r['folder'] for r in c.execute('SELECT folder FROM appearance_groups_v43')},[dict(r) for r in c.execute('SELECT * FROM appearance_candidates_v43')],c.execute('SELECT value FROM revision').fetchone()[0]
