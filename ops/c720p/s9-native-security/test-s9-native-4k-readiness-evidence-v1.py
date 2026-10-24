#!/usr/bin/env python3
"""Source-pinned and JVM-backed tests. No ADB, camera, media or system services."""
from pathlib import Path
import re, shutil, subprocess, tempfile, unittest

ROOT=Path(__file__).resolve().parent
SRC=(ROOT/"src/nl/kalenel/s9security/CameraService.java").read_text()
class Tests(unittest.TestCase):
 def test_rearm_budget_and_guards_unchanged(self):
  a=SRC.split("private void maybeRestoreCool4K(){",1)[1].split("private void watchdog(){",1)[0]
  for token in ("continuous4KRecoveryAttempts>=3", "continuous4KRecoveryAttempts++;",
      "now<continuous4KRetryAfterMs||temperature()>=405",
      "now-lastMovementAt<30000", "gardenPersonCandidateUntil>now",
      "folder.getUsableSpace()<15L*1024*1024*1024",
      '"watching".equals(mode)', "continuous_4k_production_enabled"):
   self.assertIn(token,a)
  self.assertEqual(a.count("candidate.start()"),1)
  self.assertNotIn("continuous4KRecoveryAttempts=0",a)
 def test_readiness_timeout_falls_back_not_retries(self):
  w=SRC.split("private void watchdog(){",1)[1].split("private void failure(",1)[0]
  self.assertIn("continuous4KReadiness.observe(",w)
  self.assertIn('restoreLegacy4K(continuous4KReadiness.reason())',w)
  self.assertIn('if("watching".equals(mode))restoreLegacy4K(reason);',w)
  self.assertIn('stopRecording("trial_health_guard");',w)
  self.assertNotIn("candidate.start()",w)
  self.assertNotIn("continuous4KRecoveryAttempts++",w)
 def test_failback_captures_cause_before_destroying_encoder(self):
  c=SRC.split("private void record4KFallbackEvidence(",1)[1].split("private void restoreLegacy4K(",1)[0]
  for name in ('"thermal_guard"','"codec_exception"','"codec_dropped_output"',
      '"camera_session_failure"','"ring_readiness_timeout"','"codec_or_muxer_exception"',
      '"buffered_ms_before_fallback"','"mode_before_fallback"',
      '"encoder_error_class"','"encoder_dropped_output_frames"'):
   self.assertIn(name,c)
  self.assertIn("Math.max(0,history.length()-2)",c)
  self.assertIn('Log.w(TAG,"4k_recovery_evidence_unavailable",error)',c)
  f=SRC.split("private void restoreLegacy4K(String reason){",1)[1].split("private void configurePreview()",1)[0]
  self.assertLess(f.index("record4KFallbackEvidence(reason)"),f.index("continuous4K.close()"))
  self.assertIn("continuous4KReadiness.reset()",f)
  self.assertIn("if(!pilotOnly&&preRoll==null)preRoll=new GardenPreRoll();",f)
  self.assertIn('continuous4KLastResult="fallback_"+reason;',f)
  self.assertIn("continuous_4k_recovery_evidence_scope",SRC)
  self.assertIn("forward_only_not_historical",SRC)
 def test_active_mp4_finalization_precedes_fallback(self):
  watchdog=SRC.split("private void watchdog(){",1)[1].split("private void failure(",1)[0]
  self.assertIn('continuous4KHealthFallbackPending=reason+"_after_finalization"',watchdog)
  self.assertIn('stopRecording("trial_health_guard")',watchdog)
  self.assertNotIn('restoreLegacy4K(reason+"_stopping")',watchdog)
  complete=SRC.split("private void finishContinuous4K(",1)[1].split("private void stopRecording(",1)[0]
  self.assertLess(complete.index("validCompleted4K(clip)"),complete.index('mode="watching"'))
  self.assertLess(complete.index('reviewer.submit(()->review(clip,evidenceReason,motionAtSave,segment))'),
      complete.index('restoreLegacy4K(afterFinalize)',complete.index('reviewer.submit(()->review(clip,evidenceReason,motionAtSave,segment))')))
  self.assertLess(complete.index('restoreLegacy4K(afterFinalize)',complete.index('reviewer.submit(()->review(clip,evidenceReason,motionAtSave,segment))')),
      complete.index('if(segment.autoResumeArmed)'))
  self.assertIn("return;\n  }\n  // If motion continues at a safety cap,",complete)
  self.assertIn('continuous4KHealthFallbackPending=""',SRC)
 def test_jvm_deadline_and_no_event_interference(self):
  if not (shutil.which("javac") and shutil.which("java")):self.skipTest("JDK unavailable")
  # Extract the actual nested guard; compile its exact source on a real JVM.
  marker="static final class RingReadinessWatchdog {"
  start=SRC.index(marker)
  open_brace=SRC.index("{",start)
  depth=0
  for i in range(open_brace,len(SRC)):
   if SRC[i]=="{":depth+=1
   if SRC[i]=="}":
    depth-=1
    if depth==0:
     body=SRC[start:i+1]
     break
  else:raise AssertionError("missing closing guard brace")
  code='''public final class GuardContract {
'''+body+'''
 static void good(boolean ok,String msg){if(!ok)throw new AssertionError(msg);}
 public static void main(String[] args){
   RingReadinessWatchdog a=new RingReadinessWatchdog();
   good(!a.observe(1000,true,false),"first grace");
   good(!a.observe(45999,true,false),"not before 45sec");
   good(a.observe(46000,true,false),"45sec deadline");
   good(a.reason().equals("ring_never_ready"),"correct first failure");
   a.reset();
   good(!a.observe(1000,true,false),"fresh");
   good(!a.observe(60000,false,false),"recording interrupts");
   good(!a.observe(60001,true,false),"timer reset after recording");
   good(!a.observe(63000,true,true),"ready");
   good(!a.observe(65000,true,false),"ring drains transiently");
   good(!a.observe(109999,true,false),"still grace");
   good(a.observe(110000,true,false),"sustained stalled ring");
   good(a.reason().equals("ring_stalled"),"stalled vs never ready");
   a.reset();
   good(!a.observe(200000,true,false),"reset");
   good(!a.observe(200001,true,true),"recovered");
   good(!a.observe(200002,true,false),"next transient");
   good(!a.observe(100,true,false),"clock monotonic reset");
 }
}
'''
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/"GuardContract.java"
   path.write_text(code)
   build=subprocess.run(["javac",str(path)],capture_output=True,text=True,timeout=45)
   self.assertEqual(build.returncode,0,build.stderr)
   run=subprocess.run(["java","-cp",tmp,"GuardContract"],capture_output=True,text=True,timeout=45)
   self.assertEqual(run.returncode,0,run.stderr)
if __name__=="__main__":unittest.main(verbosity=2)
