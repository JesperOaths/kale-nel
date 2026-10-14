package nl.kalenel.s9security;

import java.util.ArrayList;
import java.util.List;

/** Pure geometry for bounded original-frame face evidence. No identity decisions. */
final class S9FaceGeometry {
 static final class Region {
  final int left,top,right,bottom,proposal;
  Region(int left,int top,int right,int bottom,int proposal){
   this.left=left;this.top=top;this.right=right;this.bottom=bottom;this.proposal=proposal;
  }
  int width(){return right-left;}
  int height(){return bottom-top;}
 }
 private static double clamp(double n,double low,double high){return Math.max(low,Math.min(high,n));}
 static float[] normalizedBox(float[] box){
  if(box==null||box.length!=4)return null;
  for(float n:box)if(!Float.isFinite(n))return null;
  float[] result=new float[4];
  for(int i=0;i<4;i++)result[i]=(float)clamp(box[i],0,1);
  return result[2]>result[0]&&result[3]>result[1]?result:null;
 }
 static List<Region> headRegions(int width,int height,List<float[]> boxes,int limit){
  ArrayList<Region> result=new ArrayList<>();
  if(width<2||height<2||boxes==null||limit<=0)return result;
  // Inference supplies at most a few boxes. Ignore unbounded/malicious extra rows.
  for(int i=0;i<Math.min(40,boxes.size())&&result.size()<limit;i++){
   float[] b=normalizedBox(boxes.get(i));if(b==null)continue;
   double w=(b[3]-b[1])*width,h=(b[2]-b[0])*height;
   if(w<12||h<24)continue;
   int left=(int)Math.floor(clamp(b[1]*width-w*.22,0,width));
   int right=(int)Math.ceil(clamp(b[3]*width+w*.22,0,width));
   int top=(int)Math.floor(clamp(b[0]*height-h*.08,0,height));
   // Upper body leaves room for leaning heads and imperfect person boundaries.
   int bottom=(int)Math.ceil(clamp(b[0]*height+h*.55,0,height));
   Region region=new Region(left,top,right,bottom,i);
   if(region.width()<16||region.height()<16)continue;
   boolean duplicate=false;
   for(Region old:result)if(iou(old,region)>=.85){duplicate=true;break;}
   if(!duplicate)result.add(region);
  }
  return result;
 }
 static int[] detectorSize(Region region,int maxSide,int maxPixels){
  if(region==null||region.width()<2||region.height()<2||maxSide<2||maxPixels<4)return null;
  double scale=Math.min(1,Math.min(maxSide/(double)Math.max(region.width(),region.height()),
     Math.sqrt(maxPixels/((double)region.width()*region.height()))));
  // Android's FaceDetector requires an even width; preserve independent x/y scales.
  int width=((int)Math.floor(region.width()*scale))&~1;
  int height=(int)Math.floor(region.height()*scale);
  return width>=2&&height>=2?new int[]{width,height}:null;
 }
 static Region faceCrop(int width,int height,double x,double y,double eyes,int minimum){
  if(width<minimum||height<minimum||!Double.isFinite(x)||!Double.isFinite(y)||
     !Double.isFinite(eyes)||eyes<=0||x<0||x>=width||y<0||y>=height)return null;
  int side=(int)Math.min(Math.min(width,height),Math.round(eyes*3.5));
  if(side<minimum)return null;
  int left=(int)clamp(Math.round(x-side*.5),0,width-side);
  int top=(int)clamp(Math.round(y-side*.43),0,height-side);
  return new Region(left,top,left+side,top+side,-1);
 }
 static double iou(Region a,Region b){
  double intersection=(double)Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
     Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  double union=(double)a.width()*a.height()+(double)b.width()*b.height()-intersection;
  return union>0?intersection/union:0;
 }
 static boolean sameFace(Region a,Region b){
  if(a==null||b==null)return false;
  if(iou(a,b)>=.35)return true;
  double largest=Math.max(a.width(),b.width()),smallest=Math.min(a.width(),b.width());
  return smallest>=largest*.5&&Math.abs((a.left+a.right)-(b.left+b.right))<largest*.4&&
    Math.abs((a.top+a.bottom)-(b.top+b.bottom))<largest*.4;
 }
 static boolean recognitionGeometry(float confidence,double nativeEyes,float yaw,float roll){
  return Float.isFinite(confidence)&&Double.isFinite(nativeEyes)&&Float.isFinite(yaw)&&
    Float.isFinite(roll)&&confidence>=.65f&&nativeEyes>=24&&Math.abs(yaw)<=20&&Math.abs(roll)<=17;
 }
 static int owner(double x,double y,int width,int height,List<float[]> boxes){
  if(boxes==null||width<=0||height<=0||!Double.isFinite(x)||!Double.isFinite(y))return -1;
  int match=-1;double nx=x/width,ny=y/height;
  for(int i=0;i<Math.min(40,boxes.size());i++){
   float[] b=normalizedBox(boxes.get(i));if(b==null)continue;
   if(nx<b[1]||nx>b[3]||ny<b[0]-(b[2]-b[0])*.08||ny>b[2])continue;
   // Overlap cannot prove which person owns a detected face.
   if(match>=0)return -1;
   match=i;
  }
  return match;
 }
 static float[] box(Region r,int width,int height){
  return new float[]{r.top/(float)height,r.left/(float)width,r.bottom/(float)height,r.right/(float)width};
 }
}
