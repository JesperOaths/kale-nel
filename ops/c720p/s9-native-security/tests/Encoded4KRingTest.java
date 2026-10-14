package nl.kalenel.s9security;

import java.util.ArrayList;
import java.util.List;

/** Native 4K compressed ring contract tests, no emulator/device required. */
public final class Encoded4KRingTest {
 static void check(boolean pass,String why){if(!pass)throw new AssertionError(why);}
 static final long STEP_US=33333L;
 static void feed(Encoded4KRing r,int start,int end,int length) {
  byte[] packet=new byte[length];
  for(int i=start;i<end;i++){
   packet[0]=(byte)(i&255);
   check(r.offer(packet,i*STEP_US, i%30==0?1:0,i%30==0),"valid packet "+i);
  }
 }
 static void testSevenSecondsWithEarlierIdr() {
  Encoded4KRing ring=new Encoded4KRing();
  feed(ring,0,360,150000);
  Encoded4KRing.Frozen prefix=ring.freeze();
  check(prefix!=null,"cold ring must freeze when populated");
  check(prefix.samples.get(0).key,"first sample must be an IDR");
  check(prefix.durationUs>=7_000_000L,"historical prefix <7s");
  check(prefix.durationUs<=9_000_000L,"prefix exceeds memory window");
  check(ring.bufferedUs()<=9_000_000L,"bounded by time");
  check(ring.bytes()<=Encoded4KRing.MAX_BYTES,"bounded by bytes");
  check(prefix.samples.get(0).ptsUs<=prefix.lastPtsUs-7_000_000L,
        "IDR selected AFTER desired start");
  long last=prefix.lastPtsUs;
  long total=prefix.samples.size();
  feed(ring,360,600,150000);
  List<Encoded4KRing.Sample> continuation=new ArrayList<>();
  // Same continuous encoder's subsequent packets: not another source.
  Encoded4KRing.Frozen now=ring.freeze();
  for(Encoded4KRing.Sample s:now.samples)if(s.ptsUs>last)continuation.add(s);
  check(!continuation.isEmpty(),"event has additional frames");
  check(continuation.get(0).ptsUs>last,"strict monotonic event handoff");
  check(total>=150,"pre-event frame count unexpectedly low");
 }
 static void testEarlyTriggerCannotSaveOneSecond() {
  Encoded4KRing ring=new Encoded4KRing();
  feed(ring,0,46,180000);
  check(ring.freeze()==null,"partial 1.5s must not be exported");
  feed(ring,46,160,180000);
  check(ring.freeze()==null,"partial 5.6s with IDR at 0 may be too short");
  feed(ring,160,220,180000);
  check(ring.freeze()!=null,"fully populated buffer should recover");
 }
 static void testPressureNeverSpills() {
  Encoded4KRing ring=new Encoded4KRing();
  feed(ring,0,350,2_000_000);
  check(ring.bytes()<=Encoded4KRing.MAX_BYTES,"memory cap violated");
  check(ring.frames()<=39,"huge AVC frames should trim aggressively");
  check(ring.freeze()==null,"must never invent seven seconds after eviction");
 }
 static void testNoIdrCannotExport() {
  Encoded4KRing ring=new Encoded4KRing();
  byte[] packet=new byte[1000];
  for(int i=0;i<330;i++)ring.offer(packet,i*STEP_US,0,false);
  check(ring.freeze()==null,"non-IDR prefix cannot decode");
 }
 static void testInputCopyAndTimestamps() {
  Encoded4KRing ring=new Encoded4KRing();
  byte[] b={3,4,5};
  check(ring.offer(b,100,1,true),"first frame");
  b[0]=99;
  check(!ring.offer(b,100,0,false),"duplicated PTS accepted");
  check(!ring.offer(b,99,0,false),"backwards PTS accepted");
  check(ring.rejectedSamples()==2,"bad timestamp counter");
  check(ring.bytes()==3,"buffer bytes");
  feed(ring,1,240,5000);
  check(ring.freeze()!=null,"long event available");
  ring.clear();
  check(ring.frames()==0&&ring.bufferedUs()==0,"clear must release data");
 }
 public static void main(String[] args){
  testSevenSecondsWithEarlierIdr();
  testEarlyTriggerCannotSaveOneSecond();
  testPressureNeverSpills();
  testNoIdrCannotExport();
  testInputCopyAndTimestamps();
  System.out.println("S9_CONTINUOUS_4K_RING_PURE_JAVA_TESTS_PASS");
 }
}
