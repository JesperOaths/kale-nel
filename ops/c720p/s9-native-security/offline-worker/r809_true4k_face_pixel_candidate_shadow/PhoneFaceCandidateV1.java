import android.graphics.*;
import android.media.MediaMetadataRetriever;
import android.os.Process;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/**
 * Samsung S9+ ONLY: derive UNAPPROVED face photograph candidates from
 * source-SHA owner-approved single-person recordings. Does not identify,
 * label, enroll, mutate verified gallery, or publish recording contents.
 * One old original / at most 3 frames / at most 3 candidate JPGs per run.
 */
public final class PhoneFaceCandidateV1 {
 static final String ROOT="/data/local/tmp/s9-face-candidate-r809/";
 static final String VIDEO="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K/";
 static final int MAX_PICTURE_BYTES=320000;
 // R805 shadow aggregates: no face, low score, small eyes,
 // invalid roll, wrong ROI, unapproved candidate output.
 static final int[] SHADOW_REASONS=new int[6];
 static void need(boolean x,String why){if(!x)throw new IllegalStateException(why);}
 static String sha(InputStream f)throws Exception{
   MessageDigest digest=MessageDigest.getInstance("SHA-256");
   byte[] buf=new byte[262144];int n;long total=0;
   while((n=f.read(buf))>0){
     digest.update(buf,0,n);total+=n;
     if(total%4194304<n)SFaceTrial.health();
   }
   StringBuilder s=new StringBuilder();
   for(byte x:digest.digest())s.append(String.format(Locale.ROOT,"%02x",x&255));
   return s.toString();
 }
 static String shaFile(java.nio.file.Path p)throws Exception{
   try(InputStream in=Files.newInputStream(p)){return sha(in);}
 }
 static String shaBytes(byte[] data)throws Exception{
   return sha(new ByteArrayInputStream(data));
 }
 static boolean sourceBox(JSONArray b)throws Exception{
   if(b.length()!=4)return false;
   double l=b.getDouble(0),t=b.getDouble(1),r=b.getDouble(2),d=b.getDouble(3);
   double w=r-l,h=d-t;
   return l>=0&&t>=0&&r<=3840&&d<=2160&&w>=32&&h>=64&&h>=1.25*w&&h<=3.6*w;
 }
 static final class Crop {
   Bitmap bitmap;int left,top,size;
   Crop(Bitmap source,int[] box,double centerX,double centerY){
     int w=box[2]-box[0],h=box[3]-box[1],fw=source.getWidth(),fh=source.getHeight();
     size=(int)Math.max(160,Math.min(Math.min(fw,fh),Math.max(w*1.25,h*.36)));
     double cx=box[0]+centerX*w,cy=box[1]+centerY*h;
     left=(int)Math.max(0,Math.min(fw-size,Math.round(cx-size/2)));
     top=(int)Math.max(0,Math.min(fh-size,Math.round(cy-size/2)));
     bitmap=Bitmap.createBitmap(source,left,top,size,size);
   }
   void close(){bitmap.recycle();}
 }
 static int[] scale(JSONArray box,int width,int height)throws Exception {
   return new int[]{(int)Math.round(box.getDouble(0)*width/3840.),
     (int)Math.round(box.getDouble(1)*height/2160.),
     (int)Math.round(box.getDouble(2)*width/3840.),
     (int)Math.round(box.getDouble(3)*height/2160.)};
 }
 static byte[] jpeg(Bitmap img)throws Exception{
   ByteArrayOutputStream out=new ByteArrayOutputStream(48000);
   need(img.compress(Bitmap.CompressFormat.JPEG,85,out),"jpeg_encoder_error");
   byte[] data=out.toByteArray();
   need(data.length>=3000&&data.length<=MAX_PICTURE_BYTES,"candidate_jpeg_shape");
   return data;
 }
 static JSONObject process(JSONObject row,FaceEyes detector,File dest)throws Exception {
   String clip=row.getString("clip"),source=row.getString("source_sha256");
   need(clip.matches("motion_[0-9]{13}\\.mp4") &&
        source.matches("[0-9a-f]{64}"),"untrusted_clip");
   need(row.getInt("source_person_count")==1 && row.getBoolean("proposal_only")
       && !row.getBoolean("auto_verified_face_identity"),"missing_review_gate");
   need(sourceBox(row.getJSONArray("fullbody_box")),"not_an_upright_person");
   int track=row.getInt("owner_track_id");
   need(track>=0&&track<1000,"bad_exact_owner_track");
   String approvedCrop=row.getString("approved_body_crop_sha256");
   need(approvedCrop.matches("[0-9a-f]{64}"),"unverified_body_anchor");
   java.nio.file.Path original=Paths.get(VIDEO+clip);
   need(Files.isRegularFile(original,LinkOption.NOFOLLOW_LINKS)
        && Files.size(original)==row.getLong("bytes"),"original_unavailable_or_changed");
   // The phone independently verifies the ENTIRE native original, not only
   // its catalog metadata or a previously uploaded JPEG.
   need(shaFile(original).equals(source),"S9_original_sha_mismatch");
   JSONArray ms=row.getJSONArray("requested_ms");
   need(ms.length()<=3&&ms.length()>=2,"too_many_or_few_frames");
   List<JSONObject> candidates=new ArrayList<>();int decoded=0,attempted=0;
   MediaMetadataRetriever media=new MediaMetadataRetriever();
   try{
    media.setDataSource(original.toString());
    need("3840".equals(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH))
         &&"2160".equals(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)),
         "not_original_4k");
    for(int i=0;i<Math.min(ms.length(),2);i++){
     SFaceTrial.health();
     long requested=ms.getLong(i);
     need(requested>=0&&requested<60000,"bad_requested_frame_time");
     // R809 source-only prototype: return true native 3840x2160 frame.
     // Bound to at most 2 temporal samples; do NOT touch the live camera.
     Bitmap sourceFrame=media.getFrameAtTime(requested*1000L,
         MediaMetadataRetriever.OPTION_CLOSEST);
     if(sourceFrame==null)continue;
     try {
      need(sourceFrame.getWidth()==3840&&sourceFrame.getHeight()==2160,"source_frame_not_native_4k");
      decoded++;
      int[] b=scale(row.getJSONArray("fullbody_box"),sourceFrame.getWidth(),sourceFrame.getHeight());
      // Two upper-body framing windows: a broader head and a tighter high
      // head. Do not search the full scene for unrelated background faces.
      double[][] windows={{.5,.14},{.5,.24}};
      boolean accepted=false;
      for(double[] win:windows) {
       Crop crop=new Crop(sourceFrame,b,win[0],win[1]);
       try{
        FaceEyes.Face found=detector.locate(crop.bitmap);
        attempted++;
        if(found==null){SHADOW_REASONS[0]++;continue;}
        if(found.score<.82){SHADOW_REASONS[1]++;continue;}
        if(found.eye<18){SHADOW_REASONS[2]++;continue;}
        if(!Double.isFinite(found.roll)||Math.abs(found.roll)>.60){
          SHADOW_REASONS[3]++;continue;
        }
        double cx=found.midX+crop.left,cy=found.midY+crop.top;
        int bw=b[2]-b[0],bh=b[3]-b[1];
        // Facial center must belong to the top ~42% of the approved
        // body box, not a neighboring person or background poster.
        if(cx<b[0]-.12*bw || cx>b[2]+.12*bw ||
           cy<b[1]-.05*bh || cy>b[1]+.42*bh){
          SHADOW_REASONS[4]++;continue;
        }
        int pad=(int)Math.max(found.w,found.h);
        int size=Math.max(80,(int)Math.min(crop.bitmap.getWidth(),
                 Math.ceil(Math.max(found.w,found.h)*1.38)));
        int left=(int)Math.max(0,Math.min(crop.bitmap.getWidth()-size,
                    Math.round(found.x+found.w/2-size/2)));
        int top=(int)Math.max(0,Math.min(crop.bitmap.getHeight()-size,
                   Math.round(found.y+found.h/2-size/2)));
        Bitmap face=Bitmap.createBitmap(crop.bitmap,left,top,size,size);
        try{
          Bitmap normalized=Bitmap.createScaledBitmap(face,224,224,true);
          try{
           byte[] bytes=jpeg(normalized);
           String hash=shaBytes(bytes);
           String name=source.substring(0,12)+"-t"+track+"-"+requested+"-"+hash.substring(0,12)+".jpg";
           File target=new File(dest,name);
           if(target.exists()){
             need(Files.size(Paths.get(target.getPath()))==bytes.length &&
                   shaFile(target.toPath()).equals(hash),"photo_name_conflict");
           }else{
             File part=File.createTempFile(".face-",".part",dest);
             try {
              try(FileOutputStream fd=new FileOutputStream(part)){
                fd.write(bytes);fd.getFD().sync();
              }
              need(part.renameTo(target),"candidate_publish_failed");
              target.setReadable(false,false);target.setReadable(true,true);
              target.setWritable(false,false);target.setWritable(true,true);
             }finally{if(part.exists())part.delete();}
           }
           JSONObject j=new JSONObject().put("source_sha256",source)
             .put("owner_track",track)
             .put("approved_body_crop_sha256",approvedCrop)
             .put("candidate_face_sha256",hash)
             .put("candidate_filename",name)
             .put("requested_original_frame_ms",requested)
             .put("actual_decoded_video_pts_verified",false)
             .put("face_score",found.score)
             .put("detected_eye_spacing_px_2k_head_roi",found.eye)
             .put("owner_verified_identity_of_face",false)
             .put("face_model_assigned_folder",false);
           candidates.add(j);
           SHADOW_REASONS[5]++;
           accepted=true;
          }finally{normalized.recycle();}
        }finally{face.recycle();}
       }finally{crop.close();}
       if(accepted)break;
      }
      if(candidates.size()>=3)break;
     }finally{sourceFrame.recycle();}
    }
   }finally{media.release();}
   need(Files.size(original)==row.getLong("bytes") && shaFile(original).equals(source),
        "native_original_changed_mid_probe");
   return new JSONObject().put("attempted_head_regions",attempted)
        .put("decoded_original_frames",decoded)
        .put("unapproved_face_candidates",new JSONArray(candidates))
        .put("owner_review_required",true)
        .put("automatic_face_gallery_enrollment",0);
 }
 public static void main(String[] args)throws Exception{
   need(args.length==2 && args[0].matches("[0-9a-f]{64}") &&
        args[1].matches("[01]"),"arguments");
   Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
   byte[] body=Files.readAllBytes(Paths.get(ROOT+args[0]+".json"));
   need(body.length<25000&&shaBytes(body).equals(args[0]),"manifest_signature");
   JSONObject p=new JSONObject(new String(body,"UTF-8"));
   need(p.getInt("schema")==3 && p.getBoolean("auto_enroll")==false &&
        p.getInt("max_faces_per_original")==3,"phone_manifest_policy");
   JSONArray rows=p.getJSONArray("rows");
   need(rows.length()>=1&&rows.length()<=2,"bounded_sources");
   int i=Integer.parseInt(args[1]);
   need(i<rows.length(),"batch_entry_out_of_range");
   File dest=new File(ROOT+"unverified_photos");
   need(dest.isDirectory()&&!Files.isSymbolicLink(dest.toPath()),"private_candidate_store_missing");
   JSONObject result;
   try(FaceEyes f=new FaceEyes()){
      result=process(rows.getJSONObject(i),f,dest);
   }
   result.put("r809_true_native_4k_bitmap_decoding",true)
     .put("r809_max_source_frames",2)
     .put("r809_original_camera_and_people_gallery_untouched",true);
   result.put("r808_unapproved_review_only_score_cutoff",.82)
     .put("r808_production_thresholds_unchanged",true);
   result.put("r807_yunet_peak_score_640_then_320",new JSONArray(FaceEyes.peakByMode))
     .put("r807_yunet_grid_counts_ge20_ge50_ge70_ge85",
          new JSONArray(FaceEyes.scoreBinsByMode));
   result.put("r805_shadow_only_aggregate_rejections",new JSONArray(SHADOW_REASONS))
     .put("r805_detector_640_then_smoothed320_stats",new JSONArray(FaceEyes.stats))
     .put("r805_input_tensor_stays_640_square",true)
     .put("r805_no_automatic_identity_enrollment",true);
   result.put("schema","S9_OWNER_SOURCE_FACE_CANDIDATE_SHADOW_V1")
     .put("manifest_sha256",args[0])
     .put("originals_processed",1)
     .put("no_person_identification_performed",true)
     .put("automatic_folder_assignments",0);
   System.out.println("S9_FACE_INTAKE_RESULT "+result);
   System.out.flush();
   Runtime.getRuntime().halt(0);
 }
}
