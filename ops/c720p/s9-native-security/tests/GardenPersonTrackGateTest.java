package nl.kalenel.s9security;
public final class GardenPersonTrackGateTest{
 static int assertions=0;
 static void eq(GardenPersonTrackGate.Decision got,GardenPersonTrackGate.Decision want,String name){
  assertions++;if(got!=want)throw new AssertionError(name+" expected "+want+" got "+got);
 }
 static void check(boolean condition,String name){
  assertions++;if(!condition)throw new AssertionError(name);
 }
 public static void main(String[] args){
  float[] person={.30f,.38f,.78f,.55f};
  float[] moved={.31f,.47f,.79f,.64f};
  float[] vehicleArtefact={.45f,.72f,.65f,.93f};
  GardenPersonTrackGate gate=new GardenPersonTrackGate();
  eq(gate.offer(1000,900,.449f,person,0),GardenPersonTrackGate.Decision.FIRST,"weak borderline starts only candidate");
  eq(gate.offer(1900,900,.449f,person,0),GardenPersonTrackGate.Decision.DUPLICATE_JPEG,"cached JPG forbidden");
  eq(gate.offer(2000,1950,.449f,moved,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
   "two borderline static artefacts must not record");
  check(gate.confirmed==0,"no fake confirmed event");
  eq(gate.offer(3000,2950,.59f,moved,3),GardenPersonTrackGate.Decision.CONFIRMED,
   "same genuine moving person plus nearby grid motion can record");
  eq(gate.offer(4500,4400,.61f,person,2),GardenPersonTrackGate.Decision.FIRST,"new start");
  eq(gate.offer(5400,5350,.58f,vehicleArtefact,2),GardenPersonTrackGate.Decision.UNRELATED,
   "different object cannot vote for other candidate");
  eq(gate.offer(6400,6300,.58f,vehicleArtefact,2),GardenPersonTrackGate.Decision.CONFIRMED,
   "second corroboration must match last object");
  eq(gate.offer(7000,6950,.75f,person,0),GardenPersonTrackGate.Decision.FIRST,
   "high-confidence first candidate");
  eq(gate.offer(8100,8050,.81f,moved,0),GardenPersonTrackGate.Decision.CONFIRMED,
   "strong matching person can be caught when grid under-samples foot motion");
  eq(gate.offer(9200,9150,.43f,person,3),GardenPersonTrackGate.Decision.WEAK,"subthreshold reset");
  eq(gate.offer(10000,9950,.55f,person,2),GardenPersonTrackGate.Decision.FIRST,"new postweak candidate");
  eq(gate.offer(14300,14250,.55f,person,2),GardenPersonTrackGate.Decision.FIRST,"expired candidate can't pair");
  check(gate.duplicateFrames==1,"duplicate telemetry");
  check(gate.noLocalMotion==1,"rejected parked object telemetry");
  check(gate.unrelatedBoxes==1,"unrelated telemetry");
  check(gate.confirmed==3,"confirmation telemetry");
  check(!GardenPersonTrackGate.samePerson(person,vehicleArtefact),"not same object");
  check(GardenPersonTrackGate.samePerson(person,moved),"moving cross-frame object");
  check(!GardenPersonTrackGate.valid(new float[]{.2f,.2f,.2f,.9f}),"reject flat box");
  check(!GardenPersonTrackGate.valid(new float[]{.2f,Float.NaN,.6f,.9f}),"reject NaN");
  System.out.println("S9_PERSON_SPATIAL_MOTION_V7_PASS "+assertions);
 }
}
