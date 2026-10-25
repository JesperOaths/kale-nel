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
  final float[] falsePersonInsideCar={.48f,.38f,.70f,.51f};
  final float[] largerMovingCar={.43f,.10f,.73f,.80f};
  check(GardenPersonTrackGate.plausiblePersonShape(falsePersonInsideCar),
    "nested misclassified car part is person-shaped and requires transport veto");
  check(GardenPersonTrackGate.transportDominates(falsePersonInsideCar,.53f,
        largerMovingCar,.92f,"car"),
    "nested false person in high-confidence moving car vetoed despite low IoU");
  check(GardenPersonTrackGate.transportDominates(falsePersonInsideCar,.53f,
        largerMovingCar,.92f,"truck"),
    "nested high-confidence truck also vetoes false pedestrian");
  check(!GardenPersonTrackGate.transportDominates(falsePersonInsideCar,.53f,
        largerMovingCar,.72f,"car"),
    "uncertain vehicle label must not override person");
  check(!GardenPersonTrackGate.transportDominates(falsePersonInsideCar,.78f,
        largerMovingCar,.92f,"car"),
    "modest score difference must not suppress a separate person");
  check(!GardenPersonTrackGate.transportDominates(walker,.53f,
        largerMovingCar,.92f,"car"),
    "pedestrian only partly overlapping car must remain detectable");
  check(!GardenPersonTrackGate.transportDominates(falsePersonInsideCar,.53f,
        largerMovingCar,.92f,"dog"),
    "animals never become transport vetoes");
  check(!GardenPersonTrackGate.transportDominates(falsePersonInsideCar,.53f,
        largerMovingCar,Float.NaN,"car"),
    "non-finite transport confidence cannot veto a person");
  check(!GardenPersonTrackGate.transportDominates(walker,.50f,walker,.95f,"dog"),
    "animal class cannot be a transport veto");
  gate.reset();
  eq(gate.offer(25000,24950,.61f,falsePersonInsideCar,2),
    GardenPersonTrackGate.Decision.FIRST,
    "a single car part mislabeled person can propose but never start");
  gate.rejectCompetingTransport();
  eq(gate.offer(26000,25950,.61f,falsePersonInsideCar,2),
    GardenPersonTrackGate.Decision.FIRST,
    "vehicle veto must clear stale person evidence rather than pair with it");
  check(gate.transportInterrupted==1,
    "explicit transport rejection is recorded and track reset");
  gate.reset();
  eq(gate.offer(30000,29950,.64f,walker,2),GardenPersonTrackGate.Decision.FIRST,
    "walking pedestrian begins");
  check(!gate.rejectCompetingTransport(new float[][]{other}),
    "distant vehicle must not reset real person");
  eq(gate.offer(31000,30950,.63f,moving,2),
    GardenPersonTrackGate.Decision.CONFIRMED,
    "person still confirms alongside unrelated road car");
  gate.reset();
  eq(gate.offer(32000,31950,.64f,walker,2),
    GardenPersonTrackGate.Decision.FIRST,"person before same-region vehicle");
  check(gate.rejectCompetingTransport(new float[][]{walker}),
    "same-region vehicle interrupts pending person");
  eq(gate.offer(33000,32950,.63f,moving,2),
    GardenPersonTrackGate.Decision.FIRST,
    "same-region veto blocks two-frame false alarm");
  check(gate.unrelatedTransportIgnored==1,
    "distinct car veto tracked separately");
  check(gate.transportInterrupted==2,
    "existing and region-specific vehicle contradictions counted");
  gate.reset();
  eq(gate.offer(34000,33950,.64f,walker,2),
    GardenPersonTrackGate.Decision.FIRST,"unknown veto geometry candidate");
  check(gate.rejectCompetingTransport(new float[0][]),
    "missing veto coordinates fail closed");
  eq(gate.offer(35000,34950,.64f,moving,2),
    GardenPersonTrackGate.Decision.FIRST,
    "missing geometry cannot complete a false pair");
  // Stationary presence may keep an ALREADY admitted clip alive, but can
  // never start one from two otherwise motionless model predictions.
  gate.reset();
  check(!gate.confirmStationaryPresence(90000,89950,.94f,walker),
    "stationary high-confidence person without earlier motion cannot start");
  eq(gate.offer(91000,90950,.74f,walker,2),GardenPersonTrackGate.Decision.FIRST,
    "moving person's first admission frame");
  eq(gate.offer(92000,91950,.76f,moving,2),GardenPersonTrackGate.Decision.CONFIRMED,
    "moving person admitted before stationary tail");
  eq(gate.offer(94500,94450,.87f,moving,0),GardenPersonTrackGate.Decision.FIRST,
    "first no-motion recording check still cannot start another event");
  check(!gate.confirmStationaryPresence(94500,94450,.87f,moving),
    "one stationary image insufficient even after admission");
  check(!gate.confirmStationaryPresence(95000,94450,.91f,moving),
    "reusing identical JPEG cannot refresh tail");
  eq(gate.offer(97000,96950,.89f,moving,0),GardenPersonTrackGate.Decision.NO_LOCAL_MOTION,
    "ordinary initial-admission rule remains strict for motionless objects");
  check(gate.confirmStationaryPresence(97000,96950,.89f,moving),
    "two fresh high-confidence images keep known visitor in view");
  check(gate.stationaryHolds==1,"stationary continuation counted exactly once");
  check(!gate.rejectCompetingTransport(new float[][]{other}),
    "background car cannot erase already verified stationary person");
  check(!gate.confirmStationaryPresence(99000,98950,.90f,other),
    "different high-confidence object must not take over confirmed person");
  check(!gate.confirmStationaryPresence(100000,99950,.55f,moving),
    "weak continuation does not refresh person");
  check(!gate.confirmStationaryPresence(100500,100450,.90f,moving),
    "first fresh observation after weak/different proposal not sufficient");
  check(gate.rejectCompetingTransport(new float[][]{moving}),
    "same-region high-confidence vehicle clears previously confirmed visitor");
  check(!gate.confirmStationaryPresence(103000,102950,.92f,moving),
    "car contradiction invalidates stationary hold even for strong person model");
  gate.reset();
  eq(gate.offer(105000,104950,.74f,walker,2),GardenPersonTrackGate.Decision.FIRST,
    "new visitor after reset");
  eq(gate.offer(106000,105950,.74f,moving,2),GardenPersonTrackGate.Decision.CONFIRMED,
    "valid moving visitor");
  check(!gate.confirmStationaryPresence(115001,115000,.90f,moving),
    "stale verified pedestrian beyond nine seconds cannot extend recording");
  gate.reset();
  check(!gate.confirmStationaryPresence(117000,116950,.92f,moving),
    "full reset never preserves a previous approved visitor");
  gate.reset();
  eq(gate.offer(210000,209950,.79f,walker,2),
    GardenPersonTrackGate.Decision.FIRST,"late visitor initial motion");
  eq(gate.offer(211000,210950,.81f,moving,2),
    GardenPersonTrackGate.Decision.CONFIRMED,"late visitor admitted");
  eq(gate.offer(211500,211450,.88f,moving,0),
    GardenPersonTrackGate.Decision.FIRST,"first stationary observation");
  check(!gate.confirmStationaryPresence(211500,211450,.88f,moving),
    "single parked observation does not refresh");
  eq(gate.offer(216900,216850,.20f,null,0),
    GardenPersonTrackGate.Decision.WEAK,
    "weak single dropout may expire tentative candidate");
  check(!gate.confirmStationaryPresence(217100,217050,.88f,moving),
    "first strong return after dropout insufficient");
  check(gate.confirmStationaryPresence(219000,218950,.91f,moving),
    "short weak dropout does not erase already verified visitor");
  check(gate.stationaryHolds==2,
    "two separately demonstrated stationary holds across test scenarios");

  check(!GardenPersonTrackGate.valid(new float[]{.2f,Float.NaN,.7f,.9f}),"NaN never valid");
  System.out.println("S9_SPATIOTEMPORAL_PEDESTRIAN_V9_PASS "+assertions);
 }
}
