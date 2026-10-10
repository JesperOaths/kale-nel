package nl.kalenel.s9security;

import android.graphics.Bitmap;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.util.*;

/** Anonymous on-phone outfit evidence for human review of repeat appearances.
 *
 * Uses only coarse RGB color histograms of the center torso and lower body.
 * No faces, names, facial embeddings, persistent biometric IDs, or network.
 * Matching outfits never means verified matching individuals.
 */
final class OutfitEvidence {
 private static final int BINS=8, CHANNELS=6, SIZE=48, MIN_FRAMES=3;
 private static final double MATCH_FLOOR=.965;
 private final List<float[]> samples=new ArrayList<>();

 private static float[] samplePatch(Bitmap img,float[] b,float verticalA,float verticalB){
  int w=img.getWidth(),h=img.getHeight();
  float top=b[0],left=b[1],bottom=b[2],right=b[3];
  int x0=(int)(w*(left+.22f*(right-left)));
  int x1=(int)(w*(left+.78f*(right-left)));
  int y0=(int)(h*(top+verticalA*(bottom-top)));
  int y1=(int)(h*(top+verticalB*(bottom-top)));
  if(x1<=x0+4||y1<=y0+4)return null;
  final int NX=16,NY=16;
  float[] bins=new float[24];
  int valid=0;
  double lum=0,lum2=0;
  for(int j=0;j<NY;j++)for(int i=0;i<NX;i++){
   int x=Math.max(0,Math.min(w-1,x0+(int)((i+.5)*((x1-x0)/(double)NX))));
   int y=Math.max(0,Math.min(h-1,y0+(int)((j+.5)*((y1-y0)/(double)NY))));
   int c=img.getPixel(x,y);
   int r=(c>>16)&255,g=(c>>8)&255,bb=c&255;
   double l=(r+g+bb)/3.0;
   lum+=l;lum2+=l*l;
   bins[r>>5]++;bins[8+(g>>5)]++;bins[16+(bb>>5)]++;
   valid++;
  }
  double mean=lum/valid;
  double stdev=Math.sqrt(Math.max(0,lum2/valid-mean*mean));
  if(mean<45||mean>218||stdev<11)return null;
  for(int i=0;i<24;i++)bins[i]/=valid;
  return bins;
 }

 /** Call only for isolated, strongly detected people on decoded sampled frames. */
 boolean add(Bitmap image,float[] box,float score){
  if(image==null||box==null||box.length!=4||score<.65f)return false;
  for(float v:box)if(Float.isNaN(v)||v<0||v>1)return false;
  if(box[2]-box[0]<.28f||box[3]-box[1]<.10f)return false;
  float[] torso=samplePatch(image,box,.23f,.49f);
  float[] legs=samplePatch(image,box,.61f,.89f);
  if(torso==null||legs==null)return false;
  float[] evidence=new float[SIZE];
  System.arraycopy(torso,0,evidence,0,24);
  System.arraycopy(legs,0,evidence,24,24);
  samples.add(evidence);
  return true;
 }

 private static float median(float[] v){
  Arrays.sort(v);
  return v.length%2==0?(v[v.length/2-1]+v[v.length/2])/2:v[v.length/2];
 }

 private float[] aggregate(){
  if(samples.size()<MIN_FRAMES)return null;
  float[] v=new float[SIZE];
  for(int i=0;i<SIZE;i++){
   float[] f=new float[samples.size()];
   for(int j=0;j<f.length;j++)f[j]=samples.get(j)[i];
   v[i]=median(f);
  }
  for(int c=0;c<CHANNELS;c++){
   float total=0;
   for(int k=0;k<BINS;k++)total+=v[c*BINS+k];
   if(total<.01)return null;
   for(int k=0;k<BINS;k++)v[c*BINS+k]/=total;
  }
  return v;
 }

