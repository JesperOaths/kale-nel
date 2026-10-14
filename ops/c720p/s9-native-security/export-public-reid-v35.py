"""Export only pinned PUBLIC weights; no camera images are accepted."""
import argparse,sys,pathlib,json,hashlib,importlib.util
parser=argparse.ArgumentParser();parser.add_argument('--work-dir',required=True,type=pathlib.Path);root=parser.parse_args().work_dir.resolve()
sys.path.insert(0,str(root/'osnet-export-runtime'));public=root/'public-reid-v35'
import torch,numpy as np,onnx,onnxruntime as ort
spec=importlib.util.spec_from_file_location('osnet_ain',public/'osnet_ain.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
pinned=json.loads(pathlib.Path(__file__).with_name('public-reid-models-v35.json').read_text())
for name in ('osnet_ain.py','osnet_ain.pth'):
 assert hashlib.sha256((public/name).read_bytes()).hexdigest()==pinned[name]['sha256'],'untrusted_public_input'
checkpoint=torch.load(public/'osnet_ain.pth',map_location='cpu',weights_only=True)
weights=checkpoint.get('state_dict',checkpoint);weights={k.removeprefix('module.'):v for k,v in weights.items()};classes=weights['classifier.weight'].shape[0]
model=m.osnet_ain_x1_0(num_classes=classes,pretrained=False);model.load_state_dict(weights,strict=True);model.eval();torch.set_num_threads(2)
torch.manual_seed(35);sample=torch.randn(1,3,256,128);out=public/'osnet-ain-msmt17.onnx'
torch.onnx.export(model,sample,str(out),opset_version=12,input_names=['images'],output_names=['embeddings'],dynamo=False)
onnx.checker.check_model(onnx.load(str(out)));session=ort.InferenceSession(str(out),providers=['CPUExecutionProvider']);errors=[];references={}
for index,tensor in enumerate((sample,torch.zeros_like(sample),torch.randn_like(sample)*.6+.2)):
 with torch.no_grad():expected=model(tensor).numpy()
 actual=session.run(None,{'images':tensor.numpy()})[0];assert actual.shape==(1,512) and np.isfinite(actual).all() and np.linalg.norm(actual)>0
 references['x'+str(index)]=tensor.numpy();references['y'+str(index)]=expected
 error=float(np.max(np.abs(actual-expected)));assert np.allclose(actual,expected,rtol=1e-3,atol=2e-4),error;errors.append(error)
np.savez(public/'synthetic-parity.npz',**references)
manifest=json.loads((public/'public-manifest.json').read_text());manifest[out.name]={'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'source_weight_sha256':manifest['osnet_ain.pth']['sha256'],'export_opset':12,'output_dimensions':512,'strict_checkpoint_load':True,'synthetic_parity_max_errors':errors};(public/'public-manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest[out.name]))
