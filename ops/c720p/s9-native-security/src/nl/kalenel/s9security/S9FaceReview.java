package nl.kalenel.s9security;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.PointF;
import android.media.FaceDetector;
import org.json.JSONArray;
import org.json.JSONObject;
import org.tensorflow.lite.Interpreter;
import java.io.*;
import java.nio.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;

/** S9-only face snapshots and *unverified* embedding similarity suggestions.
 * Never transfers embeddings to the C720P or makes security decisions.
 * The optional TFLite encoder takes two identical 112x112 RGB NCHW float32 inputs
 * and returns two 128D embeddings, which must pass an on-phone self-consistency check.
 * If it is absent/incompatible, snapshots still work but identities are never guessed.
 */
final class S9FaceReview implements AutoCloseable {
 static final String VERSION="s9_face_review_v1";
 static final String GEOMETRY_VERSION="face_crop_geometry_v2_padded_manual";
 private static final int MAX_FRAMES=12,MAX_FACES=3,MAX_CAPTURES=8,EMBED=128,SIDE=112;
 private static final Pattern FILE=Pattern.compile("motion_[0-9]{13}[.]mp4");
 private static final Pattern PERSON=Pattern.compile("[A-Za-z0-9][A-Za-z0-9 _.-]{0,55}");
 private static final double KNOWN_FLOOR=.84,UNKNOWN_FLOOR=.88,MIN_MARGIN=.045;
 private final Context app;
 private final File sd;
 private final String clip;
 private final int frameLimit;
 private final JSONArray captures=new JSONArray();
 private final Map<String,float[]> known=new LinkedHashMap<>();
 private final List<Entry> unknown=new ArrayList<>();
 private Interpreter net;
 private String sha="",status="no_frontal_face_in_samples",error="";
 private int nextId=1,frames=0,detected=0,saved=0,personRoiSamples=0,fullFrameSamples=0;
 private int rawDetectorHits=0,lowConfidenceOrSmall=0,rejectedPose=0,rejectedCrop=0,rejectedImageQuality=0;
 private int rejectedLowConfidence=0,rejectedSmallFace=0,manualRescueCandidates=0;
 private int paddedManualCrops=0,rejectedInsufficientNativeEyeDetail=0;
 // At most one inference per reviewed clip on a borderline-but-real face.
 // The shadow vector is discarded immediately: never index, match, or export it.
 private int shadowEmbeddingTrials=0,shadowEmbeddingSucceeded=0,shadowEmbeddingFailed=0;
 private boolean loaded=false,modelAttempted=false,modelReady=false;
 private static final class Entry {
  final String id; final float[] vector;
  Entry(String id,float[] vector){this.id=id;this.vector=vector;}
 }
 S9FaceReview(Context app,File sd,String clip){this(app,sd,clip,MAX_FRAMES);}
 S9FaceReview(Context app,File sd,String clip,int frameLimit){
  this.app=app;this.sd=sd;this.clip=clip;
  this.frameLimit=Math.max(1,Math.min(48,frameLimit));
 }
 static boolean hasEmbeddingModel(Context ctx){
  try(InputStream in=ctx.getAssets().open("face_embedding.tflite")){
   return in.read()>=0;
  }catch(IOException ignored){return false;}
 }
 private static String hash(byte[] data)throws Exception{
  byte[] value=MessageDigest.getInstance("SHA-256").digest(data);
  StringBuilder b=new StringBuilder();
  for(byte x:value)b.append(String.format(Locale.US,"%02x",x&255));
  return b.toString();
 }
 private void openModel(){
  if(modelAttempted)return;
  modelAttempted=true;
  try{
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();
   try(InputStream in=app.getAssets().open("face_embedding.tflite")){
    byte[] buf=new byte[32768];int n;
    while((n=in.read(buf))>0){
     bytes.write(buf,0,n);
     if(bytes.size()>12000000)throw new IOException("face_model_too_large");
    }
   }
   if(bytes.size()<100000)throw new IOException("face_model_invalid_size");
   byte[] source=bytes.toByteArray();sha=hash(source);
   ByteBuffer model=ByteBuffer.allocateDirect(source.length).order(ByteOrder.nativeOrder());
   model.put(source);model.rewind();
   net=new Interpreter(model,new Interpreter.Options().setNumThreads(2));
   // Qualcomm MobileFaceNet v0.62.2 TFLite is a paired verification model:
   // two channel-first RGB inputs, output is two distinct 128D embeddings.
   if(net.getInputTensorCount()!=2||net.getOutputTensorCount()!=1||
      !Arrays.equals(net.getInputTensor(0).shape(),new int[]{1,3,SIDE,SIDE})||
      !Arrays.equals(net.getInputTensor(1).shape(),new int[]{1,3,SIDE,SIDE})||
      !Arrays.equals(net.getOutputTensor(0).shape(),new int[]{2,EMBED})||
      net.getInputTensor(0).dataType()!=org.tensorflow.lite.DataType.FLOAT32||
      net.getInputTensor(1).dataType()!=org.tensorflow.lite.DataType.FLOAT32||
      net.getOutputTensor(0).dataType()!=org.tensorflow.lite.DataType.FLOAT32)
    throw new IOException("unsupported_paired_mobilefacenet_tensor_contract");
   modelReady=true;
  }catch(Exception | LinkageError ex){
   if(net!=null){try{net.close();}catch(Exception ignored){}net=null;}
   modelReady=false;
   status="face_embedding_unavailable_snapshots_only";
   error=ex instanceof FileNotFoundException?"face_model_not_bundled":ex.getClass().getSimpleName();
  }
 }
 /** Keep a real unscaled 70+ pixel source crop, including at frame edges.
  * A manual-only padded context crop does not invent any missing face detail.
  */
 private static Bitmap crop(Bitmap b,int x,int y,int size){
  int side=Math.min(size,Math.min(b.getWidth(),b.getHeight()));
  if(side<70)return null;
  int left=Math.max(0,Math.min(b.getWidth()-side,x-side/2));
  int top=Math.max(0,Math.min(b.getHeight()-side,y-(int)(side*.43)));
  return Bitmap.createBitmap(b,left,top,side,side);
 }
 private static boolean usable(Bitmap b){
  Bitmap mini=Bitmap.createScaledBitmap(b,64,64,true);
  try{
   int[] p=new int[4096];mini.getPixels(p,0,64,0,0,64,64);
   double sum=0,contrast=0;
   for(int y=1;y<63;y+=2)for(int x=1;x<63;x+=2){
    int q=y*64+x,c=p[q],r=p[q+1],d=p[q+64];
    int v=((c>>16)&255)+((c>>8)&255)+(c&255);
    int vr=((r>>16)&255)+((r>>8)&255)+(r&255);
    int vd=((d>>16)&255)+((d>>8)&255)+(d&255);
    sum+=v/3.0; contrast+=(Math.abs(v-vr)+Math.abs(v-vd))/3.0;
   }
   return sum>7400&&sum<235000&&contrast>6500; // v26: retain dim but structurally visible face candidates
  }finally{if(mini!=b)mini.recycle();}
 }
 private float[] vector(Bitmap face)throws Exception{
  openModel();
  if(!modelReady)return null;
  Bitmap square=Bitmap.createScaledBitmap(face,SIDE,SIDE,true);
  try{
   int[] px=new int[SIDE*SIDE];square.getPixels(px,0,SIDE,0,0,SIDE,SIDE);
   ByteBuffer input=ByteBuffer.allocateDirect(SIDE*SIDE*3*4).order(ByteOrder.nativeOrder());
   // Model input is NCHW, not NHWC. Each channel has 112*112 float samples.
   for(int channel=0;channel<3;channel++)for(int p:px){
    int raw=channel==0?(p>>16)&255:channel==1?(p>>8)&255:p&255;
    input.putFloat((raw-127.5f)/128f);
   }
   input.rewind();
   ByteBuffer second=ByteBuffer.allocateDirect(input.capacity()).order(ByteOrder.nativeOrder());
   second.put(input.duplicate());second.rewind();
   float[][] output=new float[2][EMBED];
   Map<Integer,Object> targets=new HashMap<>();
   targets.put(0,output);
   net.runForMultipleInputsOutputs(new Object[]{input,second},targets);
   // Both inputs were deliberately identical. Reject a model if its paired
   // embeddings are not consistent before publishing any similarity result.
   double agreement=0;
   for(int k=0;k<2;k++){
    double length=0;
    for(float a:output[k]){if(!Float.isFinite(a))throw new IOException("nonfinite_embedding");length+=a*a;}
    if(length<1e-8)throw new IOException("zero_embedding");
    float norm=(float)Math.sqrt(length);
    for(int j=0;j<EMBED;j++)output[k][j]/=norm;
   }
   for(int j=0;j<EMBED;j++)agreement+=output[0][j]*output[1][j];
   if(!Double.isFinite(agreement)||agreement<.99)throw new IOException("paired_embedding_self_check_failed");
   return output[0];
  }finally{if(square!=face)square.recycle();}
 }
 private static double similarity(float[] a,float[] b){
  if(a==null||b==null||a.length!=EMBED||b.length!=EMBED)return -2;
  double dot=0;
  for(int i=0;i<EMBED;i++)dot+=a[i]*b[i];
  return Double.isFinite(dot)?dot:-2;
 }
 private static float[] parseVector(JSONArray a){
  if(a==null||a.length()!=EMBED)return null;
  float[] result=new float[EMBED];double length=0;
  for(int i=0;i<EMBED;i++){
   double v=a.optDouble(i,Double.NaN);
   if(!Double.isFinite(v)||Math.abs(v)>1)return null;
   result[i]=(float)v;length+=v*v;
  }
  return length>.97&&length<1.03?result:null;
 }
 private static JSONArray writeVector(float[] v)throws Exception{
  JSONArray j=new JSONArray();for(float a:v)j.put((double)a);return j;
 }
 private static String fileHash(File source)throws Exception{
  MessageDigest md=MessageDigest.getInstance("SHA-256");
  try(InputStream in=new FileInputStream(source)){
   byte[] chunk=new byte[16384];int n;
   while((n=in.read(chunk))>0)md.update(chunk,0,n);
  }
  StringBuilder b=new StringBuilder();
  for(byte x:md.digest())b.append(String.format(Locale.US,"%02x",x&255));
  return b.toString();
 }
 private File index(){return new File(app.getFilesDir(),"s9-face-index-v1.json");}
 private void readIndex(){
  if(loaded||!modelReady)return;
  loaded=true;
  try{
   File file=index();
   if(!file.isFile()||file.length()>1700000||file.length()<20)return;
   byte[] buf=new byte[(int)file.length()];
   try(InputStream in=new FileInputStream(file)){
    int pos=0;while(pos<buf.length){int n=in.read(buf,pos,buf.length-pos);if(n<0)return;pos+=n;}
   }
   JSONObject doc=new JSONObject(new String(buf,"UTF-8"));
   if(!VERSION.equals(doc.optString("version"))||!sha.equals(doc.optString("model_sha256"))){
    status="face_model_changed_requires_reenrollment";return;
   }
   nextId=Math.max(1,doc.optInt("next_id",1));
   JSONArray rows=doc.optJSONArray("anonymous");
   if(rows!=null)for(int i=0;i<Math.min(2500,rows.length());i++){
    JSONObject row=rows.optJSONObject(i);if(row==null)continue;
    String id=row.optString("id");
    if(!id.matches("unknown_[0-9]{5}"))continue;
    float[] v=parseVector(row.optJSONArray("embedding"));
    if(v!=null)unknown.add(new Entry(id,v));
   }
  }catch(Exception e){status="face_index_read_error";error=e.getClass().getSimpleName();}
 }
 private void writeIndex(){
  if(!modelReady)return;
  try{
   JSONArray rows=new JSONArray();
   for(Entry e:unknown)rows.put(new JSONObject().put("id",e.id).put("embedding",writeVector(e.vector)));
   JSONObject doc=new JSONObject().put("version",VERSION).put("model_sha256",sha)
    .put("next_id",nextId).put("anonymous",rows);
   File file=index(),tmp=new File(file.getParentFile(),file.getName()+".partial");
   try(FileOutputStream out=new FileOutputStream(tmp)){
    out.write(doc.toString().getBytes("UTF-8"));out.getFD().sync();
   }
   if(!tmp.renameTo(file))throw new IOException("index_replace_failed");
  }catch(Exception e){error="index_write_"+e.getClass().getSimpleName();}
 }
 private void readKnown(){
  if(!modelReady)return;
  File folder=new File(sd,"KnownFaces");
  File[] names=folder.listFiles((d,n)->n.matches("[A-Za-z0-9][A-Za-z0-9 _.-]{0,55}[.](jpg|jpeg|png)"));
  if(names==null)return;
  Arrays.sort(names,Comparator.comparing(File::getName));
  for(int i=0;i<Math.min(80,names.length);i++){
   File file=names[i];
   if(!file.isFile()||file.length()>6000000)continue;
   String person=file.getName().replaceFirst("[.](jpg|jpeg|png)$","");
   if(!PERSON.matcher(person).matches())continue;
   Bitmap b=BitmapFactory.decodeFile(file.getAbsolutePath());
   if(b==null)continue;
   try{
    // Enrollment images must already contain a front-facing, tightly cropped face.
    float[] v=vector(b);
    if(v!=null)known.put(person,v);
   }catch(Exception ignored){}finally{b.recycle();}
  }
 }
 private JSONObject assign(float[] embedding)throws Exception{
  JSONObject result=new JSONObject();
  if(embedding==null)return result.put("match_status",
    modelReady?"not_comparable_manual_review":
    modelAttempted?"not_comparable_model_unavailable":"not_tested_no_usable_face");
  readIndex();
  if(status.equals("face_model_changed_requires_reenrollment")||
     status.equals("face_index_read_error"))
   return result.put("match_status",status);
  if(!loaded)return result.put("match_status","face_database_unavailable");
  if(known.isEmpty())readKnown();
  String bestName=null;double best=-2,second=-2;
  for(Map.Entry<String,float[]> e:known.entrySet()){
   double sim=similarity(embedding,e.getValue());
   if(sim>best){second=best;best=sim;bestName=e.getKey();}
   else if(sim>second)second=sim;
  }
  if(bestName!=null&&best>=KNOWN_FLOOR&&best-second>=MIN_MARGIN){
   return result.put("person_id","known_candidate_"+bestName.replace(' ','_'))
    .put("candidate_name",bestName).put("match_status","reference_similarity_unverified")
    .put("cosine_similarity",Math.round(best*1000)/1000.0);
  }
  Entry closest=null;double score=-2,next=-2;
  for(Entry e:unknown){
   double sim=similarity(embedding,e.vector);
   if(sim>score){next=score;score=sim;closest=e;}
   else if(sim>next)next=sim;
  }
  if(closest!=null&&score>=UNKNOWN_FLOOR&&score-next>=MIN_MARGIN){
   return result.put("person_id",closest.id).put("match_status","anonymous_similarity_unverified")
    .put("cosine_similarity",Math.round(score*1000)/1000.0);
  }
  if(unknown.size()>=2500)return result.put("match_status","face_index_capacity_reached");
  String id=String.format(Locale.US,"unknown_%05d",nextId++);
  unknown.add(new Entry(id,embedding.clone()));
  writeIndex();
  return result.put("person_id",id).put("match_status","new_anonymous_candidate");
 }
 /** A half-width original-4K tile preserves twice the apparent face pixels
  * of a 960px full-frame scan when the person detector missed the subject.
  * No face identity is asserted; original video remains on microSD.
  */
 void sampleSceneTile(Bitmap frame,long ms,boolean right){
  if(frame==null||frame.getWidth()<400||frame.getHeight()<200)return;
  int mid=frame.getWidth()/2;
  int x=right?mid:0;
  int w=right?frame.getWidth()-mid:mid;
  Bitmap tile=null;
  try{
   tile=Bitmap.createBitmap(frame,x,0,w,frame.getHeight());
   sample(tile,ms,null);
  }finally{if(tile!=null)tile.recycle();}
 }
 void sample(Bitmap frame,long ms){sample(frame,ms,null);}
 /** Isolated person detector ROI is cropped from original decoded 4K,
  * before downscaling for Android FaceDetector. Frontal faces in distant
  * garden recordings otherwise become only a few pixels wide.
  * The ROI is NOT a body pose or gait model.
  */
 void sample(Bitmap frame,long ms,float[] detectedPerson){
  if(!FILE.matcher(clip).matches()||frames>=frameLimit||captures.length()>=MAX_CAPTURES)return;
  frames++;
  Bitmap scaled=null,rgb=null,subject=frame;
  int offsetX=0,offsetY=0;
  try{
   if(detectedPerson!=null&&detectedPerson.length==4){
    boolean finite=true;
    for(float v:detectedPerson)if(!Float.isFinite(v)||v<0||v>1)finite=false;
    if(finite){
     float t=detectedPerson[0],l=detectedPerson[1],b=detectedPerson[2],rr=detectedPerson[3];
     if(b-t>.07f&&rr-l>.018f){
      int width0=frame.getWidth(),height0=frame.getHeight();
      float padX=(rr-l)*.22f,padY=(b-t)*.10f;
      int x0=Math.max(0,(int)((l-padX)*width0));
      int x1=Math.min(width0,(int)Math.ceil((rr+padX)*width0));
      int y0=Math.max(0,(int)((t-padY)*height0));
      // Focus on upper 62% of person rectangle, capturing head, hood and hats.
      int y1=Math.min(height0,(int)Math.ceil((t+.62f*(b-t))*height0));
      if(x1-x0>=90&&y1-y0>=90){
       subject=Bitmap.createBitmap(frame,x0,y0,x1-x0,y1-y0);
       offsetX=x0;offsetY=y0;personRoiSamples++;
      }
     }
    }
   }
   if(subject==frame)fullFrameSamples++;
   int width=960,height=Math.max(2,(int)Math.round(subject.getHeight()*960.0/subject.getWidth())&~1);
   scaled=Bitmap.createScaledBitmap(subject,width,height,true);
   rgb=scaled.copy(Bitmap.Config.RGB_565,false);
   FaceDetector.Face[] faces=new FaceDetector.Face[MAX_FACES];
   int n=new FaceDetector(width,height,MAX_FACES).findFaces(rgb,faces);
   for(int i=0;i<n&&captures.length()<MAX_CAPTURES;i++){
    FaceDetector.Face f=faces[i];if(f==null)continue;
    rawDetectorHits++;
    // V27: permit borderline FACE CROPS for human review only; only the
    // high-confidence path below is eligible for any similarity calculation.
    // Keep separate rejection evidence to distinguish score from resolution.
    if(f.confidence()<.49f){lowConfidenceOrSmall++;rejectedLowConfidence++;continue;}
    if(f.eyesDistance()<7){lowConfidenceOrSmall++;rejectedSmallFace++;continue;}
    float yaw=f.pose(FaceDetector.Face.EULER_Y),roll=f.pose(FaceDetector.Face.EULER_Z);
    if(Math.abs(yaw)>28||Math.abs(roll)>22){rejectedPose++;continue;}
    PointF center=new PointF();f.getMidPoint(center);
    int x=offsetX+(int)(center.x*subject.getWidth()/width);
    int y=offsetY+(int)(center.y*subject.getHeight()/height);
    // FaceDetector sees a rescaled ROI. Validate actual unscaled source pixels
    // before padding an inspection-only crop; no upscaling or invented detail.
    float originalEyeSpan=f.eyesDistance()*subject.getWidth()/width;
    if(originalEyeSpan<10f){
     rejectedCrop++;rejectedInsufficientNativeEyeDetail++;continue;
    }
    int estimatedSize=(int)Math.ceil(originalEyeSpan*3.5f);
    boolean contextPadded=estimatedSize<70;
    Bitmap face=crop(frame,x,y,Math.max(70,estimatedSize));
    if(face==null){rejectedCrop++;continue;}
    try{
     if(!usable(face)){rejectedImageQuality++;continue;}
     detected++;
     // Lower-confidence/off-axis facial images may be useful for manual
     // inspection, but must NEVER be used for automatic biometric linking.
     final boolean reliableForEmbedding=f.confidence()>=.70f&&
         f.eyesDistance()>=14&&Math.abs(yaw)<=18&&Math.abs(roll)<=15&&
         originalEyeSpan>=22f&&estimatedSize>=96&&!contextPadded;
     float[] emb=null;
     if(reliableForEmbedding){
      try{emb=vector(face);}catch(Exception ex){
       status="face_embedding_failed_snapshots_only";error=ex.getClass().getSimpleName();
      }
     }else if(shadowEmbeddingTrials==0&&!contextPadded&&
         f.confidence()>=.58f&&f.eyesDistance()>=10f&&
         Math.abs(yaw)<=22&&Math.abs(roll)<=18&&
         originalEyeSpan>=14f&&estimatedSize>=70){
      // Shadow inference confirms the installed model can process a real crop.
      // Borderline photos must never generate a known/unknown identity match.
      shadowEmbeddingTrials++;
      try{
       float[] shadow=vector(face);
       if(shadow!=null)shadowEmbeddingSucceeded++;
       else shadowEmbeddingFailed++;
       // Explicitly discard the result without calling assign(shadow).
       shadow=null;
      }catch(Exception ex){
       shadowEmbeddingFailed++;
       error=ex.getClass().getSimpleName();
      }
     }
     JSONObject match=assign(emb);
     if(!reliableForEmbedding){
      match.put("face_crop_requires_manual_review",true);
      manualRescueCandidates++;
     }
     if(contextPadded){
      // Mark inspection evidence explicitly; never an identity template.
      match.put("face_crop_padded_context_only",true);
      paddedManualCrops++;
     }
     String id=match.optString("person_id","pending_"+(detected));
     String safe=id.replaceAll("[^A-Za-z0-9_-]","_");
     File outDir=new File(sd,"FaceSnapshots");
     if(!outDir.isDirectory()&&!outDir.mkdirs())throw new IOException("snapshot_directory_failed");
     String image=clip.substring(0,clip.length()-4)+"__"+safe+"__"+ms+"_"+i+".jpg";
     File target=new File(outDir,image),tmp=new File(outDir,image+".partial");
     try(FileOutputStream o=new FileOutputStream(tmp)){
      if(!face.compress(Bitmap.CompressFormat.JPEG,90,o))throw new IOException("face_jpeg_encode_failed");
      o.getFD().sync();
     }
     if(!tmp.renameTo(target))throw new IOException("face_jpeg_move_failed");
     saved++;
     match.put("snapshot",image).put("snapshot_size_bytes",target.length())
      .put("snapshot_sha256",fileHash(target))
      .put("time_ms",ms).put("frontal_candidate",true)
      .put("yaw_degrees",Math.round(yaw)).put("roll_degrees",Math.round(roll));
     captures.put(match);
     if(modelReady&&!status.equals("face_model_changed_requires_reenrollment"))
      status="review_complete_unverified_matches";
    }finally{face.recycle();}
   }
  }catch(Exception e){error=e.getClass().getSimpleName();if(saved==0)status="face_review_failed";}
  finally{
   if(rgb!=null)rgb.recycle();
   if(scaled!=null&&scaled!=subject)scaled.recycle();
   if(subject!=frame)subject.recycle();
  }
 }
 void publish(JSONObject manifest)throws Exception{
  manifest.put("face_review_version",VERSION);
  manifest.put("face_review_status",status);
  manifest.put("face_review_sampled_frames",frames);
  manifest.put("face_detector_sampling_version","high_resolution_isolated_person_head_roi_v2");
  manifest.put("face_person_head_roi_samples",personRoiSamples);
  manifest.put("face_fullframe_samples",fullFrameSamples);
  manifest.put("face_frontal_candidates",detected);
  manifest.put("face_snapshots_saved",saved);
  // Counts are classification evidence, not facial identity. In particular,
  // zero snapshots is never treated as evidence that no person was present.
  manifest.put("face_detector_raw_hits",rawDetectorHits);
  manifest.put("face_rejected_confidence_or_size",lowConfidenceOrSmall);
  manifest.put("face_rejected_low_confidence",rejectedLowConfidence);
  manifest.put("face_rejected_small_face",rejectedSmallFace);
  manifest.put("face_manual_review_rescue_candidates",manualRescueCandidates);
  manifest.put("face_rejected_looking_away_or_roll",rejectedPose);
  manifest.put("face_rejected_crop_geometry",rejectedCrop);
  manifest.put("face_crop_geometry_version",GEOMETRY_VERSION);
  manifest.put("face_crop_padded_manual_count",paddedManualCrops);
  manifest.put("face_rejected_insufficient_native_eye_detail",rejectedInsufficientNativeEyeDetail);
  manifest.put("face_rejected_dark_or_blurry",rejectedImageQuality);
  manifest.put("face_shadow_review_version","s9_shadow_model_probe_v1");
  manifest.put("face_shadow_embedding_trials",shadowEmbeddingTrials);
  manifest.put("face_shadow_embedding_successful",shadowEmbeddingSucceeded);
  manifest.put("face_shadow_embedding_failed",shadowEmbeddingFailed);
  manifest.put("face_shadow_embeddings_persisted",false);
  manifest.put("face_shadow_matches_created",0);
  manifest.put("face_model_state",!modelAttempted?"not_tested_no_usable_face":
      modelReady?"available_on_phone":"unavailable_on_phone");
  manifest.put("face_evidence_outcome",saved>0?"snapshot_candidates_saved":
      "face_review_failed".equals(status)?"review_processing_failed":
      rawDetectorHits==0?"no_face_detector_hit_in_sampled_frames":
      "face_candidates_rejected_in_sampling");
  manifest.put("face_candidates",captures);
  manifest.put("face_review_identity_claim","similarity_suggestion_not_verified_identity");
  manifest.put("face_embedding_on_s9_only",true);
  manifest.put("face_model_sha256",sha.isEmpty()?JSONObject.NULL:sha);
  if(!error.isEmpty())manifest.put("face_review_error_type",error);
 }
 public void close(){
  if(net!=null){try{net.close();}catch(Exception ignored){}net=null;}
 }
}
