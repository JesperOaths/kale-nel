"""V39: retain smaller people and inspect all regions even after finding one."""
import importlib.util,json,hashlib,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
def prepare(stage):
 spec=importlib.util.spec_from_file_location('v38',HERE/'prepare-detection-phone-v38.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base);base.prepare(stage,current=True)
 src=stage/'src/nl/kalenel/s9security';p=src/'ClipClassifier.java';t=p.read_text()
 t=base.once(t,'     if(!wholeFramePerson){','     { // Inspect all garden regions even when one person is already detected.')
 t=base.once(t,'  final int tileWidth=(int)(width*.65f);','  final int tileWidth=(int)(width*(width>=3000?.48f:.65f));')
 # Suppress transport conflicts in the general post-record classification too,
 # including original full-frame predictions, before any counts are updated.
 needle='''     validFrames++;
     int p=0,a=0,v=0,weakPerson=0;'''
 replacement='''     found.removeIf(d->{
      if(!"person".equals(d.label))return false;
      if(!GardenPersonTrackGate.plausiblePersonShape(d.box,bitmap.getWidth(),bitmap.getHeight()))return true;
      for(Detection transport:lastGardenTransports)
       if(GardenPersonTrackGate.transportDominates(d.box,d.score,transport.box,transport.score,transport.label))return true;
      return false;
     });
     validFrames++;
     int p=0,a=0,v=0,weakPerson=0;'''
 t=base.once(t,needle,replacement);p.write_text(t)
 proof={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in src.glob('*.java')}
 (stage/'source-sha256.json').write_text(json.dumps(proof,indent=2))
 print(json.dumps({'source_files':len(proof),'recording_timing_unchanged':True,'small_people_retained':True}))
if __name__=='__main__':prepare(Path(sys.argv[1]))
