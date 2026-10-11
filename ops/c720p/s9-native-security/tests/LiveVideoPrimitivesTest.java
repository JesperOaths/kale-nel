package nl.kalenel.s9security;

import java.util.Arrays;

public final class LiveVideoPrimitivesTest {
 private static void check(boolean result,String label){if(!result)throw new AssertionError(label);}
 private static void rejects(byte[] bytes){
  try{H264AnnexB.normalize(bytes);throw new AssertionError("invalid AVC accepted");}
  catch(IllegalArgumentException expected){}
 }
 public static void main(String[] args){
  check(CaptureCadence.choose(new int[][]{{15,30},{24,24},{30,30}})==30,"prefer true fixed30fps");
  check(CaptureCadence.choose(new int[][]{{15,30},{24,24}})==24,"fixed24fps supported");
  check(CaptureCadence.choose(new int[][]{{60,60},{25,25},{24,24}})==25,"avoid unsupported4K60fps");
  for(int[][] unavailable:new int[][][]{null,new int[0][],{{15,30}},{{15,15},{10,24}}}){
   try{CaptureCadence.choose(unavailable);throw new AssertionError("variable or slow sensor accepted");}
   catch(IllegalArgumentException expected){}
  }
  byte[] annex3={0,0,1,0x67,0x11};byte[] annex4={0,0,0,1,0x65,0x22};
  check(Arrays.equals(annex3,H264AnnexB.normalize(annex3)),"preserve3byte startcode");
  check(Arrays.equals(annex4,H264AnnexB.normalize(annex4)),"preserve4byte startcode");
  byte[] avcc={0,0,0,2,0x67,0x11,0,0,0,3,0x68,0x22,0x33};
  byte[] expected={0,0,0,1,0x67,0x11,0,0,0,1,0x68,0x22,0x33};
  check(Arrays.equals(expected,H264AnnexB.normalize(avcc)),"convertall AVC NALunits");
  rejects(new byte[]{0,0});rejects(new byte[]{0,0,0,0});
  rejects(new byte[]{0,0,0,8,0x65,0x22});rejects(new byte[]{(byte)0xff,0,0,1,0x65});
  byte[] joined=H264AnnexB.join(annex3,annex4);
  check(joined.length==annex3.length+annex4.length&&joined[annex3.length+4]==0x65,"prependconfig to IDR");
  check(H264AnnexB.normalize(null).length==0,"missingoptional PPS remains empty");
  System.out.println("S9_LIVE_VIDEO_PRIMITIVES_OK");
 }
}
