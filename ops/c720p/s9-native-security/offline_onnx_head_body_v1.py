#!/usr/bin/env python3
"""Offline neural visual descriptors from C720P SHA-bound local image artifacts.

Source: existing PyTorch-exported 512-D visual backbone, verified by SHA-256.
Uses the exact 128x256 RGB ImageNet preprocessing in appearance_review_v2.py.
Runs 512-D L2 head and 512-D L2 full-track body forward passes and concatenates
with equal squared weight into a unit 1024-D neural manual-triage descriptor.

S9 thumbnail and native tracking box need NOT be co-temporal: NEVER claim they
are a true face, original-video attestation, verified person or trained identity.
No ADB, phone, video playback, media writes, live API, or human decisions.
"""
from __future__ import annotations
import argparse,hashlib,json,math,os,subprocess,tempfile,sys,time
from pathlib import Path
import numpy as np
import onnxruntime as ort

BASE=Path('/home/jespern/c720p-home-hub')
TOOLS=BASE/'artifacts/offline-cranial-backfill-tool-v1-20261026'
sys.path.insert(0,str(TOOLS))
from offline_roi_fulltrack_fusion_v1 import assemble,read_bound
from offline_handcrafted_roi_512d_v1 import MODEL_ID as HANDCRAFTED_MODEL
MODEL=BASE/'state/folder-reference-v2/visual_backbone_512d.onnx'
MODEL_SHA='ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d'
OUT=BASE/'artifacts/offline-onnx-head-body-20261026'
RESULT=OUT/'neural-fused-1024d-v1.json'
TYPE='onnx_visual_backbone_512d_head_body_concat_1024d_v1'
MEAN=np.asarray([.485,.456,.406],dtype=np.float32).reshape(1,3,1,1)
STD=np.asarray([.229,.224,.225],dtype=np.float32).reshape(1,3,1,1)

def sha(v:bytes)->str:return hashlib.sha256(v).hexdigest()
def rgb(path:Path,rect=None):
    if rect is not None:
        if not (isinstance(rect,list) and len(rect)==4 and
                all(type(v) is int for v in rect)):raise ValueError('bad_source_box')
        x,y,w,h=rect
        if not (x>=0 and y>=0 and w>=16 and h>=24):raise ValueError('unsafe_source_box')
        filter=f'crop={w}:{h}:{x}:{y},scale=128:256:flags=area'
    else:filter='scale=128:256:flags=area'
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','1',
         '-i',str(path),'-vf',filter,'-pix_fmt','rgb24',
         '-f','rawvideo','-frames:v','1','pipe:1']
    proc=subprocess.run(cmd,capture_output=True,timeout=12,check=True)
    if len(proc.stdout)!=128*256*3:raise ValueError('ffmpeg_rgb_not_expected')
    return np.frombuffer(proc.stdout,dtype=np.uint8).reshape(256,128,3)
def preprocess(pixel):
    x=np.asarray(pixel,dtype=np.float32).transpose(2,0,1)[None]/255.0
    return np.ascontiguousarray((x-MEAN)/STD,dtype=np.float32)
def feature(sess,name,pixel):
    val=sess.run(None,{name:preprocess(pixel)})[0].reshape(-1)
    if val.shape!=(512,) or not np.isfinite(val).all():raise ValueError('onnx_model_vector_invalid')
    norm=float(np.linalg.norm(val.astype(np.float64)))
    if norm<1e-9 or not math.isfinite(norm):raise ValueError('onnx_vector_zero')
    return np.asarray(val/norm,dtype=np.float64)
