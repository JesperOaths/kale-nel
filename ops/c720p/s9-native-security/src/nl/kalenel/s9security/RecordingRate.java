package nl.kalenel.s9security;
/** Pure policy for event admission. 12 normal 4K clips, then 12 reserved for
 * sustained coherent motion. Never confuses motion strength with person identity.
 * All rejected events may still produce small local-only preview evidence.
 */
public final class RecordingRate {
 public static final int BASE_PER_HOUR=12;
 public static final int PRIORITY_RESERVE_PER_HOUR=12;
 public static final int TOTAL_PER_HOUR=BASE_PER_HOUR+PRIORITY_RESERVE_PER_HOUR;
 private RecordingRate(){}
 public static boolean allow(int recorded,boolean sustainedCoherent){
  if(recorded<0)return false;
  return recorded<BASE_PER_HOUR ||
   (recorded<TOTAL_PER_HOUR && sustainedCoherent);
 }
 public static boolean reserve(int recorded){
  return recorded>=BASE_PER_HOUR && recorded<TOTAL_PER_HOUR;
 }
}