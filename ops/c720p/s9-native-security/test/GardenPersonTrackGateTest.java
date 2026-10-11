package nl.kalenel.s9security;
public final class GardenPersonTrackGateTest {
 private static int tests=0;
 private static void eq(GardenPersonTrackGate.Result got,GardenPersonTrackGate.Result want,String msg){
  tests++;if(got!=want)throw new AssertionError(msg+" expected "+want+" got "+got);
 }
 private static void check(boolean ok,String msg){tests++;if(!ok)throw new AssertionError(msg);}
 public static void main(String[] args){
  float[] a={.25f,.35f,.85f,.53f};
  float[] shifted={.28f,.45f,.88f,.62f};
  float[] unrelated={.05f,.74f,.45f,.95f};
  GardenPersonTrackGate gate=new GardenPersonTrackGate();
  eq(gate.offer(1000,950,.60f,a),GardenPersonTrackGate.Result.FIRST,"first candidate");
  eq(gate.offer(2000,950,.70f,a),GardenPersonTrackGate.Result.DUPLICATE_FRAME,"same jpeg is not two people");
  eq(gate.offer(2500,2410,.58f,shifted),GardenPersonTrackGate.Result.CONFIRMED,"same moving person");
  eq(gate.offer(3500,3460,.48f,a),GardenPersonTrackGate.Result.FIRST,"new event");
  eq(gate.offer(4520,4460,.48f,unrelated),GardenPersonTrackGate.Result.UNRELATED,"unrelated false detection");
  eq(gate.offer(5700,5660,.44f,unrelated),GardenPersonTrackGate.Result.CONFIRMED,"same shifted box");
  eq(gate.offer(7000,6950,.70f,a),GardenPersonTrackGate.Result.FIRST,"rearm");
  eq(gate.offer(10000,9950,.32f,a),GardenPersonTrackGate.Result.WEAK,"weak resets track");
  eq(gate.offer(10900,10850,.70f,a),GardenPersonTrackGate.Result.FIRST,"cannot link after weak");
  eq(gate.offer(15500,15450,.70f,a),GardenPersonTrackGate.Result.FIRST,"expired pair");
  check(!GardenPersonTrackGate.associated(a,unrelated),"distant boxes separate");
  check(GardenPersonTrackGate.associated(a,shifted),"moving boxes associated");
  check(!GardenPersonTrackGate.valid(new float[]{.1f,.2f,.1f,.7f}),"zero-height false box");
  check(!GardenPersonTrackGate.valid(new float[]{.1f,.2f,Float.NaN,.7f}),"NaN false box");
  check(gate.confirmed==2,"two valid events confirmed only");
  check(gate.duplicate==1&&gate.unrelated==1,"failure counters measured");
  System.out.println("GARDEN_TRACK_GATE_TESTS_PASS "+tests);
 }
}
