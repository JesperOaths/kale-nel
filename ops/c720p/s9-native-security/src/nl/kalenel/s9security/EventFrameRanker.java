package nl.kalenel.s9security;

/** Deterministic thumbnail candidate quality; no Android classes or IO. */
public final class EventFrameRanker {
 public static final String VERSION="s9_event_frame_rank_v1";
 private EventFrameRanker(){}
 public static final class Rank {
  public final double value,sharpness,contrast;
  public final boolean gardenPerson;
  Rank(double value,double sharpness,double contrast,boolean person){
   this.value=value;this.sharpness=sharpness;this.contrast=contrast;gardenPerson=person;
  }
 }
 /**
  * Grid contains 48x27 representative luma samples, garden-only.
  * Reward focused frames but never let a blurry nonperson beat a
  * plausible garden-person observation; reject severe darkness/whiteout.
  */
 public static Rank rank(int[] grid,int width,int height,double personConfidence,
                         double gardenMotion){
  if(grid==null||width<3||height<3||grid.length!=width*height)
   throw new IllegalArgumentException("invalid_luma_grid");
  double edge=0,contrast=0,mean=0;
  int n=0,valid=0;
  for(int v:grid){if(v<0||v>255)throw new IllegalArgumentException("invalid_luma");
   mean+=v;}
  mean/=grid.length;
  for(int y=1;y<height-1;y++)for(int x=1;x<width-1;x++){
   int i=y*width+x;
   double dx=Math.abs(grid[i+1]-grid[i]);
   double dy=Math.abs(grid[i+width]-grid[i]);
   edge+=dx+dy;
   contrast+=Math.abs(grid[i]-mean);
   n++;
   if(grid[i]>18&&grid[i]<240)valid++;
  }
  double sharp=edge/Math.max(1,n),detail=contrast/Math.max(1,n);
  boolean person=personConfidence>=.30;
  double exposurePenalty=(valid/(double)Math.max(1,n)<.35)?110:0;
  // Person is the main subject. Motion helps only *after* a usable focus
  // estimate, so blurred frames cannot win by flickering.
  double value=(person?400+Math.min(1,personConfidence)*150:0)
    +Math.min(170,sharp*5.2)+Math.min(60,detail*1.3)
    +Math.min(25,Math.max(0,gardenMotion)*2.5)-exposurePenalty;
  return new Rank(value,sharp,detail,person);
 }
 public static boolean better(Rank candidate,Rank best){
  return best==null||candidate.value>best.value;
 }
}
