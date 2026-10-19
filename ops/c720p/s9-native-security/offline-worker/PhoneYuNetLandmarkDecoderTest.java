package nl.kalenel.s9offline;
import java.util.*;
/** All-synthetic YuNet output checks; no images, faces, models or camera. */
public final class PhoneYuNetLandmarkDecoderTest {
 static void yes(boolean x,String reason){if(!x)throw new AssertionError(reason);}
 static final double[] TARGET={
  38.2946,51.6963,73.5318,51.5014,56.0252,71.7366,
  41.5493,92.3655,70.7299,92.2041
 };
 static Map<String,Object> emptyHeads() {
  Map<String,Object> m=new HashMap<>();
  for(int s:new int[]{8,16,32}){
   int n=(640/s)*(640/s);
   m.put("cls_"+s,new float[1][n][1]);
   m.put("obj_"+s,new float[1][n][1]);
   m.put("bbox_"+s,new float[1][n][4]);
   m.put("kps_"+s,new float[1][n][10]);
  }
  return m;
 }
 static void setFace(Map<String,Object> m,int row,int col,float score){
  int idx=row*80+col;
  ((float[][][])m.get("cls_8"))[0][idx][0]=score;
  ((float[][][])m.get("obj_8"))[0][idx][0]=score;
  float[] box=((float[][][])m.get("bbox_8"))[0][idx];
  box[0]=0;box[1]=2.5f;box[2]=(float)Math.log(25);
  box[3]=(float)Math.log(31.25);
  float[] points=((float[][][])m.get("kps_8"))[0][idx];
  for(int i=0;i<5;i++){
   double x=56+(TARGET[2*i]-56)*.85;
   double y=56+(TARGET[2*i+1]-56)*.85;
   points[2*i]=(float)(x*640.0/112/8-col);
   points[2*i+1]=(float)(y*640.0/112/8-row);
  }
 }
 public static void main(String[] args){
  Map<String,Object> m=emptyHeads();
  setFace(m,40,40,.98f);
  List<PhoneYuNetLandmarkDecoder.Face> hits=
    PhoneYuNetLandmarkDecoder.decode(m,112,112);
  yes(hits.size()==1,"authentic-shaped five-point tensor should decode one face");
  yes(hits.get(0).alignment.accepted,"decoded landmarks must pass native geometry gate");
  yes(Math.abs(hits.get(0).confidence-.98)<1e-4,"reference sqrt(cls*obj) score");
  yes(PhoneYuNetLandmarkDecoder.decode(emptyHeads(),112,112).isEmpty(),
      "empty model output must produce no trusted references");
  Map<String,Object> low=emptyHeads();setFace(low,40,40,.5f);
  yes(PhoneYuNetLandmarkDecoder.decode(low,112,112).isEmpty(),
      "weak detector cannot be promoted to verified alignment");
  Map<String,Object> duplicate=emptyHeads();
  setFace(duplicate,40,40,.98f);setFace(duplicate,40,41,.97f);
  yes(PhoneYuNetLandmarkDecoder.decode(duplicate,112,112).size()==1,
      "overlapping face detections must be deduplicated");
  Map<String,Object> wrong=emptyHeads();wrong.remove("kps_8");
  try {
   PhoneYuNetLandmarkDecoder.decode(wrong,112,112);
   throw new AssertionError("missing landmark head must fail closed");
  }catch(IllegalArgumentException expected){}
  try {
   PhoneYuNetLandmarkDecoder.decode(m,224,112);
   throw new AssertionError("rectangular input needs a separately verified mapping");
  }catch(IllegalArgumentException expected){}
  System.out.println("S9_YUNET_TWELVE_HEAD_LANDMARK_DECODER_SYNTHETIC_PASS");
 }
}
