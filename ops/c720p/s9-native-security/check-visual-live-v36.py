"""Print aggregate health/provenance only; no media, histograms or private notes."""
import json,sys,urllib.request
from pathlib import Path
sys.path.insert(0,'/home/jespern/c720p-home-hub/bin')
def get(path):
 with urllib.request.urlopen(path,timeout=20) as response:return json.load(response)
s=get('http://127.0.0.1:18808/status')
print(json.dumps({'camera':{k:s.get(k) for k in ('mode','temperature_c','sensor_result_fps','continuous_4k_ready','continuous_4k_dropped_output_frames','motion_detector','person_post_motion_hold_ms','visual_review_completed','visual_review_errors','visual_review_busy','visual_review_last_error')}}))
root=Path('/home/jespern/c720p-home-hub/state/s9-visual-attributes-v36/catalog.json')
if root.exists():
 d=json.loads(root.read_text());items=list(d.get('items',{}).values())
 print(json.dumps({'indexed_original_4k_clips':len(items),'tracks':sum(len(i['tracks']) for i in items),'crops':sum(len(i['tracks'])*2 for i in items),'native_frames':sum(i['decoded_native_frames'] for i in items),'hardware_decoders':sorted({i['decoder'] for i in items}),'identity_matching':any(i['identity_matching'] for i in items)}))
