package nl.kalenel.s9security;
/** Legacy quota policy regression: admission is owned by CameraService,
 * where there must no longer be any call to RecordingRate.allow(). */
public final class RecordingRateTest {
 private static void check(boolean ok,String reason){if(!ok)throw new AssertionError(reason);}
 public static void main(String[] args){
  // Legacy helper is retained for archive compatibility only.
  check(!RecordingRate.allow(-1,true),"bad negative counter");
  check(RecordingRate.allow(0,false),"legacy helper baseline");
  check(!RecordingRate.allow(24,true),"legacy historical cap unchanged");
  System.out.println("S9_LEGACY_RATE_HELPER_TEST_PASS");
 }
}
