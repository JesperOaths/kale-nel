package nl.kalenel.s9security;

/** Select an advertised fixed sensor cadence; never invent frames or exposures. */
final class CaptureCadence {
 static final int MIN_FPS=24;
 static int choose(int[][] ranges){
  int best=0;
  if(ranges!=null)for(int[] range:ranges){
   if(range!=null&&range.length==2&&range[0]==range[1]&&
      range[0]>=MIN_FPS&&range[0]<=30)best=Math.max(best,range[0]);
  }
  if(best==0)throw new IllegalArgumentException("fixed_24fps_sensor_range_unavailable");
  return best;
 }
}
