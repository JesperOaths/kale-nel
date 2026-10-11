package nl.kalenel.s9security;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.os.SystemClock;
import android.util.Log;
import org.json.*;
import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.gpu.GpuDelegate;
import java.io.*;
import java.nio.*;
import java.util.*;
import java.security.MessageDigest;

/** Offline after-motion clip classification. Optional local face review; no cloud. */
public final class ClipClassifier {
 private final Context app;
 private Interpreter net;
 private GpuDelegate delegate;
 private ByteBuffer input;
 private volatile String backend="uninitialized";
 private String modelSha256="";
 private final float[][][] boxes=new float[1][10][4];
 private final float[][] classes=new float[1][10],scores=new float[1][10];
 private final float[] count=new float[1];
 private final ArrayList<String> labels=new ArrayList<>();
 private final Map<Integer,Object> outputs=new HashMap<>();
 ClipClassifier(Context c){app=c; }
 // Safe to query from the camera status thread without holding the TFLite lock.
 String inferenceBackend(){return backend;}
 // Construct and validate the live-gate TFLite interpreter before motion.
 // Call exclusively on the dedicated phone inference worker.
 public synchronized void warmPersonGate()throws Exception{init();}
 
 private void init()throws Exception{
  if(net!=null)return;
  try(InputStream in=app.getAssets().open("labelmap.txt");BufferedReader br=new BufferedReader(new InputStreamReader(in))){
   String l;while((l=br.readLine())!=null)labels.add(l.trim().toLowerCase(Locale.US));
  }
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();
  try(InputStream in=app.getAssets().open("detect.tflite")){
   byte[] b=new byte[32768];int n;while((n=in.read(b))>0){
    bytes.write(b,0,n);
    if(bytes.size()>10000000)throw new IOException("ML_asset_too_large");
   }
  }
  byte[] modelBytes=bytes.toByteArray();
  MessageDigest modelMd=MessageDigest.getInstance("SHA-256");
  StringBuilder fingerprint=new StringBuilder();
  for(byte x:modelMd.digest(modelBytes))fingerprint.append(String.format(Locale.US,"%02x",x&255));
  modelSha256=fingerprint.toString();
  ByteBuffer model=ByteBuffer.allocateDirect(bytes.size()).order(ByteOrder.nativeOrder());
  model.put(modelBytes);model.rewind();
  try{
   delegate=new GpuDelegate();
   net=new Interpreter(model,new Interpreter.Options().addDelegate(delegate).setNumThreads(2));
   backend="gpu";
  }catch(Throwable gpuFailure){
   if(delegate!=null){try{delegate.close();}catch(Throwable ignored){}delegate=null;}
   net=null;
   net=new Interpreter(model,new Interpreter.Options().setNumThreads(2));
   backend="cpu";
   Log.w("S9SEC","gpu_fallback_"+gpuFailure.getClass().getSimpleName());
  }
  input=ByteBuffer.allocateDirect(300*300*3).order(ByteOrder.nativeOrder());
  outputs.put(0,boxes);outputs.put(1,classes);outputs.put(2,scores);outputs.put(3,count);
 }
 private String label(int category){
  int id=category+1; // COCO quant detector labels use a placeholder at index zero.
  return id>=0&&id<labels.size()?labels.get(id):"unknown";
 }
 private static final class Detection {
  String label;float score;float[] box;
 }
 private static boolean samePersonBox(float[] a,float[] b){
  if(a==null||b==null||a.length!=4||b.length!=4)return false;
  float top=Math.max(a[0],b[0]),left=Math.max(a[1],b[1]);
  float bottom=Math.min(a[2],b[2]),right=Math.min(a[3],b[3]);
  float intersection=Math.max(0,bottom-top)*Math.max(0,right-left);
  float areaA=Math.max(0,a[2]-a[0])*Math.max(0,a[3]-a[1]);
  float areaB=Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);
  float union=areaA+areaB-intersection;
  if(union>0&&intersection/union>=0.45f)return true;
  float ax=(a[1]+a[3])/2,ay=(a[0]+a[2])/2;
  float bx=(b[1]+b[3])/2,by=(b[0]+b[2])/2;
  return Math.abs(ax-bx)<0.05f&&Math.abs(ay-by)<0.05f;
 }
 private List<Detection> detect(Bitmap original)throws Exception{
  Bitmap scaled=Bitmap.createScaledBitmap(original,300,300,true);
  try{
   int[] pixels=new int[300*300];scaled.getPixels(pixels,0,300,0,0,300,300);
   input.rewind();
   for(int rgb:pixels){
    input.put((byte)((rgb>>16)&255));
    input.put((byte)((rgb>>8)&255));
    input.put((byte)(rgb&255));
   }
   input.rewind();
   net.runForMultipleInputsOutputs(new Object[]{input},outputs);
   ArrayList<Detection> found=new ArrayList<>();
   int total=Math.min(10,Math.max(0,Math.round(count[0])));
   for(int i=0;i<total;i++){
    float confidence=scores[0][i];if(confidence<0.30f)continue;
    Detection d=new Detection();
    d.label=label(Math.round(classes[0][i]));
    d.score=confidence;d.box=boxes[0][i].clone();
    found.add(d);
   }
   return found;
  }finally{if(scaled!=original)scaled.recycle();}
 }

 /** Preview-only per-event person gate. The same 300x300 MobileNet detector,
  * shared with post-record classification on the serialized review worker.
  * No face recognition, cross-recording identification, or persistent IDs.
  */
 public synchronized float personScoreInGarden(byte[] jpeg,float top,float margin)throws Exception{
  if(jpeg==null||jpeg.length<1000||top<0||top>1||margin<0||margin>.3f)
   throw new IllegalArgumentException("invalid_preview_or_region");
  init();
  Bitmap bitmap=BitmapFactory.decodeByteArray(jpeg,0,jpeg.length);
  if(bitmap==null)throw new IOException("invalid_preview_jpeg");
  try{
   float highest=0f;
   for(Detection detection:detect(bitmap)){
    if(!"person".equals(detection.label))continue;
    float[] b=detection.box;
    if(b==null||b.length!=4)continue;
    float center=(b[1]+b[3])*0.5f;
    float feet=b[2];
    if(center<margin||center>1f-margin||feet<top||feet>1.02f)continue;
    highest=Math.max(highest,detection.score);
   }
   return highest;
  }finally{bitmap.recycle();}
 }

 /** Lightweight RGB upper-torso tag; deliberately excludes face and has no identity features. */
 private static String upperClothingColour(Bitmap image,float[] b){
  if(image==null||b==null||b.length!=4)return "uncertain";
  int w=image.getWidth(),h=image.getHeight();
  int x0=Math.max(0,Math.min(w-1,(int)(w*(b[1]+.26f*(b[3]-b[1])))));
  int x1=Math.max(0,Math.min(w,(int)(w*(b[1]+.74f*(b[3]-b[1])))));
  int y0=Math.max(0,Math.min(h-1,(int)(h*(b[0]+.27f*(b[2]-b[0])))));
  int y1=Math.max(0,Math.min(h,(int)(h*(b[0]+.52f*(b[2]-b[0])))));
  if(x1-x0<5||y1-y0<5)return "uncertain";
  int[] votes=new int[11];int readable=0;
  for(int yy=0;yy<12;yy++)for(int xx=0;xx<12;xx++){
   int px=x0+(int)((xx+.5)*(x1-x0)/12),py=y0+(int)((yy+.5)*(y1-y0)/12);
   int c=image.getPixel(Math.min(w-1,px),Math.min(h-1,py));
   int rr=(c>>16)&255,gg=(c>>8)&255,bb=c&255;
   int hi=Math.max(rr,Math.max(gg,bb)),lo=Math.min(rr,Math.min(gg,bb));
   int delta=hi-lo;
   if(hi<28)continue; // too dark for a useful clothing estimate
   int slot;
   if(delta<22)slot=hi>205?1:hi<72?0:2; // white, black, gray
   else if(rr>gg*1.38&&rr>bb*1.35)slot=3; // red
   else if(rr>gg*1.15&&gg>bb*1.35)slot=4; // orange
   else if(rr>175&&gg>155&&bb<gg*.70)slot=5; // yellow
   else if(gg>rr*1.18&&gg>bb*1.09)slot=6; // green
   else if(bb>rr*1.2&&bb>gg*1.12)slot=7; // blue
   else if(rr>gg*1.13&&bb>gg*1.13)slot=8; // purple/pink
   else if(rr>65&&gg>35&&rr>bb*1.24)slot=9; // brown
   else slot=10;
   votes[slot]++;readable++;
  }
  if(readable<35)return "uncertain";
  int winner=10;
  for(int i=0;i<votes.length;i++)if(votes[i]>votes[winner])winner=i;
  if(votes[winner]<readable*.38)return "uncertain";
  String[] names={"black","white","gray","red","orange","yellow","green","blue","purple_or_pink","brown","uncertain"};
  return names[winner];
 }
 private static JSONArray anonymousTracksJson(AnonymousClipTracks all)throws JSONException{
  JSONArray output=new JSONArray();
  for(AnonymousClipTracks.Track t:all.tracks()){
   JSONObject item=new JSONObject();
   item.put("id","Person "+t.id).put("temporary_track_id",t.id)
    .put("first_sample_ms",t.firstMs).put("last_sample_ms",t.lastMs)
    .put("sample_count",t.samples)
    .put("peak_detection_score",Math.round(t.peakConfidence*1000)/1000.0)
    .put("upper_clothing_colour",t.colour())
    .put("cross_recording_identity","not_attempted");
   output.put(item);
  }
  return output;
 }

 /** Refresh an existing motion thumbnail using the strongest person
  * observation in its saved sample timeline. Decode ONE frame on the S9+,
  * then crop out the distant street. Keep the old JPEG for rollback.
  */
 public synchronized boolean rebuildGardenThumbnail(File video,File folder,
                                                    JSONObject manifest)throws Exception{
  if(video==null||!video.isFile()||manifest==null||
     "foreground_garden_motion".equals(manifest.optString("thumbnail_focus")))
   return false;
  MediaMetadataRetriever media=new MediaMetadataRetriever();
  Bitmap bitmap=null;
  try{
   media.setDataSource(video.getAbsolutePath());
   long duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
   if(duration<1500)return false;
   long at=duration/2;
   double high=-1;
   JSONArray samples=manifest.optJSONArray("person_sample_timeline");
   if(samples!=null)for(int i=0;i<samples.length();i++){
    JSONObject sample=samples.optJSONObject(i);
    if(sample==null)continue;
    double weight=sample.optDouble("person_peak_score",0)+
         (sample.optInt("people_at_050",0)>0?10.0:0.0);
    if(weight>high){high=weight;at=sample.optLong("time_ms",at);}
   }
   at=Math.max(0,Math.min(duration-1,at));
   bitmap=media.getFrameAtTime(at*1000,MediaMetadataRetriever.OPTION_CLOSEST);
   if(bitmap==null)return false;
   float[] personBox=null;
   float peak=0;
   for(Detection d:detect(bitmap)){
    if(!"person".equals(d.label)||d.score<.30f)continue;
    float[] box=d.box;
    if(box==null||box.length!=4||box[2]<.64f)continue;
    float cx=(box[1]+box[3])*.5f;
    if(cx<.045f||cx>.955f||d.score<=peak)continue;
    peak=d.score;personBox=box;
   }
   Bitmap thumbnail=makeGardenThumbnail(bitmap,personBox);
   String name=video.getName();
   File dest=new File(folder,name+".thumb.jpg");
   File tmp=new File(folder,name+".thumb.garden-partial");
   File backup=new File(folder,name+".thumb.previous-garden.jpg");
   try{
    try(FileOutputStream output=new FileOutputStream(tmp)){
     thumbnail.compress(Bitmap.CompressFormat.JPEG,88,output);
     output.getFD().sync();
    }
   }finally{thumbnail.recycle();}
   if(!tmp.isFile()||tmp.length()<1000)throw new IOException("garden_thumbnail_empty");
   boolean backed=false;
   if(dest.exists()&&!backup.exists()){
    if(!dest.renameTo(backup))throw new IOException("original_thumbnail_backup_failed");
    backed=true;
   }
   if(!tmp.renameTo(dest)){
    if(backed)backup.renameTo(dest);
    throw new IOException("garden_thumbnail_promotion_failed");
   }
   manifest.put("thumbnail",dest.getName())
     .put("thumbnail_focus","foreground_garden_motion")
     .put("thumbnail_source_time_ms",at)
     .put("thumbnail_garden_person_confidence",Math.round(peak*1000f)/1000.0)
     .put("thumbnail_person_candidate_in_garden",personBox!=null);
   writeJson(new File(folder,name+".verified.json"),manifest);
   return true;
  }finally{
   if(bitmap!=null)bitmap.recycle();
   media.release();
  }
 }

 /** Secondary retention pass. The on-phone model examines 24 points in
  * the original video; no decoding is performed on the C720P. A single weak
  * person box touching the garden is sufficient to KEEP the clip.
  * No model result can conclusively prove absence of a person: "no evidence"
  * is handled as reversible quarantine only, never immediate deletion.
  */
 public synchronized JSONObject gardenRetentionProbe(File video,float top,float margin)throws Exception{
  if(video==null||!video.isFile()||top<.4f||top>.85f)throw new IllegalArgumentException("invalid_video_or_roi");
  init();
  MediaMetadataRetriever grabber=new MediaMetadataRetriever();
  int frames=0,personFrames=0,anyPersonFrames=0;
  float maximumGardenScore=0f;
  try{
   grabber.setDataSource(video.getAbsolutePath());
   String durationText=grabber.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
   long duration=Long.parseLong(durationText);
   if(duration<2500||duration>600000)throw new IOException("unsupported_clip_duration");
   for(int i=0;i<24;i++){
    long micros=(long)(((i+.5)/24.0)*duration*1000);
    Bitmap still=grabber.getFrameAtTime(micros,MediaMetadataRetriever.OPTION_CLOSEST);
    if(still==null)continue;
    try{
     frames++;
     boolean garden=false,any=false;
     for(Detection d:detect(still)){
      if(!"person".equals(d.label)||d.score<.30f)continue;
      any=true;
      float[] b=d.box;
      if(b!=null&&b.length==4&&(b[1]+b[3])*.5f>=margin&&
         (b[1]+b[3])*.5f<=1f-margin&&b[2]>=top){
       garden=true;
       maximumGardenScore=Math.max(maximumGardenScore,d.score);
      }
     }
     if(garden)personFrames++;
     if(any)anyPersonFrames++;
    }finally{still.recycle();}
   }
  }finally{grabber.release();}
  return new JSONObject().put("model","ssd_mobilenet_garden_retention_v1")
   .put("valid_frames",frames).put("garden_person_frames_at_030",personFrames)
   .put("any_person_frames_at_030",anyPersonFrames)
   .put("peak_garden_person_score",maximumGardenScore)
   .put("decision",frames<20?"uncertain_incomplete_samples":
      personFrames>0?"retain_possible_garden_person":"no_garden_person_evidence");
 }
 public synchronized JSONObject process(File mp4, File folder, String name, String trigger, long motionEvents)throws Exception{
  long begin=SystemClock.elapsedRealtime();
  JSONObject result=new JSONObject();
  result.put("name",name).put("bytes",mp4.length()).put("sha256",digest(mp4));
  result.put("archive","S9_microSD_only").put("review_version","ssd_mobilenet_coco_v1_post4k_v2_outfit_review");
  result.put("motion_trigger",trigger).put("motion_events",motionEvents);
  result.put("auto_identity_status","appearance_based_identity_not_verified");
  MediaMetadataRetriever media=new MediaMetadataRetriever();
  int persons=0,animals=0,vehicles=0;
  int strongPersonFrames=0,possiblePersonFrames=0,validFrames=0;
  int framesWithMultiplePeople=0;
  long firstStrongAt=-1,lastStrongAt=-1;
  final JSONArray frameEvidence=new JSONArray();
  final OutfitEvidence outfit=new OutfitEvidence();
  final AnonymousClipTracks anonymousTracks=new AnonymousClipTracks();
  final S9FaceReview faceReview=new S9FaceReview(app,folder,name);
  final LinkedHashSet<String> animalsSeen=new LinkedHashSet<>(),vehiclesSeen=new LinkedHashSet<>();
  double maxPerson=0,maxAnimal=0,maxVehicle=0;
  Bitmap best=null;double bestScore=-1;
  long bestMotionTimeMs=-1;
  boolean bestGardenPerson=false;
  float bestGardenPersonScore=0f;
  int[] previousGardenLuma=null;
  long duration=0;
  try{
   media.setDataSource(mp4.getAbsolutePath());
   duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
   result.put("duration_ms",duration);
   result.put("width",Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)));
   result.put("height",Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)));
   init();
   result.put("model_sha256",modelSha256);
   // Denser temporal coverage catches short walk-bys that a handful of keyframes miss.
   // Cap decoding/inference to 12 samples per clip to protect device thermals.
   int frames=(int)Math.min(12,Math.max(6,(duration+1799L)/1800L));
   for(int n=0;n<frames;n++){
    long micros=(long)(((n+0.5)/(double)frames)*duration*1000);
    Bitmap bitmap=media.getFrameAtTime(micros,MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
    if(bitmap==null)continue;
    try{
     List<Detection> found=detect(bitmap);
     validFrames++;
     int p=0,a=0,v=0,weakPerson=0;
     final ArrayList<float[]> distinctPersonBoxes=new ArrayList<>();
     final ArrayList<AnonymousClipTracks.Hit> anonymousPeople=new ArrayList<>();
     double confidence=0,framePersonMax=0;
     for(Detection d:found){
      if("person".equals(d.label)){
       maxPerson=Math.max(maxPerson,d.score);
       framePersonMax=Math.max(framePersonMax,d.score);
       if(d.score>=.50f){
        boolean duplicate=false;
        for(float[] box:distinctPersonBoxes)if(samePersonBox(d.box,box)){duplicate=true;break;}
        if(!duplicate){
         distinctPersonBoxes.add(d.box);p++;
         anonymousPeople.add(new AnonymousClipTracks.Hit(d.box,d.score,upperClothingColour(bitmap,d.box)));
        }
        confidence=Math.max(confidence,d.score);
       }else weakPerson++;
      }else if(d.score>=.50f && ("cat".equals(d.label)||"dog".equals(d.label)||"bird".equals(d.label)
           ||"horse".equals(d.label)||"sheep".equals(d.label)||"cow".equals(d.label)
           ||"elephant".equals(d.label)||"bear".equals(d.label)||"zebra".equals(d.label)
           ||"giraffe".equals(d.label))){
       a++;maxAnimal=Math.max(maxAnimal,d.score);animalsSeen.add(d.label);
      }else if(d.score>=.50f && ("car".equals(d.label)||"truck".equals(d.label)||"bus".equals(d.label)
           ||"motorcycle".equals(d.label)||"bicycle".equals(d.label)
           ||"train".equals(d.label))){
       v++;maxVehicle=Math.max(maxVehicle,d.score);vehiclesSeen.add(d.label);
      }
     }
     // Use GPU-detected isolated persons to perform bounded on-phone outfit analysis.
     // The sampled crop excludes head/face; no persistent identity assignment.
     if(p==1&&framePersonMax>=.65f&&distinctPersonBoxes.size()==1)
      outfit.add(bitmap,distinctPersonBoxes.get(0),(float)framePersonMax);
     anonymousTracks.addFrame(micros/1000,anonymousPeople);
     if(p>0)faceReview.sample(bitmap,micros/1000);
     if(p>=2)framesWithMultiplePeople++;
     if(p>0){
      strongPersonFrames++;
      if(firstStrongAt<0)firstStrongAt=micros/1000;
      lastStrongAt=micros/1000;
     }
     if(p>0||weakPerson>0)possiblePersonFrames++;
     persons=Math.max(persons,p);animals=Math.max(animals,a);vehicles=Math.max(vehicles,v);
     JSONObject sample=new JSONObject();
     sample.put("time_ms",micros/1000).put("people_at_050",p)
       .put("person_peak_score",Math.round(framePersonMax*1000)/1000.0)
       .put("vehicles_at_050",v).put("animals_at_050",a);
     frameEvidence.put(sample);
     // Prioritize the actual foreground person or largest garden change.
     // Cars on the road cannot dominate a saved thumbnail.
     final float gardenTop=.64f,margin=.045f;
     float personInGarden=0f;
     float[] gardenPersonBox=null;
     for(Detection detected:found){
      if(!"person".equals(detected.label)||detected.score<.30f)continue;
      float[] box=detected.box;
      if(box==null||box.length!=4)continue;
      float center=(box[1]+box[3])*.5f;
      if(box[2]>=gardenTop&&center>=margin&&center<=1f-margin
          &&detected.score>personInGarden){
       personInGarden=detected.score;
       gardenPersonBox=box;
      }
     }
     int[] currentGardenLuma=sampleGardenLuma(bitmap,gardenTop);
     double movement=previousGardenLuma==null?0.0:
        gardenFrameDifference(previousGardenLuma,currentGardenLuma);
     previousGardenLuma=currentGardenLuma;
     double quality=personInGarden>0f?1000.0+personInGarden*100.0+movement:movement;
     if(quality>bestScore){
      if(best!=null)best.recycle();
      best=makeGardenThumbnail(bitmap,gardenPersonBox);
      bestScore=quality;
      bestMotionTimeMs=micros/1000;
      bestGardenPerson=personInGarden>0f;
      bestGardenPersonScore=personInGarden;
     }
    }finally{bitmap.recycle();}
   }
   JSONArray categories=new JSONArray();
   String scene="motion_other";
   // An isolated multi-box frame is not reliable evidence for two people.
   if(persons>0){
    scene=framesWithMultiplePeople>=2?"multiple_people":
      framesWithMultiplePeople==1?"unreviewed":"one_person";
    categories.put("person");
   }
   if(vehicles>0)categories.put("vehicle");
   if(animals>0)categories.put("animal");
   if(categories.length()==0)categories.put("other_motion");
   String personEvent="no_person_model_detection";
   if(framesWithMultiplePeople>=2)personEvent="multiple_people_candidate";
   else if(framesWithMultiplePeople==1)personEvent="possible_group_needs_frame_review";
   else if(strongPersonFrames>=2)personEvent="single_person_repeated_candidate";
   else if(strongPersonFrames==1)personEvent="single_frame_person_candidate";
   else if(possiblePersonFrames>=2)personEvent="possible_person_below_standard_threshold";
   result.put("person_event_category",personEvent);
   result.put("person_review_priority",framesWithMultiplePeople>=2||strongPersonFrames>=2?"high":
      possiblePersonFrames>0?"review":"non_person_or_unresolved");
   result.put("sampled_frame_count",validFrames);
   result.put("person_frames_at_050",strongPersonFrames);
   result.put("frames_with_distinct_multiple_person_boxes",framesWithMultiplePeople);
   result.put("person_box_deduplication","iou_045_or_center_distance_005");
   result.put("possible_person_frames_at_030",possiblePersonFrames);
   result.put("person_first_sample_ms",firstStrongAt>=0?firstStrongAt:JSONObject.NULL);
   result.put("person_last_sample_ms",lastStrongAt>=0?lastStrongAt:JSONObject.NULL);
   result.put("person_sample_timeline",frameEvidence);
   result.put("animal_subcategories",new JSONArray(animalsSeen));
   result.put("vehicle_subcategories",new JSONArray(vehiclesSeen));
   result.put("anonymous_tracking_version","sampled_box_tracklets_v1");
   result.put("anonymous_track_scope","this_recording_only");
   result.put("anonymous_id_not_verified_person",true);
   result.put("anonymous_track_count",anonymousTracks.appearances());
   result.put("anonymous_track_count_is_not_unique_people",true);
   result.put("anonymous_tracks",anonymousTracksJson(anonymousTracks));
   result.put("person_count_is_max_simultaneous_detections",true);
   result.put("person_identity","not_evaluated");
   result.put("human_reviewed",false);
   result.put("scene_category",scene);
   result.put("content_group",scene);
   result.put("categories",categories);
   result.put("person_count",persons);
   result.put("ai_person_count_at_trigger",persons);
   result.put("vehicle_count",vehicles);
   result.put("animal_count",animals);
   result.put("person_confidence",Math.round(maxPerson*1000)/1000.0);
   result.put("animal_confidence",Math.round(maxAnimal*1000)/1000.0);
   result.put("vehicle_confidence",Math.round(maxVehicle*1000)/1000.0);
   result.put("backend",backend);
   outfit.publish(result,folder,name,persons==1&&framesWithMultiplePeople==0);
   faceReview.publish(result);
   result.put("processing_elapsed_ms",SystemClock.elapsedRealtime()-begin);
   result.put("thumbnail_source_time_ms",bestMotionTimeMs>=0?bestMotionTimeMs:JSONObject.NULL);
   result.put("thumbnail_focus","foreground_garden_motion");
   result.put("thumbnail_person_candidate_in_garden",bestGardenPerson);
   result.put("thumbnail_garden_person_confidence",Math.round(bestGardenPersonScore*1000f)/1000.0);
   if(best!=null){
    File thumb=new File(folder,name+".thumb.jpg");
    File temp=new File(folder,name+".thumb.partial");
    try(FileOutputStream o=new FileOutputStream(temp)){
     best.compress(Bitmap.CompressFormat.JPEG,90,o);
     o.getFD().sync();
    }
    if(!temp.renameTo(thumb))throw new IOException("thumbnail_rename_failed");
    result.put("thumbnail",thumb.getName());
   }
  }finally{
   if(best!=null)best.recycle();
   faceReview.close();
   try{media.release();}catch(Exception ignored){}
  }
  writeJson(new File(folder,name+".verified.json"),result);
  return result;
 }
 /** Simple exposure-neutral 12x8 foreground motion sampling, on S9+ only. */
 private static int[] sampleGardenLuma(Bitmap bitmap,float start){
  int[] values=new int[96];
  for(int y=0;y<8;y++)for(int x=0;x<12;x++){
   int sx=Math.min(bitmap.getWidth()-1,(int)((x+.5f)*bitmap.getWidth()/12f));
   int sy=Math.min(bitmap.getHeight()-1,(int)((start+(y+.5f)*(1-start)/8f)*bitmap.getHeight()));
   int rgb=bitmap.getPixel(sx,sy);
   values[y*12+x]=(77*((rgb>>16)&255)+150*((rgb>>8)&255)+29*(rgb&255))>>8;
  }
  return values;
 }
 private static double gardenFrameDifference(int[] old,int[] current){
  double shift=0,delta=0;
  for(int i=0;i<old.length;i++)shift+=current[i]-old[i];
  shift/=old.length;
  for(int i=0;i<old.length;i++)delta+=Math.abs(current[i]-old[i]-shift);
  return delta/old.length;
 }
 /** Crop out distant traffic; where possible center a person in the garden. */
 private static Bitmap makeGardenThumbnail(Bitmap bitmap,float[] box){
  int w=bitmap.getWidth(),h=bitmap.getHeight();
  float left=0f,right=1f,top=.42f;
  if(box!=null){
   float cx=(box[1]+box[3])*.5f;
   float cw=Math.max(.48f,Math.min(.76f,(box[3]-box[1])*2.4f));
   left=Math.max(0f,Math.min(1f-cw,cx-cw/2f));
   right=left+cw;
   top=Math.max(0f,Math.min(.5f,box[0]-.14f));
  }
  int x0=Math.min(w-2,Math.max(0,(int)(w*left)));
  int x1=Math.max(x0+1,Math.min(w,(int)(w*right)));
  int y0=Math.min(h-2,Math.max(0,(int)(h*top)));
  Bitmap cropped=Bitmap.createBitmap(bitmap,x0,y0,x1-x0,h-y0);
  try{
   return Bitmap.createScaledBitmap(cropped,1200,
       Math.max(2,(int)(cropped.getHeight()*1200.0/cropped.getWidth())),true);
  }finally{if(cropped!=bitmap)cropped.recycle();}
 }
 private static String digest(File file)throws Exception{
  MessageDigest md=MessageDigest.getInstance("SHA-256");
  try(FileInputStream in=new FileInputStream(file)){
   byte[] bytes=new byte[131072];int n;
   while((n=in.read(bytes))>0)md.update(bytes,0,n);
  }
  StringBuilder result=new StringBuilder();
  for(byte n:md.digest())result.append(String.format(Locale.US,"%02x",n&255));
  return result.toString();
 }
 static void writeJson(File f,JSONObject j)throws Exception{
  File t=new File(f.getParentFile(),f.getName()+".tmp");
  try(FileOutputStream o=new FileOutputStream(t)){
   o.write(j.toString(2).getBytes("UTF-8"));
   o.getFD().sync();
  }
  if(!t.renameTo(f))throw new IOException("manifest_rename_failed");
 }
 public synchronized void close(){
  if(net!=null){try{net.close();}catch(Throwable ignored){}net=null;}
  if(delegate!=null){try{delegate.close();}catch(Throwable ignored){}delegate=null;}
 }
}
