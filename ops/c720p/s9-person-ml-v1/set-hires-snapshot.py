#!/usr/bin/env python3
import json,urllib.request,time,shutil,datetime,pathlib,sys
c=pathlib.Path('/home/jespern/c720p-security-camera-new/frontyard-security-config.json')
def get(path):
 with urllib.request.urlopen('http://127.0.0.1:8793/'+path,timeout=9) as r:return json.load(r)
def put(key,val):
 b=json.dumps({'key':key,'value':val}).encode()
 req=urllib.request.Request('http://127.0.0.1:8793/camera-control',data=b,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=14) as r:return json.load(r)
old=get('camera-controls')['controls'];photo=old['photo_size']['value'];quality=old['quality']['value']
ml=get('health.json')
assert ml.get('camera_ok'), 'camera offline'
if photo=='960x540':
 print('ALREADY_960',photo);sys.exit(0)
assert photo=='320x240','unexpected initial settings'
backup=c.with_name(c.name+'.before-960-'+datetime.datetime.now().strftime('%Y%m%d%H%M%S'))
shutil.copy2(c,backup)
try:
 d=json.loads(c.read_text());d['camera_photo_size']='960x540';d['camera_quality']=65
 c.write_text(json.dumps(d,indent=2)+'\n')
 x=put('photo_size','960x540');y=put('quality','65')
 time.sleep(7)
 result=get('camera-controls')['controls']
 success=bool(x.get('ok') and y.get('ok') and result['photo_size']['value']=='960x540' and get('health.json').get('camera_ok'))
 print('PHOTO_UPGRADE',{'success':success,'previous':photo,'actual':result['photo_size']['value'],'quality':result['quality']['value']})
 if not success:raise ValueError('health or control mismatch')
except Exception:
 shutil.copy2(backup,c)
 try:put('photo_size',photo);put('quality',quality)
 except Exception:pass
 raise