 private static double similarity(float[] a,JSONArray b){
  if(a==null||b==null||b.length()!=SIZE)return -1;
  double same=0;
  for(int i=0;i<SIZE;i++){
   double other=b.optDouble(i,-1);
   if(!Double.isFinite(other)||other<0||other>1)return -1;
   same+=Math.min(a[i],other);
  }
  return same/CHANNELS;
 }

 private static long timestamp(String filename){
  if(!filename.startsWith("motion_")||!filename.endsWith(".mp4"))return -1;
  try{
   long n=Long.parseLong(filename.substring(7,filename.length()-4));
   return n>1500000000000L?n:-1;
  }catch(NumberFormatException ignored){return -1;}
 }

 private static JSONObject safeRead(File p)throws Exception{
  if(p.length()<80||p.length()>98000)return null;
  byte[] data=new byte[(int)p.length()];
  try(InputStream in=new FileInputStream(p)){
   int done=0;
   while(done<data.length){
    int n=in.read(data,done,data.length-done);
    if(n<0)return null;
    done+=n;
   }
  }
  return new JSONObject(new String(data,"UTF-8"));
 }

 private static final class Candidate {
  String name;double score;
  Candidate(String n,double s){name=n;score=s;}
 }

 /** Bounded local comparison; prevents face or outfit claims becoming verified IDs. */
 private static JSONArray reviewCandidates(File dir,String current,float[] evidence){
  JSONArray result=new JSONArray();
  long now=timestamp(current);
  if(now<0)return result;
  File[] others=dir.listFiles((d,n)->n.startsWith("motion_")&&n.endsWith(".mp4.verified.json"));
  if(others==null)return result;
  // Do not scan an unbounded SD directory or perform image/video redecoding.
  Arrays.sort(others,(a,b)->Long.compare(b.lastModified(),a.lastModified()));
  List<Candidate> top=new ArrayList<>();
  int checked=0;
  for(File f:others){
   if(checked++>=250)break;
   String clip=f.getName().substring(0,f.getName().length()-".verified.json".length());
   long other=timestamp(clip);
   if(clip.equals(current)||other<0||Math.abs(other-now)>12L*3600*1000)continue;
   try{
    JSONObject metadata=safeRead(f);
    if(metadata==null||!"clear_clothing_color_candidate".equals(metadata.optString("appearance_quality")))continue;
    if(metadata.optInt("frames_with_distinct_multiple_person_boxes",1)>0)continue;
    double score=similarity(evidence,metadata.optJSONArray("appearance_vector"));
    if(score>=MATCH_FLOOR)top.add(new Candidate(clip,score));
   }catch(Exception ignored){}
  }
  top.sort((a,b)->Double.compare(b.score,a.score));
  for(int i=0;i<Math.min(3,top.size());i++){
   Candidate c=top.get(i);
   JSONObject match=new JSONObject();
   try{
    match.put("clip",c.name);
    match.put("clothing_color_similarity",Math.round(c.score*10000)/10000.0);
    match.put("human_review_required",true);
    match.put("verified_same_person",false);
    match.put("claim","similar_outfit_not_identity");
    result.put(match);
   }catch(Exception ignored){}
  }
  return result;
 }

 void publish(JSONObject result,File folder,String name,boolean isolated)throws Exception{
  result.put("appearance_algorithm","S9_ondevice_coarse_torso_leg_RGB_histogram_v1");
  result.put("appearance_samples",samples.size());
  result.put("appearance_quality","insufficient_clear_single_person_samples");
  result.put("appearance_claim","similar_outfit_only_not_identified_person");
  result.put("possible_same_outfit_clips",new JSONArray());
  if(!isolated)return;
  float[] vector=aggregate();
  if(vector==null)return;
  JSONArray a=new JSONArray();
  for(float f:vector)a.put(Math.round(f*100000)/100000.0);
  result.put("appearance_quality","clear_clothing_color_candidate");
  result.put("appearance_vector",a);
  result.put("possible_same_outfit_clips",reviewCandidates(folder,name,vector));
 }
}
