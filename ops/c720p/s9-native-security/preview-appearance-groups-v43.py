"""Preview aggregate grouping on an isolated metadata/SQLite copy on C720P. No media export."""
import json,shutil,sqlite3,sys,tempfile
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path.insert(0,str(BASE/'bin'));sys.path.insert(0,str(Path(sys.argv[1])))
import s9_visual_review_v36 as v
original=v.ROOT
with tempfile.TemporaryDirectory(dir='/tmp',prefix='appearance-preview-v43-') as raw:
 scratch=Path(raw)
 with sqlite3.connect('file:'+str(original/'review.sqlite3')+'?mode=ro',uri=True) as c,sqlite3.connect(scratch/'review.sqlite3') as d:c.backup(d)
 shutil.copy2(original/'catalog.json',scratch/'catalog.json');v.ROOT=scratch
 v.atomic(scratch/'appearance-groups-v43-enabled.json',{'enabled':True})
 report=v.report({'workflow':['clip_folders_v40'],'limit':['100']})
 automatic=[f for f in report['folders'] if f['automatic_appearance_group']]
 print(json.dumps({'preview_only':True,'automatic_groups':len(automatic),'group_sizes':[f['suggested_clips'] for f in automatic],'automatic_approved_clips':sum(f['approved_clips'] for f in automatic),'manual_folders':len(report['folders'])-len(automatic),'verified_clips':report['coverage']['verified_clips']}))
