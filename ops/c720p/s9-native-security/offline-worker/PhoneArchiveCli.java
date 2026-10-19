package nl.kalenel.s9security;

import java.io.*;
import java.util.*;
import org.json.JSONArray;
import org.json.JSONObject;

/** Isolated app_process entry point: same metadata-only catalog as Camera2,
 * but a DIFFERENT Android process with no camera, media recorder or APK edits.
 * Nothing is written to the S9 archive or hub by this Java entry point.
 */
public final class PhoneArchiveCli {
 private static final String ARCHIVE_SUFFIX="/Android/data/nl.kalenel.s9security/files/Security4K";
 private static JSONObject request(File folder,String uri)throws Exception {
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();
  if(!PhoneArchiveCatalog.handle(bytes,"GET "+uri+" HTTP/1.1",folder))
   throw new IOException("phone_catalog_handler_refused");
  String raw=bytes.toString("UTF-8");
  int pos=raw.indexOf("\r\n\r\n");
  if(pos<0||!raw.startsWith("HTTP/1.1 200 "))throw new IOException("phone_catalog_response_unavailable");
  return new JSONObject(raw.substring(pos+4));
 }
 /**
  * Inventory auxiliary video files by role, without counting them as separate
  * events. A preroll is a capture segment, not an independent recording.
  * Only basename shapes are inspected; no MP4/face data is read or transferred.
  */
 static JSONObject auxiliaryInventory(File archive,JSONArray verified)throws Exception {
  Set<String> primary=new HashSet<>();
  for(int i=0;i<verified.length();i++)primary.add(verified.getJSONObject(i).getString("name"));
  File[] items=archive.listFiles();
  if(items==null||items.length>20000)throw new IOException("sd_inventory_unavailable_or_unbounded");
  // Raw-but-unverified original MP4s are not missing originals; retain both
  // their own presence and their auxiliary companions as potential evidence.
  Set<String> rawPrimary=new HashSet<>();
  for(File f:items){
   if(f.isFile()&&!java.nio.file.Files.isSymbolicLink(f.toPath()) &&
      f.getName().matches("motion_[0-9]{13}[.]mp4"))rawPrimary.add(f.getName());
  }
  int primaryFound=0,preroll=0,orphanPreroll=0,completed=0,partial=0,diagnostics=0,other=0;
  int pairedVerifiedPreroll=0,pairedUnverifiedPreroll=0,missingRawPreroll=0;
  int completeVerified=0,completeUnverified=0,completeMissing=0;
  int partialVerified=0,partialUnverified=0,partialMissing=0;
  int oldMissingRawPreroll=0,oldUnverifiedPreroll=0;
  int oldOrphanPreroll=0,oldComplete=0,oldPartial=0,unknownMtime=0;
  final long now=System.currentTimeMillis(),oneDay=24L*60*60*1000;
  for(File f:items) {
   if(!f.isFile()||java.nio.file.Files.isSymbolicLink(f.toPath()))continue;
   String name=f.getName();
   if(!name.endsWith(".mp4"))continue;
   long modified=f.lastModified();
   boolean old=modified>0 && modified<=now-oneDay;
   if(modified<=0 || modified>now+3600000L)unknownMtime++;
   if(name.matches("motion_[0-9]{13}[.]mp4")){
    if(primary.contains(name))primaryFound++;
    else other++;  // a raw MP4 without valid sidecar remains unverified
   }else if(name.matches("motion_[0-9]{13}[.]mp4[.]preroll[.]mp4")){
    preroll++;
    String base=name.substring(0,name.length()-".preroll.mp4".length());
    if(primary.contains(base))pairedVerifiedPreroll++;
    else {
     orphanPreroll++;if(old)oldOrphanPreroll++;
     if(rawPrimary.contains(base)){
      pairedUnverifiedPreroll++;if(old)oldUnverifiedPreroll++;
     }else{
      missingRawPreroll++;if(old)oldMissingRawPreroll++;
     }
    }
   }else if(name.matches("motion_[0-9]{13}[.]mp4[.]complete[.]mp4")){
    completed++;if(old)oldComplete++;
    String base=name.substring(0,name.length()-".complete.mp4".length());
    if(primary.contains(base))completeVerified++;
    else if(rawPrimary.contains(base))completeUnverified++;
    else completeMissing++;
   }else if(name.matches("motion_[0-9]{13}[.]mp4[.]complete[.]partial[.]mp4")){
    partial++;if(old)oldPartial++;
    String base=name.substring(0,name.length()-".complete.partial.mp4".length());
    if(primary.contains(base))partialVerified++;
    else if(rawPrimary.contains(base))partialUnverified++;
    else partialMissing++;
   }else if(name.matches("diagnostic_preroll_[A-Za-z0-9._-]{1,128}[.]mp4")){
    diagnostics++;
   }else other++;
  }
  if(primaryFound!=primary.size())throw new IOException("verified_original_missing_during_auxiliary_scan");
  if(pairedVerifiedPreroll+pairedUnverifiedPreroll+missingRawPreroll!=preroll ||
     completeVerified+completeUnverified+completeMissing!=completed ||
     partialVerified+partialUnverified+partialMissing!=partial ||
     orphanPreroll!=pairedUnverifiedPreroll+missingRawPreroll)
   throw new IOException("auxiliary_roles_failed_reconciliation");
  return new JSONObject()
   .put("raw_mp4_files_seen",primaryFound+preroll+completed+partial+diagnostics+other)
   .put("verified_primary_events",primaryFound)
   .put("preroll_segments",preroll)
   .put("preroll_without_verified_primary",orphanPreroll)
   .put("preroll_with_verified_primary",pairedVerifiedPreroll)
   .put("preroll_with_raw_unverified_primary",pairedUnverifiedPreroll)
   .put("preroll_without_any_primary",missingRawPreroll)
   .put("preroll_without_any_primary_older_than_24h_mtime",oldMissingRawPreroll)
   .put("preroll_with_raw_unverified_primary_older_than_24h_mtime",oldUnverifiedPreroll)
   .put("completed_companion_with_verified_primary",completeVerified)
   .put("completed_companion_with_raw_unverified_primary",completeUnverified)
   .put("completed_companion_without_any_primary",completeMissing)
   .put("partial_companion_with_verified_primary",partialVerified)
   .put("partial_companion_with_raw_unverified_primary",partialUnverified)
   .put("partial_companion_without_any_primary",partialMissing)
   .put("auxiliary_pairing_is_filename_presence_only_not_media_integrity",true)
   .put("unpaired_preroll_older_than_24h_mtime",oldOrphanPreroll)
   .put("completed_companion_older_than_24h_mtime",oldComplete)
   .put("partial_companion_older_than_24h_mtime",oldPartial)
   .put("mp4_files_with_untrusted_mtime",unknownMtime)
   .put("mtime_age_only_not_integrity_verdict",true)
   .put("no_media_quarantined_or_deleted",true)
   .put("completed_companion_mp4_files",completed)
   .put("partial_completion_mp4_files",partial)
   .put("diagnostic_mp4_files",diagnostics)
   .put("unverified_or_unknown_mp4_files",other)
   .put("auxiliary_files_are_not_additional_recordings",true)
   .put("inventory_does_not_hash_originals",true);
 }
 private static JSONObject summary(JSONArray items,File archive)throws Exception {
  TimeZone tz=TimeZone.getTimeZone("Europe/Amsterdam");
  TreeMap<String,Integer> hours=new TreeMap<>(),days=new TreeMap<>();
  long claimedBytes=0;
  int thumbs=0,personCandidates=0;
  for(int i=0;i<items.length();i++){
   JSONObject record=items.getJSONObject(i);
   String name=record.getString("name");
   if(!name.matches("motion_[0-9]{13}[.]mp4"))throw new IOException("untrusted_catalog_clip");
   long epoch=Long.parseLong(name.substring(7,20));
   GregorianCalendar t=new GregorianCalendar(tz,Locale.ROOT);
   t.setTimeInMillis(epoch);
   int hour=t.get(Calendar.HOUR_OF_DAY);
   int offset=(t.get(Calendar.ZONE_OFFSET)+t.get(Calendar.DST_OFFSET))/60000;
   String hourKey=String.format(Locale.ROOT,"%04d-%02d-%02dT%02d%c%04d",
      t.get(Calendar.YEAR),t.get(Calendar.MONTH)+1,t.get(Calendar.DAY_OF_MONTH),
      hour,offset>=0?'+':'-',Math.abs(offset)/60*100+Math.abs(offset)%60);
   hours.put(hourKey,hours.containsKey(hourKey)?hours.get(hourKey)+1:1);
   if(hour<6)t.add(Calendar.DAY_OF_MONTH,-1);
   String dayKey=String.format(Locale.ROOT,"%04d-%02d-%02d",t.get(Calendar.YEAR),
     t.get(Calendar.MONTH)+1,t.get(Calendar.DAY_OF_MONTH));
   days.put(dayKey,days.containsKey(dayKey)?days.get(dayKey)+1:1);
   claimedBytes+=record.getLong("bytes");
   if(record.getBoolean("thumbnail"))thumbs++;
   int candidates=record.getJSONObject("manifest").optInt("person_count",0);
   if(candidates>0&&candidates<=20)personCandidates++;
  }
  JSONObject hourly=new JSONObject(),daily=new JSONObject();
  for(Map.Entry<String,Integer> e:hours.entrySet())hourly.put(e.getKey(),e.getValue());
  for(Map.Entry<String,Integer> e:days.entrySet())daily.put(e.getKey(),e.getValue());
  return new JSONObject()
    .put("source","S9_native_microSD_sidecar_metadata")
    .put("timezone","Europe/Amsterdam")
    .put("operating_day_start_hour",6)
    .put("recordings",items.length())
    .put("auxiliary_mp4_inventory",auxiliaryInventory(archive,items))
    .put("hourly_recording_counts",hourly)
    .put("daily_recording_counts",daily)
    .put("sidecar_claimed_video_bytes",claimedBytes)
    .put("thumbnail_present_count",thumbs)
    .put("person_candidate_recording_count",personCandidates)
    .put("sd_usable_bytes",archive.getUsableSpace())
    .put("sd_total_bytes",archive.getTotalSpace())
    .put("counts_are_recordings_not_distinct_people",true)
    .put("originals_sha256_rechecked",false)
    .put("read_only",true);
 }
 public static void main(String[] args) {
  try {
   if(args.length!=1)throw new IllegalArgumentException("expected_archive_directory");
   File folder=new File(args[0]).getCanonicalFile();
   String p=folder.getPath();
   if(!p.startsWith("/storage/9C33-6BBD/")||!p.endsWith(ARCHIVE_SUFFIX)||
      !folder.isDirectory()||!folder.canRead())
    throw new IOException("unexpected_sd_archive_path");
   JSONArray all=new JSONArray();
   String pin=null;
   int count=-1;
   for(int cursor=0,page=0;page<41;page++){
    JSONObject data=request(folder,"/archive/catalog?cursor="+cursor+"&limit=50"+
       (pin==null?"":"&snapshot="+pin));
    if(!data.getBoolean("ok")||!"s9_native_archive_catalog_v1".equals(data.getString("schema_version"))||
       !"full".equals(data.getString("mode"))||data.getJSONArray("errors").length()!=0)
     throw new IOException("phone_catalog_invalid_or_unverified");
    String snapshot=data.getString("snapshot_id");
    if(pin==null){pin=snapshot;count=data.getInt("total_records");}
    if(!pin.equals(snapshot)||count!=data.getInt("total_records")||cursor!=data.getInt("cursor"))
     throw new IOException("catalog_generation_changed_during_read");
    JSONArray pageRows=data.getJSONArray("records");
    if(pageRows.length()>50)throw new IOException("catalog_page_size");
    for(int i=0;i<pageRows.length();i++)all.put(pageRows.getJSONObject(i));
    if(data.isNull("next_cursor"))break;
    int next=data.getInt("next_cursor");
    if(next<=cursor||next!=cursor+pageRows.length())throw new IOException("catalog_invalid_cursor");
    cursor=next;
   }
   if(all.length()!=count||all.length()>2000)throw new IOException("phone_catalog_incomplete");
   JSONObject payload=new JSONObject()
     .put("ok",true).put("schema_version","s9_native_archive_cli_v1")
     .put("snapshot_id",pin).put("records",all).put("total_records",count)
     .put("source","S9_android_app_process")
     .put("metadata_only",true).put("read_only",true)
     .put("camera_apk_modified",false).put("video_decode_performed",false)
     .put("summary",summary(all,folder));
   System.out.println("S9_PHONE_ARCHIVE_CLI "+payload.toString());
  }catch(Exception e){
   System.err.println("S9_PHONE_ARCHIVE_CLI_UNAVAILABLE "+e.getClass().getSimpleName());
   System.exit(2);
  }
 }
}
