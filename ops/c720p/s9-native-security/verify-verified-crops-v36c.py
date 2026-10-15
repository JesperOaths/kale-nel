"""Read-only production acceptance checks. Never export camera images."""
import hashlib,json,sys,urllib.request,urllib.error
from pathlib import Path
sys.path.insert(0,'/home/jespern/c720p-home-hub/bin')
import s9_visual_review_v36 as v
def get(port,path):
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+path,timeout=20) as r:return json.load(r)
archive=get(8794,'/new/api/archive-review?source=sd')
reports=[get(port,'/new/api/visual-review?limit=200&presence=all') for port in (8794,8795)]
assert reports[0]['total']==reports[1]['total']==28
assert reports[0]['eligible_clips']==reports[1]['eligible_clips']==9
assert {x['observation'] for x in reports[0]['items']}=={x['observation'] for x in reports[1]['items']}
for item in reports[0]['items']:
 decision=archive['clips'][item['clip']]
 assert decision['label'] in ('person','people') and item['presence']=='pending'
assert reports[0]['folders']==[] and reports[0]['revision']==0
health=get(8794,'/new/api/live-person-watch')
assert health['ok'] and health['camera_mode'] in ('watching','recording')
assert health['detector_version']=='person_spatiotemporal_transport_v9'
assert health['camera_sensor']['fps']>25
source=v.index()['items'];accepted=set(x['clip'] for x in reports[0]['items'])
excluded=next(meta['tracks'][0]['full_crop']['name'] for name,meta in source.items() if name not in accepted and meta['tracks'])
try:v.crop_bytes(excluded)
except FileNotFoundError:pass
else:raise AssertionError('unverified_crop_access_allowed')
crop=reports[0]['items'][0]['full_crop'];raw=v.crop_bytes(crop['name'])
assert hashlib.sha256(raw).hexdigest()==crop['sha256']
try:
 urllib.request.urlopen('http://192.168.178.141:8794/new/api/visual-review',timeout=10)
except urllib.error.HTTPError as e:assert e.code==401
else:raise AssertionError('anonymous_catalog_allowed')
for path,code in (('/new/api/visual-review?presence=identity',400),('/new/api/visual-review/crop/'+excluded,404)):
 try:urllib.request.urlopen('http://127.0.0.1:8794'+path,timeout=10)
 except urllib.error.HTTPError as e:assert e.code==code
 else:raise AssertionError('invalid_request_accepted')
with urllib.request.urlopen('http://127.0.0.1:8123/local/frontyard-security-new/security-people-v33.html?v=verified-crops-v36c-20261015',timeout=10) as r:html=r.read().decode()
assert 'visual-review-v36.js?v=36c' in html and 'selection-bar' in html
receipt=Path('/home/jespern/c720p-home-hub/state/s9-visual-attributes-v36/verified-crops-v36c-release.json')
data=json.loads(receipt.read_text());data['acceptance']={'both_catalog_services':True,'verified_clips':9,'candidate_crops':28,'anonymous_401':True,'invalid_filter_400':True,'unverified_crop_404':True,'private_native_crop_integrity':True,'labels_and_folders_unchanged':True,'ha_assets_refreshed':True}
receipt.write_text(json.dumps(data,indent=2))
print(json.dumps(data['acceptance']))
