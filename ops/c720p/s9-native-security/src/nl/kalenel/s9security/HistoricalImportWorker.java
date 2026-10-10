package nl.kalenel.s9security;

import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** Isolated GPU/CPU historical review queue. Never reads or mutates Security4K recordings. */
final class HistoricalImportWorker {
 static final Pattern IDENTIFIER=Pattern.compile("[0-9a-f]{64}");
 static final Pattern SOURCE_NAME=Pattern.compile("(?:NEW|S3|S9PHONE)_[A-Za-z0-9._-]{8,165}[.]mp4");
 static final long MAX_MP4_BYTES=650L*1024*1024;
 private final File appStorage;
 private final ClipClassifier classifier;
 HistoricalImportWorker(File root,ClipClassifier net){appStorage=root;classifier=net;}

 static boolean valid(String id){return id!=null&&IDENTIFIER.matcher(id).matches();}
 static String hex(byte[] bytes){
  StringBuilder b=new StringBuilder();
  for(byte x:bytes)b.append(String.format(Locale.US,"%02x",x&0xff));
  return b.toString();
 }
 static String digest(File f)throws Exception {
  MessageDigest md=MessageDigest.getInstance("SHA-256");
  try(FileInputStream in=new FileInputStream(f)){
   byte[] buf=new byte[131072];int n;
   while((n=in.read(buf))>0)md.update(buf,0,n);
  }
  return hex(md.digest());
 }
 static JSONObject descriptor(File f)throws Exception{
  if(!f.isFile()||f.length()<40||f.length()>4096)throw new IOException("invalid_import_descriptor");
  byte[] data=new byte[(int)f.length()];
  try(FileInputStream in=new FileInputStream(f)){
   int off=0,n;
   while(off<data.length&&(n=in.read(data,off,data.length-off))>0)off+=n;
   if(off!=data.length||in.read()!=-1)throw new IOException("descriptor_incomplete");
  }
  return new JSONObject(new String(data,"UTF-8"));
 }

 /** At most one verified historical clip; returning 0 means no staged work. */
 int processOne()throws Exception {
  File inbox=new File(appStorage,"HistoricalDriveInbox");
  if(!inbox.isDirectory())return 0;
  File[] entries=inbox.listFiles((dir,name)->name.matches("history_[a-f0-9]{64}[.]ready[.]json"));
  if(entries==null||entries.length==0)return 0;
  Arrays.sort(entries,Comparator.comparing(File::getName));
  for(File ready:entries){
   String file=ready.getName();
   String id=file.substring("history_".length(),"history_".length()+64);
   if(!valid(id))continue;
   File mp4=new File(inbox,"history_"+id+".mp4");
   File resultFile=new File(inbox,"history_"+id+".result.json");
   if(resultFile.exists()||!mp4.isFile())continue;
   if(!mp4.getCanonicalFile().getParentFile().equals(inbox.getCanonicalFile()))
    throw new IOException("import_path_escaped");
   if(mp4.length()<100000||mp4.length()>MAX_MP4_BYTES)
    throw new IOException("import_media_size_invalid");
   JSONObject meta=descriptor(ready);
   String camera=meta.optString("camera","");
   String source=meta.optString("source_remote_name","");
   String hash=meta.optString("source_sha256","");
   if(!id.equals(meta.optString("clip_id",""))||
      !("new".equals(camera)||"s3".equals(camera))||
      !SOURCE_NAME.matcher(source).matches()||
      !source.startsWith("s3".equals(camera)?"S3_":"NEW_")&&
        !("new".equals(camera)&&source.startsWith("S9PHONE_"))||
      !valid(hash)||meta.optLong("bytes",-1)!=mp4.length())
    throw new IOException("invalid_import_provenance");
   if(!hash.equals(digest(mp4)))throw new IOException("import_digest_mismatch");
   // Classifier processes only staged MP4. Historical results remain segregated.
   JSONObject data=classifier.process(mp4,inbox,mp4.getName(),"historical_drive_import",0);
   data.put("archive","historical_drive_import_isolated");
   data.put("source","verified_historical_google_drive");
   data.put("source_camera",camera);
   data.put("source_clip_id",id);
   data.put("source_remote_name",source);
   data.put("source_sha256",hash);
   data.put("import_status","classified_pending_hub_ack");
   data.put("historical_identity","unverified_no_biometric_matching");
   data.put("classified_frames_not_entire_video",true);
   ClipClassifier.writeJson(resultFile,data);
   return 1;
  }
  return 0;
 }
}
