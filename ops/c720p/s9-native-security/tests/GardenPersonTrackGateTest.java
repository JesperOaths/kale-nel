package nl.kalenel.s9security;
public final class GardenPersonTrackGateTest{
 static int assertions=0;
 static void eq(GardenPersonTrackGate.Decision got,GardenPersonTrackGate.Decision want,String msg){
  assertions++;if(got!=want)throw new AssertionError(msg+" expected "+want+" got "+got);
 }
 static void check(boolean good,String msg){assertions++;if(!good)throw new AssertionError(msg);}
 public static void main(String[] args){
  float[] walker={.30f,.38f,.78f,.55f};
  float[] moving={.31f,.47f,.79f,.64f};
  float[] other={.45f,.72f,.65f,.93f};
  GardenPersonTrackGate gate=new GardenPersonTrackGate();
  eq(gate.offer(1000,900,.449f,walker,0),GardenPersonTrackGate.Decision.FIRST,
     "borderline static first observation");
  eq(gate.offer(1900,900,.449f,walker,0),GardenPersonTrackGate.Decision.DUPLICATE_JPEG,
     "duplicate JPEG must never count as a second person");
  eq(gate.offer(2000,1950,.449f,moving,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
     "static borderline prediction must not record");
  eq(gate.offer(3000,2950,.59f,moving,3),GardenPersonTrackGate.Decision.CONFIRMED,
     "person moving near local garden cells must record");
  eq(gate.offer(4500,4400,.61f,walker,2),GardenPersonTrackGate.Decision.FIRST,"new walker");
  eq(gate.offer(5400,5350,.58f,other,2),GardenPersonTrackGate.Decision.UNRELATED,
     "different object cannot corroborate walker");
  eq(gate.offer(6400,6300,.58f,other,2),GardenPersonTrackGate.Decision.CONFIRMED,
     "same second object can form a verified pair");
  eq(gate.offer(7000,6950,.79f,walker,0),GardenPersonTrackGate.Decision.FIRST,
     "high no-motion first");
  eq(gate.offer(8100,8050,.81f,moving,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
     "two high static predictions cannot trigger 4K");
  eq(gate.offer(9000,8950,.82f,moving,0),GardenPersonTrackGate.Decision.CONFIRMED,
     "third unique matching high-confidence frame confirms person despite motion grid");
  eq(gate.offer(10000,9950,.35f,walker,2),GardenPersonTrackGate.Decision.WEAK,
     "sub-0.36 is never a viable person");
  eq(gate.offer(11000,10950,.39f,walker,2),GardenPersonTrackGate.Decision.FIRST,
     "small moving person below former .44 threshold can arm");
  eq(gate.offer(11900,11850,.39f,moving,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
     "weak pair must have local motion on BOTH observations");
  eq(gate.offer(12900,12850,.39f,moving,2),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
     "single local motion not enough to repair previous static prediction");
  eq(gate.offer(13900,13850,.40f,moving,2),GardenPersonTrackGate.Decision.CONFIRMED,
     "two independent local-motion observations catch small walker");
  eq(gate.offer(16000,15900,.55f,walker,2),GardenPersonTrackGate.Decision.FIRST,
     "new track begins");
  eq(gate.offer(22000,21900,.56f,moving,2),GardenPersonTrackGate.Decision.FIRST,
     "candidate expires before 6 seconds");
  check(gate.confirmed==4,"all four genuine tracks confirmed");
  check(gate.duplicateFrames==1,"one cached jpeg rejected");
  check(gate.unrelatedBoxes==1,"unrelated-object telemetry");
  check(gate.noLocalMotion>=3,"motion corroboration was actually enforced");
  check(!GardenPersonTrackGate.samePerson(walker,other),"different boxes");
  check(GardenPersonTrackGate.samePerson(walker,moving),"moving box association");
  check(!GardenPersonTrackGate.valid(new float[]{.2f,.2f,.2f,.9f}),"zero height");
  check(!GardenPersonTrackGate.valid(new float[]{.2f,Float.NaN,.7f,.9f}),"NaN never valid");
  System.out.println("S9_HYBRID_PERSON_GATE_V8_PASS "+assertions);
 }
}