def fused(head,body):
    v=np.concatenate((head,body))/math.sqrt(2.0)
    norm=float(np.linalg.norm(v))
    if v.shape!=(1024,) or not math.isclose(norm,1.,abs_tol=1e-5):
        raise ValueError('invalid_fusion')
    return (v/norm).tolist()
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--max-new',type=int,default=12)
    arg=parser.parse_args()
    if not 1<=arg.max_new<=24:raise ValueError('batch_limit')
    if not MODEL.is_file() or MODEL.is_symlink() or sha(MODEL.read_bytes())!=MODEL_SHA:
        raise ValueError('backbone_bytes_not_verified')
    if OUT.is_symlink():raise ValueError('output_symlink')
    OUT.mkdir(mode=0o700,parents=True,exist_ok=True)
    opts=ort.SessionOptions();opts.intra_op_num_threads=1;opts.inter_op_num_threads=1
    opts.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess=ort.InferenceSession(str(MODEL),sess_options=opts,providers=['CPUExecutionProvider'])
    inputs=sess.get_inputs()
    outputs=sess.get_outputs()
    if (len(inputs)!=1 or len(outputs)!=1 or inputs[0].shape!=[1,3,256,128]
        or outputs[0].shape!=[1,512] or inputs[0].type!='tensor(float)'):
        raise ValueError('unvalidated_network_contract')
    items,origins=assemble()
    if len(items)!=160:raise ValueError('incomplete_input_snapshot')
    origin_hash=sha(json.dumps(origins,sort_keys=True,separators=(',',':')).encode())
    prior=[]
    if RESULT.exists():
        if RESULT.is_symlink():raise ValueError('output_symlink')
        j=json.loads(RESULT.read_text())
        if (j['schema']!='offline_onnx_visual_fused_1024d_v1'
            or j['model_sha256']!=MODEL_SHA or j['source_origins_sha256']!=origin_hash):
            raise ValueError('input_revision_changed_abort')
        prior=j['rows']
    existing={(r['source'],r['clip_id'],r['head_sha256']):r for r in prior}
    if len(existing)!=len(prior):raise ValueError('duplicate_prior_vectors')
    drive=BASE/'artifacts/offline-cranial-body-crops-v1-20261026'
    sd=BASE/'artifacts/offline-s9-thumbnail-head-rois-v1-20261026'
    drive_rows=json.loads((drive/'manifest.json').read_text())['records']
    sd_rows=json.loads((sd/'manifest.json').read_text())['items']
    image_lookup={r['geometry']['derived_sha256']:drive/r['output_filename'] for r in drive_rows}
    image_lookup.update({r['derived_sha256']:sd/r['image'] for r in sd_rows})
    valid={}
    for row in items:
        name=(row['source'],row['clip_id'],row['head_sha256'])
        if name in valid:raise ValueError('duplicate_source')
        valid[name]=row
    if not set(existing)<=set(valid):raise ValueError('stale_row_detected')
    new=0;errors={}
    for key,row in valid.items():
        if key in existing:
            old=existing[key]
            if (old.get('body_sha256')!=row['body_sha256']
                or len(old.get('neural_fused',[]))!=1024
                or not math.isclose(float(np.linalg.norm(old['neural_fused'])),1.,abs_tol=1e-7)):
                raise ValueError('cached_vector_invalid')
            continue
        if new>=arg.max_new:break
        try:
            hp=image_lookup[row['head_sha256']]
            read_bound(hp,row['head_sha256'],2_000_000)
            bp=Path(row['body_file'])
            read_bound(bp,row['body_sha256'])
            head=feature(sess,inputs[0].name,rgb(hp))
            body=feature(sess,inputs[0].name,rgb(bp,row.get('body_rect')))
            both=fused(head,body)
            existing[key]={'source':row['source'],'clip_id':row['clip_id'],
                'original_index_sha256':row['original_index_sha256'],
                'head_sha256':row['head_sha256'],'body_sha256':row['body_sha256'],
                'head_neural_512d':head.tolist(),'body_neural_512d':body.tolist(),
                'neural_fused':both,'model_id':TYPE,'model_sha256':MODEL_SHA,
                'preprocessing':'rgb_128x256_imagenet_norm_v1',
                'identity_verified':False,'same_frame_verified':False,
                'review_evidence':False}
            new+=1
        except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError) as error:
            n=type(error).__name__+':'+str(error)[:75]
            errors[n]=errors.get(n,0)+1
    result={'schema':'offline_onnx_visual_fused_1024d_v1','model_id':TYPE,
      'model_sha256':MODEL_SHA,'model_training_provenance_verified':False,
      'source_origins_sha256':origin_hash,'source_manifest_hashes':origins,
      'count':len(existing),'eligible':len(items),'complete':len(existing)==len(items),
      'neural_feature_dimension':512,'fusion_dimension':1024,
      'identity_matching':False,'same_keyframe_verified':False,
      'live_scoring_enabled':False,'review_attestation_changed':False,
      'rows':[existing[k] for k in valid if k in existing],'errors_this_batch':errors}
    with tempfile.NamedTemporaryFile('w',dir=OUT,prefix='.neural-',delete=False) as f:
        temp=Path(f.name);json.dump(result,f,allow_nan=False,separators=(',',':'))
        f.flush();os.fsync(f.fileno())
    try:temp.chmod(0o600);temp.replace(RESULT)
    finally:
        if temp.exists():temp.unlink()
    print(json.dumps({'neural_count':len(existing),'eligible':len(items),
       'new':new,'complete':result['complete'],'errors_this_batch':errors,
       'result_sha256':sha(RESULT.read_bytes())}))
if __name__=='__main__':main()

