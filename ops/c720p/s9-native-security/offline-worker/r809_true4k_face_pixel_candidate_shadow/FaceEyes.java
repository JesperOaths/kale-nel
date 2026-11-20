import ai.onnxruntime.*;
import android.graphics.*;
import java.util.*;
import java.nio.*;
class FaceEyes implements AutoCloseable{
 static int[] stats=new int[8];
 // Anonymous score maxima/counts across the entire YuNet ONNX output grid.
 // Does not export any image, face coordinate or biometric descriptor.
 static double[] peakByMode=new double[2];
 static int[] scoreBinsByMode=new int[8];
 final OrtEnvironment env;final OrtSession session;
 final int[] px=new int[640*640];final FloatBuffer buffer;
 FaceEyes()throws Exception{
  String model=SFaceTrial.DIR+"yunet.onnx";
  SFaceTrial.need(SFaceTrial.sha(SFaceTrial.read(model)).equals("8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),"detector_digest");
  env=OrtEnvironment.getEnvironment();try(OrtSession.SessionOptions opts=new OrtSession.SessionOptions()){
   opts.setIntraOpNumThreads(1);opts.setInterOpNumThreads(1);session=env.createSession(model,opts);
  }
  buffer=ByteBuffer.allocateDirect(3*640*640*4).order(ByteOrder.nativeOrder()).asFloatBuffer();
 }
 static final class Face{
  double x,y,w,h,score,eye,midX,midY,roll;float[] landmarks=new float[10];
  double iou(Face b){double iw=Math.max(0,Math.min(x+w,b.x+b.w)-Math.max(x,b.x)),ih=Math.max(0,Math.min(y+h,b.y+b.h)-Math.max(y,b.y));double i=iw*ih;return i/(w*h+b.w*b.h-i+1e-9);}
 }
 static FloatBuffer head(OrtSession.Result out,String name){return ((OnnxTensor)out.get(name).get()).getFloatBuffer();}
 Face locate(Bitmap src)throws Exception{
  Face f=onePass(src,640);
  if(f!=null)return f;
  stats[5]++;
  f=onePass(src,320);
  if(f!=null)stats[6]++;
  return f;
 }
 Face onePass(Bitmap src,int dimension)throws Exception{
  stats[0]++;
  if(src.getWidth()!=src.getHeight()){stats[1]++;return null;}
  // R805 isolated shadow: full 640x640 tensor in both modes.
  // 320 mode is blur/downsample then upscale back to model 640 geometry.
  Bitmap low=Bitmap.createScaledBitmap(src,dimension,dimension,true);
  Bitmap b=dimension==320
      ? Bitmap.createScaledBitmap(low,640,640,true) : low;
  if(low!=b && low!=src)low.recycle();
  b.getPixels(px,0,640,0,0,640,640);if(b!=src)b.recycle();
  for(int c=0;c<3;c++)for(int y=0;y<640;y++)for(int x=0;x<640;x++)
   buffer.put(c*640*640+y*640+x,(px[y*640+x]>>(8*c))&255);
  ArrayList<Face> found=new ArrayList<>();double sc=src.getWidth()/640.0;
  try(OnnxTensor t=OnnxTensor.createTensor(env,buffer,new long[]{1,3,640,640});OrtSession.Result res=session.run(Collections.singletonMap("input",t))){
   for(int st:new int[]{8,16,32}){
    int width=640/st;FloatBuffer cls=head(res,"cls_"+st),obj=head(res,"obj_"+st);
    FloatBuffer box=head(res,"bbox_"+st),kp=head(res,"kps_"+st);
    for(int y=0;y<640/st;y++)for(int x=0;x<640/st;x++){
     int k=y*width+x;double score=Math.sqrt(cls.get(k)*obj.get(k));
     if(Double.isFinite(score)){
       int mode=dimension==320?1:0;
       if(score>peakByMode[mode])peakByMode[mode]=score;
       if(score>=.20)scoreBinsByMode[4*mode]++;
       if(score>=.50)scoreBinsByMode[4*mode+1]++;
       if(score>=.70)scoreBinsByMode[4*mode+2]++;
       if(score>=.85)scoreBinsByMode[4*mode+3]++;
     }
     if(!Double.isFinite(score)||score<.82)continue;
     Face v=new Face();v.score=score;v.w=Math.exp(box.get(4*k+2))*st*sc;v.h=Math.exp(box.get(4*k+3))*st*sc;
     v.x=(x+box.get(4*k))*st*sc-v.w*.5;v.y=(y+box.get(4*k+1))*st*sc-v.h*.5;
     for(int landmark=0;landmark<5;landmark++){
      v.landmarks[landmark*2]=(float)((x+kp.get(10*k+landmark*2))*st*sc);
      v.landmarks[landmark*2+1]=(float)((y+kp.get(10*k+landmark*2+1))*st*sc);
     }
     double lx=v.landmarks[0],ly=v.landmarks[1];
     double rx=v.landmarks[2],ry=v.landmarks[3];
     if(rx<lx){double z=rx;rx=lx;lx=z;z=ry;ry=ly;ly=z;}
     v.eye=Math.hypot(rx-lx,ry-ly);v.midX=(lx+rx)*.5;v.midY=(ly+ry)*.5;v.roll=Math.atan2(ry-ly,rx-lx);
     if(v.w>=16&&v.h>=16&&lx>=0&&rx<src.getWidth()&&Math.min(ly,ry)>=0&&Math.max(ly,ry)<src.getHeight())found.add(v);
    }
   }
  }
  if(found.isEmpty()){stats[2]++;return null;}
  found.sort((a,c)->Double.compare(c.score,a.score));Face top=found.get(0);
  for(Face f:found)if(top.iou(f)<.30){stats[3]++;return null;}
  stats[4]++;return top;
 }
 public void close()throws Exception{session.close();}
}
