package nl.kalenel.s9security;
public final class CaptureContinuityTest {
 static void ok(boolean b,String name){if(!b)throw new AssertionError(name);}
 public static void main(String[] args){
  CaptureContinuity c=new CaptureContinuity();
  c.evidence(1000);c.started(1100,1791690000000L);
  c.evidence(119000);
  CaptureContinuity.Segment a=c.stopped(120000,"motion_1791690000000.mp4","max_segment");
  ok(a.autoResumeArmed,"recent evidence arms continuation");
  ok(c.continuationReady(120800),"next session can resume");
  c.started(122000,1791690120000L);
  CaptureContinuity.Segment b=c.stopped(123000,"motion_1791690120000.mp4","quiet_end");
  ok(a.eventId.equals(b.eventId)&&b.sequence==2,"segments share event lineage");
  ok("max_duration_continuation".equals(b.transitionReason),"reason recorded");
  ok(b.gapMs==2000,"physical gap is measured, never described as seamless");
  ok(b.previousClip.equals(a.clipName),"links predecessor");
  c.evidence(127000);c.started(128000,1791690130000L);
  CaptureContinuity.Segment d=c.stopped(129000,"motion_1791690130000.mp4","quiet_end");
  ok(d.sequence==3&&d.transitionReason.equals("reentry_after_quiet"),"quick visitor reentry linked");
  c.evidence(144000);c.started(145000,1791690160000L);
  CaptureContinuity.Segment e=c.stopped(146000,"motion_1791690160000.mp4","quiet_end");
  ok(e.sequence==1&&!e.eventId.equals(a.eventId),"distant visitor new event");
  c.evidence(160000);c.started(160100,1791690190000L);
  c.evidence(168000);
  CaptureContinuity.Segment x=c.stopped(170000,"motion_1791690190000.mp4","max_segment");
  ok(x.autoResumeArmed,"fresh max cap resumable");
  ok(c.continuationReady(180000),"10s window is still valid after 30s motion-tail upgrade");
  ok(c.continuationReady(184000),"30-second motion evidence still allows resume");
  ok(!c.continuationReady(199000),"30-second motion evidence expires");
  // MAX_REJOIN_MS is separately enforced when a new physical segment begins.
  ok(!c.isContinuationPending(),"resume disarmed");
  CaptureContinuity isolated=new CaptureContinuity();
  isolated.evidence(100);isolated.started(200,1791690200000L);
  CaptureContinuity.Segment z=isolated.stopped(400,"motion_1791690200000.mp4","quiet_end");
  ok(!z.autoResumeArmed,"quiet never automatically restarts");
  System.out.println("CAPTURE_CONTINUITY_TEST_PASS");
 }
}
