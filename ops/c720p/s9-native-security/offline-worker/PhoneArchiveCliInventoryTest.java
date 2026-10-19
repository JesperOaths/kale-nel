package nl.kalenel.s9security;

import java.io.File;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;

/** Regression: prerolls, completed and unfinished sidecars are NOT events. */
public final class PhoneArchiveCliInventoryTest {
 private static void demand(boolean value,String label){
  if(!value)throw new AssertionError(label);
 }
 private static File file(File root,String name)throws Exception{
  File f=new File(root,name);
  if(!f.createNewFile())throw new AssertionError("test_file_collision");
  return f;
 }
 public static void main(String[] args)throws Exception{
  File root=Files.createTempDirectory("s9-catalog-aux-test").toFile();
  try{
   String a="motion_1792000000000.mp4",b="motion_1792000003000.mp4";
   JSONArray verified=new JSONArray().put(new JSONObject().put("name",a))
       .put(new JSONObject().put("name",b));
   file(root,a);file(root,b);
   file(root,a+".preroll.mp4");
   File orphan=file(root,"motion_1792000006000.mp4.preroll.mp4");
   File complete=file(root,a+".complete.mp4");
   File partial=file(root,b+".complete.partial.mp4");
   long twoDaysAgo=System.currentTimeMillis()-2L*24*60*60*1000;
   demand(orphan.setLastModified(twoDaysAgo),"orphan mtime");
   demand(complete.setLastModified(twoDaysAgo),"complete mtime");
   demand(partial.setLastModified(twoDaysAgo),"partial mtime");
   // A raw original with a bad/missing sidecar is present but NOT verified.
   String rawUnverified="motion_1792000010000.mp4";
   file(root,rawUnverified);
   file(root,rawUnverified+".preroll.mp4");
   file(root,"motion_1792000013000.mp4.complete.mp4");
   file(root,"motion_1792000016000.mp4.complete.partial.mp4");
   file(root,"diagnostic_preroll_check.mp4");
   file(root,"unexpected_safe_video.mp4");
   JSONObject result=PhoneArchiveCli.auxiliaryInventory(root,verified);
   demand(result.getInt("raw_mp4_files_seen")==12,"all MP4 filesystem roles included");
   demand(result.getInt("verified_primary_events")==2,"original events only");
   demand(result.getInt("preroll_segments")==3,"preroll counted separately");
   demand(result.getInt("preroll_without_verified_primary")==2,"orphan does not vanish");
   demand(result.getInt("completed_companion_mp4_files")==2,"complete companion separate");
   demand(result.getInt("partial_completion_mp4_files")==2,"partial not independently shown");
   demand(result.getInt("diagnostic_mp4_files")==1,"diagnostic not an event");
   demand(result.getInt("unverified_or_unknown_mp4_files")==2,"unknown kept visible");
   demand(result.getInt("unpaired_preroll_older_than_24h_mtime")==1,"older orphan separately reported");
   demand(result.getInt("completed_companion_older_than_24h_mtime")==1,"older completion reported");
   demand(result.getInt("partial_companion_older_than_24h_mtime")==1,"older partial reported");
   demand(result.getInt("preroll_with_verified_primary")==1,"verified preroll pairing");
   demand(result.getInt("preroll_with_raw_unverified_primary")==1,"raw-but-unverified evidence retained");
   demand(result.getInt("preroll_without_any_primary")==1,"true missing raw primary");
   demand(result.getInt("preroll_without_any_primary_older_than_24h_mtime")==1,"true old missing primary");
   demand(result.getInt("preroll_with_raw_unverified_primary_older_than_24h_mtime")==0,"recent raw-unverified not aged");
   demand(result.getInt("completed_companion_with_verified_primary")==1,"verified completed companion");
   demand(result.getInt("completed_companion_with_raw_unverified_primary")==0,"no unverified completed");
   demand(result.getInt("completed_companion_without_any_primary")==1,"unpaired completed companion");
   demand(result.getInt("partial_companion_with_verified_primary")==1,"verified partial companion");
   demand(result.getInt("partial_companion_without_any_primary")==1,"unpaired partial companion");
   demand(result.getBoolean("auxiliary_pairing_is_filename_presence_only_not_media_integrity"),"pairing not evidence of validity");
   demand(result.getBoolean("mtime_age_only_not_integrity_verdict"),"age not corruption proof");
   demand(result.getBoolean("no_media_quarantined_or_deleted"),"no media edits");
   demand(result.getBoolean("auxiliary_files_are_not_additional_recordings"),"semantics");
   new File(root,b).delete();
   boolean rejected=false;
   try{PhoneArchiveCli.auxiliaryInventory(root,verified);}
   catch(java.io.IOException expected){rejected=true;}
   demand(rejected,"missing verified original must fail closed");
  }finally{
   for(File f:root.listFiles())f.delete();
   root.delete();
  }
  System.out.println("S9_AUXILIARY_INVENTORY_TEST_PASS");
 }
}
