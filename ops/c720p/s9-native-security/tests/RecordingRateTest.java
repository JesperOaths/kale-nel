package nl.kalenel.s9security;
public final class RecordingRateTest {
 private static void check(boolean condition,String why){if(!condition)throw new AssertionError(why);}
 public static void main(String[] args){
  check(!RecordingRate.allow(-1,true),"invalid counts must fail closed");
  check(RecordingRate.TOTAL_PER_HOUR==24,"retain strict total 24/h safety");
  for(int i=0;i<16;i++) {
   check(RecordingRate.allow(i,false),"normal budget "+i);
   check(!RecordingRate.reserve(i),"normal tier "+i);
  }
  check(!RecordingRate.allow(16,false),"unverified nuisance events cannot use reserve");
  check(RecordingRate.allow(16,true),"sustained motion gets reserve");
  check(RecordingRate.allow(23,true),"final priority slot");
  check(!RecordingRate.allow(24,true),"bounded 4K rate");
  check(RecordingRate.reserve(16),"reserve accounting");
  check(!RecordingRate.reserve(24),"after reserve");
  System.out.println("S9_EVIDENCE_BUDGET_POLICY_TEST_PASS");
 }
}