package nl.kalenel.s9security;
public final class EventFrameRankerTest {
 static void ok(boolean b,String name){if(!b)throw new AssertionError(name);}
 static int[] grid(boolean sharp){
  int[] a=new int[48*27];
  for(int y=0;y<27;y++)for(int x=0;x<48;x++){
   a[y*48+x]=sharp?((x+y)%2==0?55:185):115;
  }return a;
 }
 public static void main(String[] args){
  EventFrameRanker.Rank sharp=EventFrameRanker.rank(grid(true),48,27,.84,4);
  EventFrameRanker.Rank blur=EventFrameRanker.rank(grid(false),48,27,.84,4);
  ok(sharp.value>blur.value,"sharpness selects crisp subject");
  EventFrameRanker.Rank plain=EventFrameRanker.rank(grid(true),48,27,0,12);
  ok(sharp.value>plain.value,"person beats nonperson motion");
  EventFrameRanker.Rank dark=EventFrameRanker.rank(new int[48*27],48,27,.84,4);
  ok(sharp.value>dark.value,"dark blank frames should not win");
  boolean rejected=false;
  try{EventFrameRanker.rank(new int[4],48,27,.3,2);}catch(IllegalArgumentException e){rejected=true;}
  ok(rejected,"malformed frame rejected");
  System.out.println("EVENT_FRAME_RANKER_TEST_PASS");
 }
}
