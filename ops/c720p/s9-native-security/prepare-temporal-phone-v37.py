"""Build V37 narrowly on the pinned v11 recorder through the verified V36 patch."""
import importlib.util,json,hashlib,shutil,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
def prepare(stage,*,current=False):
 if not current and 'native_4k_dense_' in (HERE/'src/nl/kalenel/s9security/ClipReviewSchedule.java').read_text(encoding='utf-8'):
  raise ValueError('current_sources_require_prepare_detection_phone_v39')
 spec=importlib.util.spec_from_file_location('v36',HERE/'prepare-visual-phone-v36.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
 base.prepare(stage,temporal=True);src=stage/'src/nl/kalenel/s9security'
 for name in ('ClipReviewSchedule','VisualReviewQueue'):
  shutil.copy2(HERE/'src/nl/kalenel/s9security'/f'{name}.java',src/f'{name}.java')
 camera=src/'CameraService.java';text=camera.read_text(encoding='utf-8')
 text=base.replace_once(text,'File[] clips=folder.listFiles((d,n)->n.matches("motion_[0-9]{13}[.]mp4"));if(clips==null)return;',
                        'File[] clips=VisualReviewQueue.clips(folder);')
 text=base.replace_once(text,'if(new File(folder,clip.getName()+".visual-v36.json").isFile()||',
                        'if(VisualReviewQueue.completed(clip)||')
 text=base.replace_once(text,'VisualAttributeReview.process(clip,classifier,()->visualReviewSafe());',
                        'VisualAttributeReview.process(clip,classifier,()->visualReviewSafe()&&VisualReviewQueue.permits(clip));')
 text=base.replace_once(text,'   d.put("visual_review_version",VisualAttributeReview.VERSION);',
  '   d.put("visual_review_version",VisualAttributeReview.VERSION);\n   d.put("visual_review_sampling_version",ClipReviewSchedule.VERSION);\n   d.put("visual_review_queue_version",VisualReviewQueue.VERSION);')
 camera.write_text(text,encoding='utf-8')
 proof={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in src.glob('*.java')}
 (stage/'source-sha256.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
 print(json.dumps({'source_files':len(proof),'recorder_helpers_unchanged':True,'identity_matching':False}))
if __name__=='__main__':prepare(Path(sys.argv[1]))
