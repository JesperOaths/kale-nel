package nl.kalenel.s9security;
public final class GardenPersonTrackGateTest{
 static int assertions=0;
 static void eq(GardenPersonTrackGate.Decision got,GardenPersonTrackGate.Decision want,String msg){
  assertions++;if(got!=want)throw new AssertionError(msg+" expected "+want+" got "+got);
 }
 static void check(boolean good,String msg){assertions++;if(!good)throw new AssertionError(msg);}
 public static void main(String[] args){
  final float[] walker={.30f,.38f,.78f,.55f};
  final float[] moving={.31f,.47f,.79f,.64f};
  final float[] farWalker={.30f,.50f,.79f,.67f};
  final float[] other={.45f,.72f,.65f,.93f};
  final float[] broadCar={.49f,.12f,.67f,.77f};
  final float[] parkedPersonBox={.24f,.23f,.73f,.40f};

  GardenPersonTrackGate gate=new GardenPersonTrackGate();
  eq(gate.offer(1000,900,.449f,walker,0),GardenPersonTrackGate.Decision.FIRST,"borderline starts");
  eq(gate.offer(1900,900,.449f,walker,0),GardenPersonTrackGate.Decision.DUPLICATE_JPEG,
    "same camera JPEG cannot vote twice");
  eq(gate.offer(2000,1950,.449f,moving,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
    "weak person scores without motion cannot record");
  eq(gate.offer(3000,2950,.40f,moving,2),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
    "one local-motion sample is insufficient for weak person");
  eq(gate.offer(4000,3950,.40f,moving,2),GardenPersonTrackGate.Decision.CONFIRMED,
    "two consecutive local person-motion observations confirm weak pedestrian");

  eq(gate.offer(5000,4950,.73f,walker,0),GardenPersonTrackGate.Decision.FIRST,
    "high confidence static first");
  eq(gate.offer(6000,5950,.85f,walker,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
    "stationary object still rejected with two confident predictions");
  eq(gate.offer(7000,6950,.88f,walker,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
    "even repeated high score cannot capture parked car/decoration");
  eq(gate.offer(8000,7950,.82f,walker,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
    "fourth unmoving detection not allowed");

  gate.reset();
  eq(gate.offer(9000,8950,.74f,walker,0),GardenPersonTrackGate.Decision.FIRST,"pedestrian periodic scan");
  eq(gate.offer(10000,9950,.76f,moving,0),GardenPersonTrackGate.Decision.CONFIRMED,
    "walker moves without triggering coarse motion grid: temporal displacement admits");

  eq(gate.offer(11000,10950,.61f,walker,2),GardenPersonTrackGate.Decision.FIRST,
    "normal walking first frame");
  eq(gate.offer(12000,11950,.60f,moving,2),GardenPersonTrackGate.Decision.CONFIRMED,
    "normal walking local motion across two frames");
  eq(gate.offer(13000,12950,.65f,walker,2),GardenPersonTrackGate.Decision.FIRST,
    "new pedestrian begins");
  eq(gate.offer(14000,13950,.66f,other,2),GardenPersonTrackGate.Decision.UNRELATED,
    "separate region cannot validate first walker");
  eq(gate.offer(15000,14950,.68f,other,2),GardenPersonTrackGate.Decision.CONFIRMED,
    "second distinct person can independently qualify");
  eq(gate.offer(16000,15950,.35f,walker,2),GardenPersonTrackGate.Decision.WEAK,
    "below threshold never person");
  eq(gate.offer(17000,16950,.65f,broadCar,3),GardenPersonTrackGate.Decision.WEAK,
    "vehicle-shaped wide box not admitted as person");
  eq(gate.offer(18000,17950,.65f,walker,2),GardenPersonTrackGate.Decision.FIRST,
    "new track");
  eq(gate.offer(24000,23950,.65f,moving,2),GardenPersonTrackGate.Decision.FIRST,
    "candidate expired before 6 seconds");
  check(gate.confirmed==4,"four independently verified moving person tracks");
  check(gate.duplicateFrames==1,"duplicate JPEG ignored");
  check(gate.unrelatedBoxes==1,"separate objects did not combine");
  check(gate.noLocalMotion>=4,"static false positive protection enforced");
  check(gate.unlikePersonShape>=1,"vehicle-like person boxes rejected");
  check(!GardenPersonTrackGate.samePerson(walker,other),"different boxes must not correlate");
  check(GardenPersonTrackGate.samePerson(walker,moving),"moving walker boxes stay associated");
  check(!GardenPersonTrackGate.plausiblePersonShape(broadCar),"wide car not person-shaped");
  check(GardenPersonTrackGate.plausiblePersonShape(walker),"upright walker accepted");
  check(GardenPersonTrackGate.personMoved(walker,moving),"walker translated");
  check(!GardenPersonTrackGate.personMoved(parkedPersonBox,parkedPersonBox),"static object does not move");
  check(GardenPersonTrackGate.transportDominates(walker,.55f,walker,.80f,"car"),
    "strong conflicting car class vetoes same box");
  check(GardenPersonTrackGate.transportDominates(walker,.55f,walker,.80f,"bicycle"),
    "same-box bicycle class is not a pedestrian");
  check(!GardenPersonTrackGate.transportDominates(walker,.79f,walker,.80f,"car"),
    "weak competing car class cannot veto genuine pedestrian");
  check(!GardenPersonTrackGate.transportDominates(walker,.55f,other,.94f,"truck"),
    "nearby truck must not hide independent walker");
  check(!GardenPersonTrackGate.transportDominates(walker,.50f,walker,.95f,"dog"),
    "animal class cannot be a transport veto");
  check(!GardenPersonTrackGate.valid(new float[]{.2f,Float.NaN,.7f,.9f}),"NaN never valid");
  System.out.println("S9_PEDESTRIAN_POLICY_V38_PASS "+assertions);
 }
}
