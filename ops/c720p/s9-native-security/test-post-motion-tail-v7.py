#!/usr/bin/env python3
"""Guard S9's 30s motion tail and continuous native 4K segment behavior.
Does not touch phones; uses the committed Java source and a JVM contract.
"""
from pathlib import Path
import re,subprocess,tempfile,textwrap
ROOT=Path(__file__).resolve().parent
JAVA=ROOT/"src/nl/kalenel/s9security"
s=(JAVA/"CameraService.java").read_text()
assert re.search(r'QUIET_MS\s*=\s*30000\s*,\s*MAX_MS\s*=\s*120000',s), "post motion must be 30s; capped 120s"
assert "lastMovementAt=lastFrameAt;" in s, "accepted new motion must reset quiet tail"
assert 'else if(lastFrameAt-lastMovementAt>QUIET_MS)stopRecording("quiet_end")' in s
assert 'continuous4KStopReason=reason;' in s, "actual stop reason must be saved"
assert 'SystemClock.elapsedRealtime(),lastClip,finishedReason)' in s, "actual reason must flow into continuity"
assert 'if(segment.autoResumeArmed)cameraHandler.postDelayed' in s
assert 'eventChain.continuationReady(SystemClock.elapsedRealtime())' in s
assert '"record_tail_once".equals(value)' in s
assert 'diagnosticTailProof?32000:9000' in s
assert 'd.put("person_post_motion_hold_ms",QUIET_MS)' in s
assert 'd.put("person_post_motion_remaining_ms"' in s
# Pure-Java continuity simulation: an actual 120s cap with recent accepted motion
# arms the next segment; an expired or quiet-finished event does not.
with tempfile.TemporaryDirectory(prefix="s9-tail-tests-") as dir:
 p=Path(dir)
 harness=textwrap.dedent("""
 package nl.kalenel.s9security;
 public final class TailContractTest {
  public static void main(String[] args) {
   CaptureContinuity chain=new CaptureContinuity();
   chain.evidence(1000);chain.started(1200,1777777777000L);
   chain.evidence(120010);
   CaptureContinuity.Segment first=chain.stopped(120200,"motion_1777777777000.mp4","max_segment");
   if(!first.autoResumeArmed||!chain.continuationReady(120450))throw new AssertionError("cap continuation lost");
   chain.started(120500,1777777777500L);
   if(!chain.eventId().equals(first.eventId)||chain.segmentNumber()!=2)throw new AssertionError("event ID lost");
   chain.evidence(120600);
   CaptureContinuity.Segment quiet=chain.stopped(150601,"motion_1777777777500.mp4","quiet_end");
   if(quiet.autoResumeArmed||chain.continuationReady(150800))throw new AssertionError("quiet end rejoined");
   CaptureContinuity idle=new CaptureContinuity();
   idle.evidence(1000);idle.started(2000,1777777778000L);
   CaptureContinuity.Segment old=idle.stopped(121000,"motion_1777777778000.mp4","max_segment");
   if(old.autoResumeArmed)throw new AssertionError("stale motion rejoined");
   System.out.println("S9_POSTMOTION_TAIL_JVM_CONTRACT_PASS");
  }
 }
 """)
 f=p/"nl/kalenel/s9security/TailContractTest.java";f.parent.mkdir(parents=True);f.write_text(harness)
 subprocess.run(["javac","-d",str(p),str(JAVA/"CaptureContinuity.java"),str(f)],check=True,timeout=40)
 out=subprocess.run(["java","-cp",str(p),"nl.kalenel.s9security.TailContractTest"],capture_output=True,text=True,check=True,timeout=20)
 assert "PASS" in out.stdout
 print(out.stdout.strip())
print("S9_30S_TAIL_SOURCE_CONTRACT_PASS")
