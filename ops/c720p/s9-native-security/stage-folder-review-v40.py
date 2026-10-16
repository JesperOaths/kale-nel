"""Package current folder workbench sources into a fresh, hashed stage."""
from pathlib import Path
import hashlib,json,shutil,sys
HERE=Path(__file__).resolve().parent
FILES=('s9_visual_review_v36.py','s9_folder_review_v40.py','people-folders-v40.html','people-folders-v40.js',
 'visual-review-entry-v36.js','security-hub-v30.html','security-hub-v30.js','test-visual-review-v36.py',
 'test-folder-review-v40.py','backup-folder-review-v40.py','deploy-folder-review-v40.py','repair-folder-route-v40.py',
 'refresh-security-entry-v40.py','refresh-security-entry-v40a.py','finish-folder-ui-v40.py',
 'finish-folder-feedback-v40.py','verify-folder-review-v40.py')
def main(stage):
 stage.mkdir(parents=True,exist_ok=False)
 for name in FILES:shutil.copy2(HERE/name,stage/name)
 manifest={name:hashlib.sha256((stage/name).read_bytes()).hexdigest() for name in FILES}
 (stage/'manifest.json').write_text(json.dumps(manifest,indent=2))
 print(json.dumps({'stage':str(stage),'files':len(manifest)}))
if __name__=='__main__':main(Path(sys.argv[1]))
