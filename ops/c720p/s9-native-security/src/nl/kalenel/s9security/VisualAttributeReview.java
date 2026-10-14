package nl.kalenel.s9security;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.MediaMetadataRetriever;
import android.os.SystemClock;
import org.json.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Deterministic scene attributes and clip-local tracks. No identity model. */
public final class VisualAttributeReview {
 public static final String VERSION="original_4k_visual_attributes_v36";
 private static final int MAX_FRAMES=16;
 private static final class Evidence {
  final float[] hsvUpper=new float[32],hsvLower=new float[32];
  final float[] labUpper=new float[32],labLower=new float[32];
  final Map<Integer,Integer> paletteUpper=new HashMap<>(),paletteLower=new HashMap<>();
  double aspect,scale,depth;int samples;double best=-1,bestUpper=-1;JSONObject full,upper;
  final Map<String,Integer> objects=new TreeMap<>();
 }
 private static String sha(File file)throws Exception{
  MessageDigest d=MessageDigest.getInstance("SHA-256");
  try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))>0)d.update(b,0,n);}
  StringBuilder s=new StringBuilder();for(byte b:d.digest())s.append(String.format(Locale.US,"%02x",b&255));return s.toString();
 }
 private static float[] norm(float[] raw){
  float total=0;for(float x:raw)total+=x;
  float[] out=raw.clone();if(total>0)for(int i=0;i<out.length;i++)out[i]/=total;return out;
 }
 private static JSONArray array(float[] x)throws JSONException{JSONArray a=new JSONArray();for(float n:x)a.put((double)n);return a;}
 private static double linear(int c){double x=c/255.0;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);}
 private static double labf(double x){return x>.008856?Math.cbrt(x):7.787*x+16.0/116;}
 private static void histogram(Bitmap frame,float[] box,float top,float bottom,float[] hsv,float[] lab,Map<Integer,Integer> palette){
  int l=Math.max(0,(int)(box[1]*frame.getWidth())),r=Math.min(frame.getWidth(),(int)(box[3]*frame.getWidth()));
  int t=Math.max(0,(int)((box[0]+(box[2]-box[0])*top)*frame.getHeight()));
  int b=Math.min(frame.getHeight(),(int)((box[0]+(box[2]-box[0])*bottom)*frame.getHeight()));
  int step=Math.max(1,(int)Math.sqrt(Math.max(1,(r-l)*(b-t))/1600.0));float[] channels=new float[3];
  for(int y=t;y<b;y+=step)for(int x=l;x<r;x+=step){
   int rgb=frame.getPixel(x,y);Color.colorToHSV(rgb,channels);
   int hi=Math.min(7,(int)(channels[0]/45)),si=Math.min(1,(int)(channels[1]*2)),vi=Math.min(1,(int)(channels[2]*2));
   hsv[(hi*2+si)*2+vi]++;
   double rr=linear(Color.red(rgb)),gg=linear(Color.green(rgb)),bb=linear(Color.blue(rgb));
   double fx=labf((.4124564*rr+.3575761*gg+.1804375*bb)/.95047);
   double fy=labf(.2126729*rr+.7151522*gg+.0721750*bb);
   double fz=labf((.0193339*rr+.1191920*gg+.9503041*bb)/1.08883);
   int li=Math.max(0,Math.min(1,(int)((116*fy-16)/50)));
   int ai=Math.max(0,Math.min(3,(int)((500*(fx-fy)+128)/64)));
   int bi=Math.max(0,Math.min(3,(int)((200*(fy-fz)+128)/64)));
   lab[(li*4+ai)*4+bi]++;
   int colour=Color.rgb((Color.red(rgb)/32)*32+16,(Color.green(rgb)/32)*32+16,(Color.blue(rgb)/32)*32+16);
   palette.put(colour,palette.getOrDefault(colour,0)+1);
  }
 }
 private static JSONArray palette(Map<Integer,Integer> values)throws JSONException{
  List<Map.Entry<Integer,Integer>> all=new ArrayList<>(values.entrySet());
  all.sort((a,b)->{int x=Integer.compare(b.getValue(),a.getValue());return x!=0?x:Integer.compare(a.getKey(),b.getKey());});
  JSONArray result=new JSONArray();int total=0;for(int n:values.values())total+=n;
  for(int i=0;i<Math.min(3,all.size());i++){
   int rgb=all.get(i).getKey();float[] hsv=new float[3];Color.colorToHSV(rgb,hsv);
   String name=hsv[2]<.20?"black":hsv[1]<.16?(hsv[2]>.83?"white":"gray"):
    hsv[0]<20||hsv[0]>=345?"red":hsv[0]<45?"orange":hsv[0]<70?"yellow":hsv[0]<170?"green":
    hsv[0]<200?"cyan":hsv[0]<260?"blue":hsv[0]<300?"purple":"pink";
   result.put(new JSONObject().put("hex",String.format(Locale.US,"#%06x",rgb&0xffffff)).put("name",name)
     .put("fraction",all.get(i).getValue()/(double)Math.max(1,total)));
  }return result;
 }
 private static int[] pixels(Bitmap frame,float[] box,float bottom){
  int x=Math.max(0,(int)Math.floor(box[1]*frame.getWidth())),y=Math.max(0,(int)Math.floor(box[0]*frame.getHeight()));
  int r=Math.min(frame.getWidth(),(int)Math.ceil(box[3]*frame.getWidth()));
  int b=Math.min(frame.getHeight(),(int)Math.ceil((box[0]+(box[2]-box[0])*bottom)*frame.getHeight()));
  return new int[]{x,y,Math.max(x+1,r),Math.max(y+1,b)};
 }
 private static double luma(Bitmap f,int x,int y){int p=f.getPixel(x,y);return .299*Color.red(p)+.587*Color.green(p)+.114*Color.blue(p);}
 private static double sharpness(Bitmap f,int[] b){
  int step=Math.max(1,(int)Math.sqrt((b[2]-b[0])*(b[3]-b[1])/2500.0));double sum=0,squares=0;int n=0;
  for(int y=b[1]+1;y<b[3]-1;y+=step)for(int x=b[0]+1;x<b[2]-1;x+=step){
   double v=luma(f,x-1,y)+luma(f,x+1,y)+luma(f,x,y-1)+luma(f,x,y+1)-4*luma(f,x,y);
   sum+=v;squares+=v*v;n++;
  }return n==0?0:Math.max(0,squares/n-(sum/n)*(sum/n));
 }
 private static JSONObject crop(Bitmap frame,int[] b,File directory,String file,long ms,double sharp,double quality)throws Exception{
  Bitmap image=Bitmap.createBitmap(frame,b[0],b[1],b[2]-b[0],b[3]-b[1]);File target=new File(directory,file),temp=new File(directory,file+".partial");
  try{
   try(FileOutputStream out=new FileOutputStream(temp)){if(!image.compress(Bitmap.CompressFormat.JPEG,96,out))throw new IOException("jpeg_encode_failed");out.getFD().sync();}
   if(!temp.renameTo(target))throw new IOException("crop_atomic_rename_failed");
   return new JSONObject().put("name",file).put("bytes",target.length()).put("sha256",sha(target)).put("time_ms",ms)
    .put("source_box_pixels",new JSONArray(b)).put("width",b[2]-b[0]).put("height",b[3]-b[1])
    .put("laplacian_variance_native_pixels",sharp).put("quality",quality).put("resized",false).put("encoding","jpeg_quality_96");
  }finally{image.recycle();if(temp.exists())temp.delete();}
 }
 private static String zone(float[] b){float x=(b[1]+b[3])*.5f,y=b[2];return y<MotionGrid.markedTopAt(x)?"outside_garden":x<.333?"garden_left":x>.667?"garden_right":"garden_middle";}
 /** Original MP4 remains immutable. A separate sidecar never edits human review. */
 public static JSONObject process(File video,ClipClassifier classifier,BooleanSupplier safe)throws Exception{
  if(!video.getName().matches("motion_[0-9]{13}[.]mp4")||!safe.getAsBoolean())throw new IOException("visual_review_guard");
  long started=SystemClock.elapsedRealtime(),length=video.length();String digest=sha(video);
  File folder=video.getParentFile(),crops=new File(folder,"VisualCrops");
  if(!crops.isDirectory()&&!crops.mkdir())throw new IOException("visual_crop_directory_unavailable");
  MediaMetadataRetriever media=new MediaMetadataRetriever();AnonymousClipTracks tracks=new AnonymousClipTracks();
  Map<Integer,Evidence> evidence=new LinkedHashMap<>();int decoded=0;String decoderBackend="";
  try{
   media.setDataSource(video.getAbsolutePath());
   int w=Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
   int h=Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
   long duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
   if(w!=3840||h!=2160||duration<1000||duration>125000)throw new IOException("source_is_not_original_4k");
   int samples=(int)Math.min(MAX_FRAMES,Math.max(8,(duration+749)/750));
   try(Native4KFrames hardware=new Native4KFrames(video)){
    for(int n=0;n<samples;n++){
     if(!safe.getAsBoolean()||SystemClock.elapsedRealtime()-started>65000)throw new IOException("visual_review_yielded_to_capture_or_thermal_guard");
     long requested=(long)((n+.5)*duration/samples);Bitmap frame=null;long at=requested;
     try{
      Native4KFrames.Frame nativeFrame=hardware.frame(requested*1000,safe);frame=nativeFrame.bitmap;at=nativeFrame.ptsUs/1000;decoderBackend=hardware.decoderName();
      if(frame==null)continue;
      if(frame.getWidth()!=w||frame.getHeight()!=h)throw new IOException("decoded_frame_not_native_4k");
      if(at<=lastTime(tracks))continue;
      List<AnonymousClipTracks.Hit> hits=classifier.visualPeople(frame);tracks.addFrame(at,hits);decoded++;
      for(AnonymousClipTracks.Track track:tracks.tracks())if(track.lastMs==at){
       Evidence e=evidence.get(track.id);if(e==null){e=new Evidence();evidence.put(track.id,e);}
       float[] box=track.lastBox;
       histogram(frame,box,.20f,.55f,e.hsvUpper,e.labUpper,e.paletteUpper);
       histogram(frame,box,.55f,.95f,e.hsvLower,e.labLower,e.paletteLower);
       e.samples++;e.aspect+=(box[3]-box[1])*w/((box[2]-box[0])*h);e.scale+=box[2]-box[0];
       e.depth+=(box[2]-MotionGrid.markedTopAt((box[1]+box[3])*.5f))/Math.max(.01,1-MotionGrid.markedTopAt((box[1]+box[3])*.5f));
       JSONArray objects=classifier.visualObjectEvidence();Set<String> seenObjects=new HashSet<>();
       for(int k=0;k<objects.length();k++){
        JSONObject object=objects.getJSONObject(k);JSONArray ob=object.getJSONArray("box");
        double dx=Math.abs((ob.getDouble(1)+ob.getDouble(3)-box[1]-box[3])*.5);
        double dy=Math.abs((ob.getDouble(0)+ob.getDouble(2)-box[0]-box[2])*.5);
        if(dx<Math.max(.06,box[3]-box[1])&&dy<(box[2]-box[0])*.75)seenObjects.add(object.getString("label"));
       }
       for(String object:seenObjects)e.objects.put(object,e.objects.getOrDefault(object,0)+1);
       int[] bounds=pixels(frame,box,1);double sharp=sharpness(frame,bounds);
       double size=Math.min(1,(bounds[2]-bounds[0])*(bounds[3]-bounds[1])/600000.0);
       double central=1-Math.min(1,Math.hypot((box[1]+box[3])*.5-.5,(box[0]+box[2])*.5-.5));
       double clipped=box[0]<.005||box[1]<.005||box[2]>.995||box[3]>.995?.5:1;
       double quality=(.6*sharp/(sharp+150)+.25*size+.15*central)*clipped;
       String prefix=video.getName()+".t"+track.id+"."+digest.substring(0,12)+"."+at;
       if(quality>e.best){
        e.full=crop(frame,bounds,crops,prefix+".full.jpg",at,sharp,quality);
        e.best=quality;
       }
       int[] upper=pixels(frame,box,.55f);double upperSharp=sharpness(frame,upper);
       double upperQuality=(.6*upperSharp/(upperSharp+150)+.25*Math.min(1,(upper[2]-upper[0])*(upper[3]-upper[1])/200000.0)+.15*central)*clipped;
       if(upperQuality>e.bestUpper){
        e.upper=crop(frame,upper,crops,prefix+".upper.jpg",at,upperSharp,upperQuality);e.bestUpper=upperQuality;
       }
      }
     }finally{if(frame!=null)frame.recycle();}
    }
   }
   if(decoded<3||!safe.getAsBoolean()||video.length()!=length||!sha(video).equals(digest))throw new IOException("visual_source_changed_or_incomplete");
   JSONArray summaries=new JSONArray();
   for(AnonymousClipTracks.Track t:tracks.tracks()){
    Evidence e=evidence.get(t.id);if(e==null)continue;
    summaries.put(new JSONObject().put("track_id",t.id).put("first_ms",t.firstMs).put("last_ms",t.lastMs).put("samples",t.samples)
     .put("upper_hsv32",array(norm(e.hsvUpper))).put("lower_hsv32",array(norm(e.hsvLower)))
     .put("upper_lab32",array(norm(e.labUpper))).put("lower_lab32",array(norm(e.labLower)))
     .put("upper_palette",palette(e.paletteUpper)).put("lower_palette",palette(e.paletteLower))
     .put("entry_zone",zone(t.firstBox)).put("exit_zone",zone(t.lastBox)).put("direction",t.imageDirection())
     .put("image_speed_body_heights_s",t.imageSpeedBodyHeightsPerSecond()==null?JSONObject.NULL:t.imageSpeedBodyHeightsPerSecond())
     .put("movement_vector",new JSONArray(new double[]{(t.lastBox[1]+t.lastBox[3]-t.firstBox[1]-t.firstBox[3])*.5,(t.lastBox[0]+t.lastBox[2]-t.firstBox[0]-t.firstBox[2])*.5}))
     .put("mean_box_aspect_ratio",e.aspect/e.samples).put("mean_box_height_image_fraction",e.scale/e.samples)
     .put("mean_garden_depth_fraction",e.depth/e.samples).put("object_association_status","nearby_object_candidates_not_confirmed_interaction")
     .put("nearby_object_frames",new JSONObject(e.objects)).put("with_bicycle_candidate",e.objects.getOrDefault("bicycle",0)>=2)
     .put("with_animal_candidate",e.objects.getOrDefault("dog",0)+e.objects.getOrDefault("cat",0)>=2)
     .put("carrying_parcel",JSONObject.NULL).put("parcel_status","not_supported_by_object_model")
     .put("full_crop",e.full).put("upper_crop",e.upper));
   }
   JSONObject result=new JSONObject().put("version",VERSION).put("name",video.getName()).put("bytes",length).put("sha256",digest)
    .put("width",w).put("height",h).put("duration_ms",duration).put("decoded_native_frames",decoded).put("decoder",decoderBackend)
    .put("processed_on","SM-G965F").put("timestamp_basis","decoded_frame_presentation_timestamp")
    .put("elapsed_ms",SystemClock.elapsedRealtime()-started)
    .put("count_version",AnonymousClipTracks.COUNT_VERSION).put("peak_simultaneous",tracks.peakConcurrentPeople())
    .put("repeated_simultaneous",tracks.repeatedConcurrentPeople()).put("tracklet_count",tracks.appearances())
    .put("count_is_sampled_lower_bound",true).put("identity_matching",false).put("tracks",summaries);
   File sidecar=new File(folder,video.getName()+".visual-v36.json");
   ClipClassifier.writeJson(sidecar,result);
   File verified=new File(folder,video.getName()+".verified.json");
   if(verified.isFile()&&verified.length()<128000){
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    try(InputStream in=new FileInputStream(verified)){byte[] b=new byte[8192];int n;while((n=in.read(b))>0){bytes.write(b,0,n);if(bytes.size()>128000)throw new IOException("verified_manifest_changed");}}
    JSONObject prior=new JSONObject(bytes.toString("UTF-8"));
    if(prior.optString("sha256").equals(digest)&&prior.optLong("bytes")==length){
     prior.put("visual_attributes_version",VERSION).put("visual_attributes_sidecar",sidecar.getName())
      .put("visual_attributes_sha256",sha(sidecar)).put("visual_repeated_simultaneous",tracks.repeatedConcurrentPeople());
     ClipClassifier.writeJson(verified,prior);
    }
   }return result;
  }finally{media.release();}
 }
 private static long lastTime(AnonymousClipTracks tracks){long last=-1;for(AnonymousClipTracks.Track t:tracks.tracks())last=Math.max(last,t.lastMs);return last;}
}
