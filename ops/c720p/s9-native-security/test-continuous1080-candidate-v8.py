#!/usr/bin/env python3
"""Read-only contract test for lower-thermal 1080p single-encoder profile.

The source under test is the staged candidate, NOT installed production.
Reject accidental 4K production preference reuse or misleading status labels.
"""
import pathlib,re,subprocess,tempfile,textwrap
here=pathlib.Path(__file__).resolve().parent
src=here/"src/nl/kalenel/s9security"
service=(src/"CameraService.java").read_text()
ring=(src/"Encoded4KRing.java").read_text()
codec=(src/"Continuous4KEncoder.java").read_text()
assert "WIDTH=1920, HEIGHT=1080, FPS=30, BITRATE=8000000" in ring
assert "MAX_BYTES=32*1024*1024" in ring
assert "continuous_native_1080_h264_ring_v1" in service
assert '"continuous_1080_trial"' in service
assert '"continuous_1080_production_enabled"' in service
assert '"continuous_4k_production_enabled"' not in service
assert '"continuous_4k_trial"' not in service
assert '"active_ring_width"' in service and '"active_ring_height"' in service
assert '"event_recording_resolution"' in service
assert '"single_encoder_no_resolution_jump"' in service
assert "QUIET_MS=30000,MAX_MS=120000" in service
assert 'MAX_REJOIN_MS=12000,MAX_RESUME_MS=30000' in (src/"CaptureContinuity.java").read_text()
assert "continuous4K.startEvent(" in service
assert "ring.freeze()" in codec
assert "stopAfterPtsUs=" in codec
assert "MediaMuxer" in codec
assert "MediaFormat.createVideoFormat(H264,Encoded4KRing.WIDTH,Encoded4KRing.HEIGHT)" in codec
assert "width!=Encoded4KRing.WIDTH||height!=Encoded4KRing.HEIGHT" in codec
with tempfile.TemporaryDirectory(prefix="s9-1080-candidate-jvm-") as d:
    dest=pathlib.Path(d)
    # Test the same production encoded ring keyframe logic on 1080 stream.
    p=dest/"RingTest.java"
    p.write_text(textwrap.dedent("""
       import nl.kalenel.s9security.Encoded4KRing;
       public class RingTest {
         public static void main(String[] args) {
           if(Encoded4KRing.WIDTH!=1920 || Encoded4KRing.HEIGHT!=1080 ||
              Encoded4KRing.BITRATE!=8000000 || Encoded4KRing.FPS!=30)
             throw new AssertionError("incorrect 1080 stream");
           Encoded4KRing ring=new Encoded4KRing();
           byte[] n=new byte[500];
           for(int i=0;i<310;i++)
             if(!ring.offer(n,i*33333L,i%30==0?1:0,i%30==0))
               throw new AssertionError("encoded 1080 packet rejected");
           Encoded4KRing.Frozen clip=ring.freeze();
           if(clip==null || clip.durationUs<5500000L ||
              clip.durationUs>9500000L || clip.samples.size()<165 ||
              !clip.samples.get(0).key)throw new AssertionError("1080 preroll invalid");
           long prev=-1;
           for(Encoded4KRing.Sample e:clip.samples) {
             if(e.ptsUs<=prev)throw new AssertionError("nonmonotonic pts");
             prev=e.ptsUs;
           }
           System.out.println("STAGED_S9_1080_RING_JVM_PASS");
         }
       }
       """))
    subprocess.run(["javac","-d",str(dest),str(src/"Encoded4KRing.java"),str(p)],check=True,timeout=40)
    o=subprocess.run(["java","-cp",str(dest),"RingTest"],capture_output=True,text=True,check=True,timeout=20)
    assert "STAGED_S9_1080_RING_JVM_PASS" in o.stdout
    print(o.stdout.strip())
print("STAGED_S9_1080_PROFILE_SOURCE_CONTRACT_PASS")
