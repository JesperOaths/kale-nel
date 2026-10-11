package nl.kalenel.s9security;

public final class PersonEventTrackerTest {
 private static void check(boolean condition,String message){
  if(!condition)throw new AssertionError(message);
 }
 private static final float[] A={.28f,.40f,.87f,.62f};
 private static final float[] B={.29f,.43f,.88f,.64f};
 private static final float[] C={.27f,.47f,.88f,.67f};
 private static final float[] FAR={.25f,.05f,.88f,.21f};
 public static void main(String[] args){
  PersonEventTracker t=new PersonEventTracker();
  check(!t.observe(1000,.89f,A).confirmedNow,"single hallucination accepted");
  check(!t.observe(1000,.90f,A).confirmedNow,"duplicate jpeg reused");
  check(!t.observe(1850,.72f,B).confirmedNow,"two-frame false positive");
  PersonEventTracker.Decision hit=t.observe(2600,.66f,C);
  check(hit.confirmedNow&&hit.active,"continuous person not confirmed");
  check(t.isActive(4800),"temporary occlusion must not immediately drop");
  check(!t.isActive(5150),"stale person falsely considered present");
  check(!t.observe(5800,.79f,FAR).confirmedNow,"far new event must start new track");
  check(!t.observe(6400,.92f,A).confirmedNow,"spatially disjoint box must reset");
  check(!t.observe(7100,.61f,B).confirmedNow,"second frame must not yet confirm");
  check(t.observe(7900,.62f,C).confirmedNow,"re-entry should confirm");
  check(!t.observe(8100,.1f,null).confirmedNow,"negative must not create person");
  check(t.confirmedEvents==2,"expected exactly two complete tracks");
  t.reset();
  check(!t.observe(9000,.8f,A).confirmedNow,"reset should clear track");
  check(!t.observe(9800,.3f,A).confirmedNow,"weak score should not count");
  check(!t.observe(10600,.7f,B).confirmedNow,"2 separated strong detections insufficient");
  System.out.println("S9_PERSON_EVENT_TRACKER_TESTS_PASSED");
 }
}
