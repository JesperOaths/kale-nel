package nl.kalenel.s9security;
import java.io.*;
import java.util.*;
import org.json.*;

/** Fail-closed owner-verification work list, supplied by the private hub. */
public final class VisualReviewQueue {
 public static final String VERSION="owner_verified_4k_review_v37";
 private static JSONObject read(File directory)throws Exception{
  File file=new File(directory,"visual-review-queue-v37.json");
  if(!file.isFile()||file.length()>64000)throw new IOException("review_queue_unavailable");
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();
  try(InputStream in=new FileInputStream(file)){byte[] b=new byte[4096];int n;while((n=in.read(b))>0){bytes.write(b,0,n);if(bytes.size()>64000)throw new IOException("review_queue_oversize");}}
  JSONObject q=new JSONObject(bytes.toString("UTF-8"));long now=System.currentTimeMillis(),made=q.getLong("issued_ms");
  if(!VERSION.equals(q.optString("version"))||now<made-60000||now-made>600000||q.getJSONArray("clips").length()>128)throw new IOException("review_queue_stale_or_invalid");
  return q;
 }
 public static boolean permits(File clip){
  try{
   if(!clip.getName().matches("motion_[0-9]{13}[.]mp4"))return false;
   JSONArray all=read(clip.getParentFile()).getJSONArray("clips");
   for(int i=0;i<all.length();i++){
    JSONObject row=all.getJSONObject(i);
    if(clip.getName().equals(row.optString("name"))&&row.optLong("bytes")==clip.length()&&row.optBoolean("human_verified"))return true;
   }
  }catch(Exception unavailable){}return false;
 }
 public static File[] clips(File directory){
  List<File> result=new ArrayList<>();
  try{
   JSONArray all=read(directory).getJSONArray("clips");Set<String> seen=new HashSet<>();
   for(int i=0;i<all.length();i++){
    String name=all.getJSONObject(i).optString("name");
    if(!name.matches("motion_[0-9]{13}[.]mp4")||!seen.add(name))continue;
    File clip=new File(directory,name);if(clip.isFile()&&permits(clip))result.add(clip);
   }
  }catch(Exception unavailable){}return result.toArray(new File[0]);
 }
 public static boolean completed(File clip){
  File sidecar=new File(clip.getParentFile(),clip.getName()+".visual-v36.json");
  if(!sidecar.isFile()||sidecar.length()>500000)return false;
  try{
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();
   try(InputStream in=new FileInputStream(sidecar)){byte[] b=new byte[4096];int n;while((n=in.read(b))>0){bytes.write(b,0,n);if(bytes.size()>500000)return false;}}
   JSONObject meta=new JSONObject(bytes.toString("UTF-8"));
   return ClipReviewSchedule.VERSION.equals(meta.optString("sampling_version"))&&meta.optLong("bytes")==clip.length();
  }catch(Exception invalid){return false;}
 }
}
