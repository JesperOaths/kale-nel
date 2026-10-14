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
 private static final int MAX_FRAMES=12,MAX_FACES=3,MAX_CAPTURES=8,EMBED=128,SIDE=112;
 private static final int MAX_PERSON_REGIONS=4,MAX_DETECTOR_SIDE=1024,MAX_DETECTOR_PIXELS=786432;
 static final String CAPTURE_ALGORITHM="person_head_roi_face_evidence_v2";
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
 private String indexEpoch=UUID.randomUUID().toString();
 private int nextId=1,frames=0,detected=0,saved=0,regionScans=0,evidenceCandidates=0;
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
 private static final class Quality {
  final double brightness,texture;
  Quality(double brightness,double texture){this.brightness=brightness;this.texture=texture;}
  boolean evidence(){return brightness>7&&brightness<248&&texture>=2;}
  boolean recognition(){return brightness>10000.0/961&&brightness<235000.0/961&&texture>8500.0/961;}
 }
 private static Quality quality(Bitmap b){
  Bitmap mini=Bitmap.createScaledBitmap(b,64,64,true);
  try{
   int[] p=new int[4096];mini.getPixels(p,0,64,0,0,64,64);
   double sum=0,contrast=0;int count=0;
   for(int y=1;y<63;y+=2)for(int x=1;x<63;x+=2){
    int q=y*64+x,c=p[q],r=p[q+1],d=p[q+64];
    int v=((c>>16)&255)+((c>>8)&255)+(c&255);
    int vr=((r>>16)&255)+((r>>8)&255)+(r&255);
    int vd=((d>>16)&255)+((d>>8)&255)+(d&255);
    sum+=v/3.0; contrast+=(Math.abs(v-vr)+Math.abs(v-vd))/3.0;count++;
   }
   return new Quality(sum/count,contrast/count);
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
   if(!file.exists()){writeIndex();return;}
   if(!file.isFile()||file.length()>1700000||file.length()<20){
    status="face_index_read_error";error="face_index_invalid_size";return;
   }
   byte[] buf=new byte[(int)file.length()];
   try(InputStream in=new FileInputStream(file)){
    int pos=0;while(pos<buf.length){int n=in.read(buf,pos,buf.length-pos);if(n<0)return;pos+=n;}
   }
   JSONObject doc=new JSONObject(new String(buf,"UTF-8"));
   if(!VERSION.equals(doc.optString("version"))||!sha.equals(doc.optString("model_sha256"))){
    status="face_model_changed_requires_reenrollment";return;
   }
   nextId=Math.max(1,doc.optInt("next_id",1));
   if(nextId>99999)throw new IOException("face_index_invalid_next_id");
   String priorEpoch=doc.optString("face_index_epoch","");
   boolean legacyEpoch=!priorEpoch.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32,64}");
   if(!legacyEpoch)indexEpoch=priorEpoch;
   JSONArray rows=doc.optJSONArray("anonymous");
   if(rows!=null)for(int i=0;i<Math.min(2500,rows.length());i++){
    JSONObject row=rows.optJSONObject(i);if(row==null)continue;
    String id=row.optString("id");
    if(!id.matches("unknown_[0-9]{5}"))continue;
    float[] v=parseVector(row.optJSONArray("embedding"));
    if(v!=null){unknown.add(new Entry(id,v));nextId=Math.max(nextId,Integer.parseInt(id.substring(8))+1);}
   }
   // Add provenance to legacy stores without changing the enrollment/model version.
   if(legacyEpoch)writeIndex();
  }catch(Exception e){status="face_index_read_error";error=e.getClass().getSimpleName();}
 }
 private void writeIndex(){
  if(!modelReady)return;
  try{
   JSONArray rows=new JSONArray();
   for(Entry e:unknown)rows.put(new JSONObject().put("id",e.id).put("embedding",writeVector(e.vector)));
   JSONObject doc=new JSONObject().put("version",VERSION).put("model_sha256",sha)
    .put("face_index_epoch",indexEpoch).put("next_id",nextId).put("anonymous",rows);
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
  if(embedding==null)return result.put("match_status","not_comparable_model_unavailable");
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
  if(unknown.size()>=2500||nextId>99999)return result.put("match_status","face_index_capacity_reached");
  String id=String.format(Locale.US,"unknown_%05d",nextId++);
  unknown.add(new Entry(id,embedding.clone()));
  writeIndex();
  return result.put("person_id",id).put("match_status","new_anonymous_candidate");
 }
 private static final class FaceHit {
  S9FaceGeometry.Region crop;
  double x,y,nativeEyes;
  float confidence,yaw,roll;
  String source;
  boolean recognitionGeometry;
 }
 private void findFaces(Bitmap frame,S9FaceGeometry.Region region,String source,List<FaceHit> hits){
  Bitmap proposal=null,scaled=null,rgb=null;
  try{
   int[] dimensions=S9FaceGeometry.detectorSize(region,MAX_DETECTOR_SIDE,MAX_DETECTOR_PIXELS);
   if(dimensions==null)return;
   int width=dimensions[0],height=dimensions[1];
   proposal=Bitmap.createBitmap(frame,region.left,region.top,region.width(),region.height());
   scaled=Bitmap.createScaledBitmap(proposal,width,height,true);
   rgb=scaled.copy(Bitmap.Config.RGB_565,false);
   if(rgb==null)return;
   regionScans++;
   FaceDetector.Face[] faces=new FaceDetector.Face[MAX_FACES];
   int n=new FaceDetector(width,height,MAX_FACES).findFaces(rgb,faces);
   for(int i=0;i<n;i++){
    FaceDetector.Face f=faces[i];
    if(f==null||!Float.isFinite(f.confidence())||f.confidence()<.55f||
       !Float.isFinite(f.eyesDistance())||f.eyesDistance()<4)continue;
    PointF center=new PointF();f.getMidPoint(center);
    FaceHit hit=new FaceHit();
    hit.x=region.left+center.x*region.width()/(double)width;
    hit.y=region.top+center.y*region.height()/(double)height;
    hit.nativeEyes=f.eyesDistance()*region.width()/(double)width;
    if(hit.nativeEyes<9.2)continue;
    hit.crop=S9FaceGeometry.faceCrop(frame.getWidth(),frame.getHeight(),hit.x,hit.y,hit.nativeEyes,32);
    if(hit.crop==null)continue;
    hit.confidence=f.confidence();hit.yaw=f.pose(FaceDetector.Face.EULER_Y);hit.roll=f.pose(FaceDetector.Face.EULER_Z);
    if(!Float.isFinite(hit.yaw)||!Float.isFinite(hit.roll))continue;
    hit.source=source;
    hit.recognitionGeometry=S9FaceGeometry.recognitionGeometry(hit.confidence,hit.nativeEyes,hit.yaw,hit.roll);
    int duplicate=-1;
    for(int j=0;j<hits.size();j++)if(S9FaceGeometry.sameFace(hits.get(j).crop,hit.crop)){duplicate=j;break;}
    if(duplicate<0)hits.add(hit);
    else{
     FaceHit old=hits.get(duplicate);
     if((hit.recognitionGeometry&&!old.recognitionGeometry)||
        (hit.recognitionGeometry==old.recognitionGeometry&&hit.confidence>old.confidence))hits.set(duplicate,hit);
    }
   }
  }catch(Exception ex){error="face_region_"+ex.getClass().getSimpleName();}
  finally{
   if(rgb!=null&&rgb!=frame&&rgb!=scaled&&rgb!=proposal)rgb.recycle();
   if(scaled!=null&&scaled!=frame&&scaled!=proposal)scaled.recycle();
   if(proposal!=null&&proposal!=frame)proposal.recycle();
  }
 }
 private static JSONArray boxJson(float[] box)throws Exception{
  JSONArray result=new JSONArray();for(float coordinate:box)result.put((double)coordinate);return result;
 }
 void sample(Bitmap frame,long ms){sample(frame,ms,Collections.<float[]>emptyList());}
 /** Boxes are detector proposals [top,left,bottom,right] normalized to this same
  * original decoded frame. They locate evidence; they are not face detections.
  */
 void sample(Bitmap frame,long ms,List<float[]> personBoxes){
  if(frame==null||frame.isRecycled()||ms<0||!FILE.matcher(clip).matches()||
     frames>=frameLimit||captures.length()>=MAX_CAPTURES)return;
  frames++;
  try{
   ArrayList<FaceHit> hits=new ArrayList<>();
   for(S9FaceGeometry.Region region:S9FaceGeometry.headRegions(frame.getWidth(),frame.getHeight(),personBoxes,MAX_PERSON_REGIONS))
    findFaces(frame,region,"person_head_roi",hits);
   // One bounded scene pass catches faces when the person proposal is inaccurate.
   findFaces(frame,new S9FaceGeometry.Region(0,0,frame.getWidth(),frame.getHeight(),-1),"full_frame",hits);
   Collections.sort(hits,(a,b)->a.recognitionGeometry==b.recognitionGeometry?
     Float.compare(b.confidence,a.confidence):(a.recognitionGeometry?-1:1));
   for(int i=0;i<hits.size()&&captures.length()<MAX_CAPTURES;i++){
    FaceHit hit=hits.get(i);S9FaceGeometry.Region bounds=hit.crop;
    Bitmap face=Bitmap.createBitmap(frame,bounds.left,bounds.top,bounds.width(),bounds.height());
    try{
     Quality quality=quality(face);if(!quality.evidence())continue;
     evidenceCandidates++;
     boolean recognitionQuality=hit.recognitionGeometry&&quality.recognition();
     float[] emb=null;JSONObject match;
     if(recognitionQuality){
      detected++;
      try{emb=vector(face);}catch(Exception ex){status="face_embedding_failed_snapshots_only";error=ex.getClass().getSimpleName();}
      match=assign(emb);
     }else match=new JSONObject().put("match_status","not_comparable_face_quality");
     String id=match.optString("person_id","pending_"+evidenceCandidates);
     // Preserve older crops and the existing authenticated snapshot basename
     // contract. The proposal token keeps different faces unique even if an
     // uncertain embedding happens to suggest the same alias in one frame.
     String safe=("roi31_"+i+"_"+id).replaceAll("[^A-Za-z0-9_-]","_");
     if(safe.length()>65)safe=safe.substring(0,65);
     File outDir=new File(sd,"FaceSnapshots");
     if(!outDir.isDirectory()&&!outDir.mkdirs())throw new IOException("snapshot_directory_failed");
     String image=clip.substring(0,clip.length()-4)+"__"+safe+"__"+ms+"_"+(i%MAX_FACES)+".jpg";
     File target=new File(outDir,image),tmp=new File(outDir,image+".partial");
     try(FileOutputStream o=new FileOutputStream(tmp)){
      if(!face.compress(Bitmap.CompressFormat.JPEG,90,o))throw new IOException("face_jpeg_encode_failed");
      o.getFD().sync();
     }
     if(!tmp.renameTo(target))throw new IOException("face_jpeg_move_failed");
     saved++;
     match.put("snapshot",image).put("snapshot_size_bytes",target.length())
      .put("snapshot_sha256",fileHash(target)).put("time_ms",ms)
      .put("frontal_candidate",hit.recognitionGeometry).put("recognition_quality",recognitionQuality)
      .put("capture_quality","detector_confirmed_evidence").put("source_region",hit.source)
      .put("face_box",boxJson(S9FaceGeometry.box(bounds,frame.getWidth(),frame.getHeight())))
      .put("detector_confidence",Math.round(hit.confidence*1000)/1000.0)
      .put("native_eye_distance_pixels",Math.round(hit.nativeEyes*10)/10.0)
      .put("yaw_degrees",Math.round(hit.yaw)).put("roll_degrees",Math.round(hit.roll));
     int owner=S9FaceGeometry.owner(hit.x,hit.y,frame.getWidth(),frame.getHeight(),personBoxes);
     if(owner>=0){
      match.put("person_proposal_index",owner)
       .put("person_box",boxJson(S9FaceGeometry.normalizedBox(personBoxes.get(owner))));
     }
     captures.put(match);
     if(modelReady&&!status.equals("face_model_changed_requires_reenrollment")&&!status.equals("face_index_read_error"))
      status="review_complete_unverified_matches";
     else if(status.equals("no_frontal_face_in_samples"))status="face_evidence_saved_quality_limited";
    }finally{if(face!=frame)face.recycle();}
   }
  }catch(Exception e){error=e.getClass().getSimpleName();if(saved==0)status="face_review_failed";}
 }
 /** Attach a face only to the uniquely overlapping detector track in this frame. */
 void associateTracks(long ms,AnonymousClipTracks tracks)throws Exception{
  for(int i=0;i<captures.length();i++){
   JSONObject face=captures.getJSONObject(i);
   if(face.optLong("time_ms",-1)!=ms)continue;
   JSONArray box=face.optJSONArray("person_box");if(box==null||box.length()!=4)continue;
   int owner=0;
   for(AnonymousClipTracks.Track t:tracks.tracks()){
    if(t.lastMs!=ms)continue;
    double delta=0;for(int k=0;k<4;k++)delta+=Math.abs(box.optDouble(k,-9)-t.lastBox[k]);
    if(delta<.002){if(owner!=0){owner=0;break;}owner=t.id;}
   }
   if(owner>0)face.put("temporary_track_id",owner);
  }
 }
 void publish(JSONObject manifest)throws Exception{
  manifest.put("face_review_version",VERSION);
  manifest.put("face_capture_algorithm",CAPTURE_ALGORITHM);
  manifest.put("face_review_status",status);
  manifest.put("face_review_sampled_frames",frames);
  manifest.put("face_frontal_candidates",detected);
  manifest.put("face_detected_evidence_candidates",evidenceCandidates);
  manifest.put("face_review_region_scans",regionScans);
  manifest.put("face_snapshots_saved",saved);
  manifest.put("face_candidates",captures);
  manifest.put("face_review_identity_claim","similarity_suggestion_not_verified_identity");
  manifest.put("face_embedding_on_s9_only",true);
  manifest.put("face_model_sha256",sha.isEmpty()?JSONObject.NULL:sha);
  // Stable store/model provenance prevents a recycled unknown_00001 after a
  // private index reset from silently joining another person's old gallery.
  manifest.put("face_gallery_epoch",modelReady&&loaded?
    hash((sha+":"+indexEpoch).getBytes("UTF-8")):JSONObject.NULL);
  if(!error.isEmpty())manifest.put("face_review_error_type",error);
 }
 public void close(){
  if(net!=null){try{net.close();}catch(Exception ignored){}net=null;}
 }
}
