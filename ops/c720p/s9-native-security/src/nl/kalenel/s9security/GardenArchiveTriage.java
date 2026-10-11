package nl.kalenel.s9security;

import android.os.SystemClock;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Comparator;

/** One bounded, reversible on-S9+ archive-cleanup operation per idle window.
 *
 * Never label a model-negative clip "verified no person"; at night the model
 * may miss people. Move only fully reviewed, non-active older recordings to
 * a private SD quarantine that can be restored. No permanent automatic purge.
 * Quarantine is outside Security4K, so it disappears from normal saved clips.
 */
final class GardenArchiveTriage {
 private static final long MIN_AGE_MS=6L*3600000L;
 private static final int MAX_SCAN=700;
 private static final String MP4_PATTERN="motion_[0-9]{13}[.]mp4";
 private final File live,quarantine;
 private final ClipClassifier detector;
 private final float top,margin;
 private final long eligibilityCutoff;
 GardenArchiveTriage(File live,ClipClassifier detector,float top,float margin,
                     long eligibilityCutoff) throws IOException {
  if(live==null||detector==null||!live.isDirectory()||
     top<.4f||top>.9f||eligibilityCutoff<=0)
   throw new IllegalArgumentException("bad_archive_triage_configuration");
  this.live=live.getCanonicalFile();
  this.detector=detector;
  this.top=top;this.margin=margin;
  this.eligibilityCutoff=eligibilityCutoff;
  this.quarantine=new File(live.getParentFile(),"Security4K_quarantine_garden_review");
  if(!quarantine.isDirectory()&&!quarantine.mkdirs())
   throw new IOException("quarantine_directory_unavailable");
  if(!quarantine.getCanonicalFile().getParentFile().equals(this.live.getParentFile().getCanonicalFile()))
   throw new IOException("invalid_quarantine_location");
 }
 // Return code: 1 quarantined, 2 retained as uncertain/person, 0 no work.
 int processOne()throws Exception {
  File[] all=live.listFiles((dir,name)->name.matches(MP4_PATTERN));
  if(all==null)return 0;
  Arrays.sort(all,Comparator.comparing(File::getName).reversed());
  long now=System.currentTimeMillis();
  int inspected=0;
  for(File movie:all){
   if(++inspected>MAX_SCAN)return 0;
   String name=movie.getName();
   if(!movie.isFile()||movie.length()<200000||
       movie.lastModified()>now-MIN_AGE_MS)continue;
   // Never evaluate newly captured garden-gated clips from this release.
   long clipTime;
   try{clipTime=Long.parseLong(name.substring(7,20));}
   catch(NumberFormatException e){continue;}
   if(clipTime>=eligibilityCutoff||clipTime>now-MIN_AGE_MS)continue;
   File evaluated=new File(live,name+".garden-retention.json");
   File verified=new File(live,name+".verified.json");
   if(evaluated.exists()||!verified.isFile()||verified.length()>250000)continue;
   JSONObject meta;
   try {
    meta=new JSONObject(new String(Files.readAllBytes(verified.toPath()),"UTF-8"));
    if(!name.equals(meta.optString("name"))||meta.optLong("bytes",-1)!=movie.length()||
       !"S9_microSD_only".equals(meta.optString("archive"))||
       meta.optInt("sampled_frame_count",0)<6)continue;
   }catch(Exception e){continue;}
   // Strong original detections are kept even if a secondary night pass
   // misses them. Protect person's footage from a model false negative.
   if(meta.optInt("person_frames_at_050",0)>0||
       meta.optInt("person_count",0)>0){
    // Backfill only when an original recording is known to show someone.
    // This uses the S9+ MediaMetadataRetriever, never C720P decoding.
    detector.rebuildGardenThumbnail(movie,live,meta);
    ClipClassifier.writeJson(evaluated,new JSONObject()
      .put("outcome","preserve_original_person_evidence")
      .put("candidate_model_only",true));
    return 2;
   }
   JSONObject evidence=detector.gardenRetentionProbe(movie,top,margin);
   String decision=evidence.optString("decision");
   evidence.put("source_name",name).put("source_size_bytes",movie.length())
       .put("reviewed_at_ms",now).put("permanently_deleted",false)
       .put("human_verified",false);
   if(!"no_garden_person_evidence".equals(decision)){
    detector.rebuildGardenThumbnail(movie,live,meta);
    ClipClassifier.writeJson(evaluated,evidence.put("outcome",
      "preserve_uncertain_or_garden_person"));
    return 2;
   }
   // Only move an already manifest-reviewed clip after another 24-frame
   // S9+ pass had >=20 readable frames and no person in the actual garden.
   if(evidence.optInt("valid_frames",0)<20)continue;
   File target=new File(quarantine,name);
   if(target.exists())continue;
   if(!movie.renameTo(target))throw new IOException("quarantine_video_move_failed");
   // Companion metadata is moved only AFTER the whole MP4 is safely moved.
   // If sidecar movement fails, restore the original MP4 immediately.
   File newManifest=new File(quarantine,verified.getName());
   if(!verified.renameTo(newManifest)){
    if(!target.renameTo(movie))throw new IOException("quarantine_rollback_failed");
    throw new IOException("manifest_move_failed_video_restored");
   }
   File thumbnail=new File(live,name+".thumb.jpg");
   if(thumbnail.isFile()){
    File newThumb=new File(quarantine,thumbnail.getName());
    if(!newThumb.exists())thumbnail.renameTo(newThumb);
   }
   evidence.put("outcome","quarantined_model_negative_not_deleted");
   evidence.put("original_path",movie.getAbsolutePath());
   evidence.put("quarantine_directory",quarantine.getName());
   ClipClassifier.writeJson(new File(quarantine,name+".garden-retention.json"),evidence);
   return 1;
  }
  return 0;
 }
}
