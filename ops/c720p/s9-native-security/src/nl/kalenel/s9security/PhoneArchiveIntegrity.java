package nl.kalenel.s9security;

import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * An explicitly requested, read-only single-clip SD digest check. NEVER
 * quarantines/deletes/renames originals or modifies their verified manifests.
 * No direct browser exposure: CameraService binds the API to 127.0.0.1.
 *
 * This is an integrity comparison, not new evidence of a person's identity.
 */
final class PhoneArchiveIntegrity {
 static final String VERSION="s9_original_sha256_readonly_v1";
 private static final Pattern VIDEO=Pattern.compile("motion_[0-9]{13}[.]mp4");
 private static final AtomicBoolean ACTIVE=new AtomicBoolean(false);
 private static final long MIN_VIDEO=100000L,MAX_VIDEO=800000000L;
 interface Gate {boolean allowed();}
 private PhoneArchiveIntegrity(){}

 static boolean handle(OutputStream out,String request,File root,Gate gate)throws IOException {
  if(!(request.startsWith("GET /archive/integrity")||
       request.startsWith("HEAD /archive/integrity")))return false;
  if(!request.matches("^GET /archive/integrity[?]clip=motion_[0-9]{13}[.]mp4 HTTP/1[.]1$")){
   simpleError(out,400,"invalid_integrity_request");
   return true;
  }
  String name=request.substring("GET /archive/integrity?clip=".length(),
      request.length()-" HTTP/1.1".length());
  if(root==null||gate==null||!gate.allowed()){
   simpleError(out,503,"capture_priority_or_thermal_guard");
   return true;
  }
  if(!ACTIVE.compareAndSet(false,true)){
   simpleError(out,503,"integrity_worker_busy");
   return true;
  }
  try {
   JSONObject report=audit(root,name,gate);
   respond(out,200,report);
  }catch(InterruptedIOException paused){
   respond(out,503,new JSONObject().put("ok",false).put("error","integrity_deferred_for_capture"));
  }catch(Exception invalid){
   respond(out,503,new JSONObject().put("ok",false).put("error","integrity_unavailable")
       .put("error_type",invalid.getClass().getSimpleName()));
  }finally{
   ACTIVE.set(false);
  }
  return true;
 }

 static JSONObject audit(File folder,String name,Gate gate)throws Exception {
  if(!VIDEO.matcher(name).matches()||folder==null||gate==null)
   throw new IllegalArgumentException("invalid_source");
  File home=folder.getCanonicalFile();
  File video=new File(home,name),sidecar=new File(home,name+".verified.json");
  if(!video.isFile()||!sidecar.isFile()||
     Files.isSymbolicLink(video.toPath())||Files.isSymbolicLink(sidecar.toPath())||
     !video.getCanonicalFile().getParentFile().equals(home)||
     !sidecar.getCanonicalFile().getParentFile().equals(home))
   throw new IOException("noncanonical_or_missing_source");
  long length=video.length();
  if(length<=MIN_VIDEO||length>=MAX_VIDEO)throw new IOException("media_size_out_of_bounds");
  long manifestLength=sidecar.length();
  if(manifestLength<2||manifestLength>32768)throw new IOException("manifest_bounds");
  byte[] buffer=new byte[(int)manifestLength];
  try(InputStream input=new FileInputStream(sidecar)){
   int offset=0,n;
   while(offset<buffer.length&&(n=input.read(buffer,offset,buffer.length-offset))>0)
    offset+=n;
   if(offset!=buffer.length||input.read()!=-1)throw new IOException("manifest_changed");
  }
  JSONObject meta=new JSONObject(new String(buffer,"UTF-8"));
  String expected=meta.optString("sha256","");
  if(!name.equals(meta.optString("name"))||meta.optLong("bytes",-1)!=length||
     meta.optInt("width")!=3840||meta.optInt("height")!=2160||
     !expected.matches("[a-f0-9]{64}"))throw new IOException("invalid_verified_sidecar");
  MessageDigest sha=MessageDigest.getInstance("SHA-256");
  long read=0;
  long start=System.nanoTime();
  byte[] chunk=new byte[131072];
  try(InputStream input=new BufferedInputStream(new FileInputStream(video),131072)){
   int n;
   while((n=input.read(chunk))!=-1){
    if(!gate.allowed())throw new InterruptedIOException("camera_busy");
    if(System.nanoTime()-start>120_000_000_000L)
     throw new InterruptedIOException("integrity_budget_exceeded");
    read+=n;
    if(read>length)throw new IOException("original_changed_during_read");
    sha.update(chunk,0,n);
    Thread.yield();
   }
  }
  if(read!=length||video.length()!=length||!gate.allowed())
   throw new InterruptedIOException("original_changed_or_capture_priority");
  StringBuilder hash=new StringBuilder(64);
  for(byte b:sha.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));
  // False is a *reported mismatch*, not an instruction to remove evidence.
  boolean matches=expected.equals(hash.toString());
  return new JSONObject().put("ok",true).put("schema_version",VERSION)
   .put("clip",name).put("checked_bytes",read)
   .put("sha256_matches_verified_manifest",matches)
   .put("source","S9_microSD_original_4k")
   .put("read_only",true).put("video_copied_to_hub",false)
   .put("media_deleted_or_quarantined",false)
   .put("manual_review_modified",false)
   .put("result",matches?"digest_match":"digest_mismatch_needs_manual_investigation");
 }

 private static void simpleError(OutputStream out,int code,String error)throws IOException{
  byte[] body=("{\"ok\":false,\"error\":\""+error+"\"}").getBytes("UTF-8");
  String reason=code==400?"Bad Request":"Service Unavailable";
  out.write(("HTTP/1.1 "+code+" "+reason+"\r\nContent-Type: application/json\r\n"+
   "Cache-Control: private, no-store\r\nX-Content-Type-Options: nosniff\r\n"+
   "Content-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
  out.write(body);out.flush();
 }
 private static void respond(OutputStream out,int code,JSONObject report)throws IOException {
  byte[] raw=report.toString().getBytes("UTF-8");
  String reason=code==200?"OK":code==400?"Bad Request":"Service Unavailable";
  out.write(("HTTP/1.1 "+code+" "+reason+"\r\nContent-Type: application/json\r\n"+
   "Cache-Control: private, no-store\r\nX-Content-Type-Options: nosniff\r\n"+
   "Content-Length: "+raw.length+"\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
  out.write(raw);out.flush();
 }
}
