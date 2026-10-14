"""Fetch pinned PUBLIC assets into operator build space, never the camera archive."""
import argparse,urllib.request,json,hashlib,pathlib
parser=argparse.ArgumentParser();parser.add_argument('--work-dir',required=True,type=pathlib.Path);out=parser.parse_args().work_dir/'public-reid-v35';out.mkdir(parents=True,exist_ok=True)
pinned=json.loads(pathlib.Path(__file__).with_name('public-reid-models-v35.json').read_text())
rev='f8cd150fdf77e8d9e1ed143b7f308c2c609ded50';hf='a5c5cc037c24235cda3b21085b93ad77c9616224';zoo='47534e27c9851bb1128ccc0102f1145e27f23f98'
assets={'osnet_ain.py':f'https://raw.githubusercontent.com/KaiyangZhou/deep-person-reid/{rev}/torchreid/models/osnet_ain.py','LICENSE-osnet':f'https://raw.githubusercontent.com/KaiyangZhou/deep-person-reid/{rev}/LICENSE','osnet_ain.pth':f'https://huggingface.co/kaiyangzhou/osnet/resolve/{hf}/osnet_ain_x1_0_msmt17_256x128_amsgrad_ep50_lr0.0015_coslr_b64_fb10_softmax_labsmth_flip_jitter.pth','yolox.py':f'https://raw.githubusercontent.com/opencv/opencv_zoo/{zoo}/models/object_detection_yolox/yolox.py','demo.py':f'https://raw.githubusercontent.com/opencv/opencv_zoo/{zoo}/models/object_detection_yolox/demo.py','yolox.onnx':f'https://media.githubusercontent.com/media/opencv/opencv_zoo/{zoo}/models/object_detection_yolox/object_detection_yolox_2022nov.onnx','LICENSE-yolox':f'https://raw.githubusercontent.com/opencv/opencv_zoo/{zoo}/models/object_detection_yolox/LICENSE'}
manifest={}
for name,url in assets.items():
 blob=urllib.request.urlopen(url,timeout=120).read();assert hashlib.sha256(blob).hexdigest()==pinned[name]['sha256'],'public_download_digest_'+name;(out/name).write_bytes(blob);manifest[name]={'url':url,'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob)};print(name,len(blob),flush=True)
(out/'public-manifest.json').write_text(json.dumps(manifest,indent=2))
