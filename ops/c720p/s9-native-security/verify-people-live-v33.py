"""Read-only live provenance, private image, playback and camera checks."""
import json,urllib.request,urllib.error
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');STATE=BASE/'state/s9-verified-people-v33'
def get(path,port=8794):
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+path,timeout=30) as response:return json.load(response)
def main():
 data=get('/new/api/verified-people');approval=json.loads((STATE/'approval.json').read_text());approved={c['source']+':'+c['name']:c for c in approval['clips']};current={}
 for source in ('sd','drive'):
  report=get('/new/api/archive-review?source='+source);assert report['matching_started'];current.update({source+':'+c['name']:c for c in report['clips'].values() if c['label'] in ('person','people')})
 items=[t for f in data['folders'] for t in f['items']]
 assert all(t['clip_key'] in approved and t['clip_key'] in current and approved[t['clip_key']]['revision']==current[t['clip_key']]['revision'] for t in items)
 def keys(value):
  if isinstance(value,dict):return set(value).union(*(keys(item) for item in value.values()))
  if isinstance(value,list):return set().union(*(keys(item) for item in value))
  return set()
 assert not keys(data).intersection({'face_vectors','body_vectors','colour','original_sha256','motion_samples','trajectory','frame_size','human_clip_label'})
 try:urllib.request.urlopen('http://192.168.178.141:8794/new/api/verified-people',timeout=10);raise ValueError('anonymous_api_exposed')
 except urllib.error.HTTPError as error:assert error.code==401;error.close()
 images=[name for t in items for name in ([t.get('body_image')] if t.get('body_image') else [])+(t.get('face_images') or [])]
 checked=0
 for name in images[:1]+[n for t in items for n in (t.get('face_images') or [])][:1]:
  with urllib.request.urlopen('http://127.0.0.1:8794/new/api/verified-people/image/'+name,timeout=15) as response:blob=response.read(600001);assert blob.startswith(b'\xff\xd8') and blob.endswith(b'\xff\xd9') and len(blob)<=600000;checked+=1
 played=None
 if items:
  item=items[0];path=('/new/drive/saved/clip/' if item['source']=='drive' else '/new/saved/clip/')+item['name'];request=urllib.request.Request('http://127.0.0.1:8794'+path,method='HEAD')
  with urllib.request.urlopen(request,timeout=30) as response:assert response.status==200 and int(response.headers['Content-Length'])==approved[item['clip_key']]['bytes'];played=True
  request=urllib.request.Request('http://127.0.0.1:8794'+path,headers={'Range':'bytes=0-31'})
  with urllib.request.urlopen(request,timeout=45) as response:blob=response.read(33);assert response.status==206 and len(blob)==32 and b'ftyp' in blob
 camera=get('/status',18808);assert camera['mode'] in ('watching','recording')
 print(json.dumps({'phase':data['status'].get('phase'),'approved':data['approved_clips'],'processed':data['processed_clips'],'folders':len(data['folders']),'metrics':data['metrics'],'unmeasured_clips':len(data['unmeasured']),'private_images_checked':checked,'original_head_and_range_verified':played,'anonymous_request_status':401,'camera_mode':camera['mode'],'camera_temperature_c':camera.get('temperature_c')},sort_keys=True))
if __name__=='__main__':main()
