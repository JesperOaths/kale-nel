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
   file(root,"diagnostic_preroll_check.mp4");
   file(root,"unexpected_safe_video.mp4");
   JSONObject result=PhoneArchiveCli.auxiliaryInventory(root,verified);
   demand(result.getInt("raw_mp4_files_seen")==8,"all MP4 filesystem roles included");
   demand(result.getInt("verified_primary_events")==2,"original events only");
   demand(result.getInt("preroll_segments")==2,"preroll counted separately");
   demand(result.getInt("preroll_without_verified_primary")==1,"orphan does not vanish");
   demand(result.getInt("completed_companion_mp4_files")==1,"complete companion separate");
   demand(result.getInt("partial_completion_mp4_files")==1,"partial not independently shown");
   demand(result.getInt("diagnostic_mp4_files")==1,"diagnostic not an event");
   demand(result.getInt("unverified_or_unknown_mp4_files")==1,"unknown kept visible");
   demand(result.getInt("unpaired_preroll_older_than_24h_mtime")==1,"older orphan separately reported");
   demand(result.getInt("completed_companion_older_than_24h_mtime")==1,"older completion reported");
   demand(result.getInt("partial_companion_older_than_24h_mtime")==1,"older partial reported");
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
