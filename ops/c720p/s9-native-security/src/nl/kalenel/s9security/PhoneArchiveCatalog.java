package nl.kalenel.s9security;

import java.io.*;
import java.net.URLDecoder;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Read-only, loopback-only SD metadata/delta and JPEG serving.
 * Does not decode videos, alter originals, authorize reviews or identify people.
 * The signed hub relay remains the only browser-facing access path.
 */
final class PhoneArchiveCatalog {
 static final String VERSION="s9_native_archive_catalog_v1";
 private static final Pattern VIDEO=Pattern.compile("motion_[0-9]{13}[.]mp4");
 private static final Pattern FACE=Pattern.compile("motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg");
 private static final int MAX_MANIFEST=32768,MAX_TOTAL=8*1024*1024,MAX_FILES=2000;
 private static Snapshot current,previous;
 private static final class Snapshot {
  String id;long at;File folder;int pendingSidecars;
  final TreeMap<String,JSONObject> rows=new TreeMap<>();
  final JSONArray errors=new JSONArray();
 }
 private PhoneArchiveCatalog(){}
 private static String hex(byte[] raw){StringBuilder s=new StringBuilder();for(byte b:raw)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 private static byte[] read(File file,int bound)throws IOException{
  long length=file.length();if(length<2||length>bound)throw new IOException("file_size");
  try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream((int)length)){
   byte[] b=new byte[4096];int n;
   while((n=in.read(b))!=-1){if(out.size()+n>bound)throw new IOException("file_growth");out.write(b,0,n);}
   if(out.size()!=length)throw new IOException("file_changed");return out.toByteArray();
  }
 }
 private static synchronized Snapshot snapshot(File folder)throws Exception{
  long now=System.nanoTime();File home=folder.getCanonicalFile();
  if(current!=null&&home.equals(current.folder)&&now-current.at<15_000_000_000L)return current;
  File[] videos=home.listFiles((d,n)->VIDEO.matcher(n).matches());
  if(videos==null||videos.length>MAX_FILES)throw new IOException("archive_unavailable_or_too_large");
  Arrays.sort(videos,Comparator.comparing(File::getName));
  Snapshot next=new Snapshot();next.folder=home;next.at=now;
  MessageDigest generation=MessageDigest.getInstance("SHA-256");int total=0;
  for(File video:videos){
   String name=video.getName();
   try{
    if(!video.getCanonicalFile().getParentFile().equals(home))throw new IOException("video_path");
    long size=video.length();File sidecar=new File(home,name+".verified.json");
    // A just-finalized MP4 may still be awaiting its native classifier. It
    // becomes catalog eligible only after its verified sidecar is published.
    if(!sidecar.isFile()){next.pendingSidecars++;continue;}
    if(!sidecar.getCanonicalFile().getParentFile().equals(home))throw new IOException("sidecar_path");
    byte[] bytes=read(sidecar,MAX_MANIFEST);total+=bytes.length;
    if(total>MAX_TOTAL)throw new IOException("catalog_memory_budget");
    JSONObject manifest=new JSONObject(new String(bytes,"UTF-8"));
    if(!name.equals(manifest.optString("name"))||manifest.optLong("bytes",-1)!=size||
       size<=100000||size>=800000000||manifest.optInt("width")!=3840||manifest.optInt("height")!=2160||
       !manifest.optString("sha256").matches("[a-f0-9]{64}"))throw new IOException("manifest_contract");
    File thumb=new File(home,name+".thumb.jpg");
    boolean hasThumb=thumb.isFile()&&thumb.length()>4000&&thumb.length()<2200000&&
      thumb.getCanonicalFile().getParentFile().equals(home);
    String thumbKey=hasThumb?thumb.length()+":"+thumb.lastModified():"";
    MessageDigest digest=MessageDigest.getInstance("SHA-256");digest.update(bytes);
    digest.update((":"+size+":"+thumbKey).getBytes("UTF-8"));String version=hex(digest.digest());
    JSONObject entry=new JSONObject().put("name",name).put("bytes",size)
      .put("version",version).put("thumbnail",hasThumb).put("thumbnail_version",thumbKey)
      .put("manifest",manifest);
    next.rows.put(name,entry);generation.update((name+":"+version+"\n").getBytes("UTF-8"));
   }catch(Exception invalid){next.errors.put(name+":"+invalid.getClass().getSimpleName());}
   if(total>MAX_TOTAL)throw new IOException("catalog_memory_budget");
  }
  if(total>MAX_TOTAL)throw new IOException("catalog_memory_budget");
  generation.update(next.errors.toString().getBytes("UTF-8"));
  generation.update((":pending:"+next.pendingSidecars).getBytes("UTF-8"));
  next.id=hex(generation.digest());
  if(current!=null&&current.id.equals(next.id)){current.at=now;return current;}
  previous=current;current=next;return current;
 }
 /** Source-local observation counts, not unique people, dwell time or identity matches.
  * Uses already parsed sidecars from a pinned snapshot, never decodes video
  * or changes recording/review/retention state. Hour offsets disambiguate DST.
  */
 private static JSONObject summary(Snapshot s)throws Exception{
  final TimeZone zone=TimeZone.getTimeZone("Europe/Amsterdam");
  final TreeMap<String,Integer> hours=new TreeMap<>(),days=new TreeMap<>();
  long totalBytes=0,reportedDurationMs=0;
  int durationMeasured=0,withThumb=0,personCandidateClips=0;
  for(Map.Entry<String,JSONObject> item:s.rows.entrySet()){
   JSONObject record=item.getValue(),manifest=record.getJSONObject("manifest");
   String name=item.getKey();
   long epoch=Long.parseLong(name.substring(7,20));
   Calendar local=Calendar.getInstance(zone,Locale.ROOT);local.setTimeInMillis(epoch);
   int hour=local.get(Calendar.HOUR_OF_DAY);
   int offsetMinutes=(local.get(Calendar.ZONE_OFFSET)+local.get(Calendar.DST_OFFSET))/60000;
   String offset=String.format(Locale.ROOT,"%c%02d%02d",
     offsetMinutes>=0?'+':'-',Math.abs(offsetMinutes)/60,Math.abs(offsetMinutes)%60);
   String hourKey=String.format(Locale.ROOT,"%04d-%02d-%02dT%02d%s",
     local.get(Calendar.YEAR),local.get(Calendar.MONTH)+1,local.get(Calendar.DAY_OF_MONTH),hour,offset);
   hours.put(hourKey,hours.containsKey(hourKey)?hours.get(hourKey)+1:1);
   // An operating day starts at 06:00 local, including DST transitions.
   if(hour<6)local.add(Calendar.DAY_OF_MONTH,-1);
   String dayKey=String.format(Locale.ROOT,"%04d-%02d-%02d",
     local.get(Calendar.YEAR),local.get(Calendar.MONTH)+1,local.get(Calendar.DAY_OF_MONTH));
   days.put(dayKey,days.containsKey(dayKey)?days.get(dayKey)+1:1);
   totalBytes+=record.getLong("bytes");
   if(record.optBoolean("thumbnail",false))withThumb++;
   int claim=manifest.optInt("person_count",0);
   if(claim>0&&claim<=20)personCandidateClips++;
   long duration=manifest.optLong("duration_ms",-1);
   if(duration>0&&duration<=120000){reportedDurationMs+=duration;durationMeasured++;}
  }
  JSONObject hourly=new JSONObject(),daily=new JSONObject();
  for(Map.Entry<String,Integer> entry:hours.entrySet())hourly.put(entry.getKey(),entry.getValue());
  for(Map.Entry<String,Integer> entry:days.entrySet())daily.put(entry.getKey(),entry.getValue());
  long free=Math.max(0,s.folder.getUsableSpace()),capacity=Math.max(0,s.folder.getTotalSpace());
  return new JSONObject().put("ok",true).put("schema_version","s9_native_archive_summary_v1")
    .put("snapshot_id",s.id).put("source","S9_native_microSD_sidecar_metadata")
    .put("timezone","Europe/Amsterdam").put("operating_day_start_hour",6)
    .put("hourly_recording_counts",hourly).put("daily_recording_counts",daily)
    .put("recordings",s.rows.size()).put("sidecar_claimed_video_bytes",totalBytes)
    .put("manifest_duration_ms_total",reportedDurationMs).put("duration_measurement_count",durationMeasured)
    .put("thumbnail_present_count",withThumb).put("person_candidate_recording_count",personCandidateClips)
    .put("pending_sidecar_count",s.pendingSidecars).put("catalog_error_count",s.errors.length())
    .put("sd_usable_bytes",free).put("sd_total_bytes",capacity)
    .put("media_digest_recheck_performed",false).put("counts_are_recordings_not_distinct_people",true)
    .put("read_only",true).put("video_decode_performed",false);
 }
 private static Map<String,String> query(String target)throws Exception{
  Map<String,String> args=new HashMap<>();int q=target.indexOf('?');
  if(q<0)return args;
  for(String pair:target.substring(q+1).split("&")){
   String[] parts=pair.split("=",-1);
   if(parts.length!=2)throw new IllegalArgumentException();
   String key=URLDecoder.decode(parts[0],"UTF-8"),value=URLDecoder.decode(parts[1],"UTF-8");
   if(!Arrays.asList("since","snapshot","cursor","limit").contains(key)||args.put(key,value)!=null)
    throw new IllegalArgumentException();
  }return args;
 }
 static boolean handle(OutputStream out,String line,File folder)throws IOException{
  if(!(line.startsWith("GET /archive/")||line.startsWith("HEAD /archive/")))return false;
  boolean head=line.startsWith("HEAD ");
  try{
   if(line.length()>400||folder==null||!line.endsWith(" HTTP/1.1"))throw new IllegalArgumentException();
   String target=line.substring(head?5:4,line.length()-9);
   if(target.startsWith("/archive/asset/")){
    asset(out,target.substring(15),folder,head);return true;
   }
   if(target.equals("/archive/summary")){
    if(head)throw new IllegalArgumentException();
    Thread.currentThread().setPriority(Thread.MIN_PRIORITY);
    JSONObject overview;
    synchronized(PhoneArchiveCatalog.class){overview=summary(snapshot(folder));}
    json(out,200,overview);return true;
   }
   if(head||!(target.equals("/archive/catalog")||target.startsWith("/archive/catalog?")))throw new IllegalArgumentException();
   Map<String,String> args=query(target);String since=args.get("since"),pin=args.get("snapshot");
   for(String value:new String[]{since,pin})if(value!=null&&!value.matches("[a-f0-9]{64}"))throw new IllegalArgumentException();
   int cursor=Integer.parseInt(args.getOrDefault("cursor","0")),limit=Integer.parseInt(args.getOrDefault("limit","40"));
   if(cursor<0||cursor>MAX_FILES||limit<1||limit>50)throw new IllegalArgumentException();
   Thread.currentThread().setPriority(Thread.MIN_PRIORITY);
   JSONObject payload;
   synchronized(PhoneArchiveCatalog.class){
    Snapshot s=snapshot(folder);
    if(pin!=null&&!pin.equals(s.id)){json(out,409,new JSONObject().put("ok",false).put("error","snapshot_changed"));return true;}
    Snapshot base=since!=null&&s.id.equals(since)?s:
      previous!=null&&previous.id.equals(since)&&previous.folder.equals(s.folder)?previous:null;
    String mode=base==s?"unchanged":base!=null?"delta":"full";
    ArrayList<JSONObject> changes=new ArrayList<>();JSONArray removed=new JSONArray();
    for(Map.Entry<String,JSONObject> item:s.rows.entrySet()){
     JSONObject prior=base==null?null:base.rows.get(item.getKey());
     if(prior==null||!prior.getString("version").equals(item.getValue().getString("version")))changes.add(item.getValue());
    }
    if(base!=null)for(String name:base.rows.keySet())if(!s.rows.containsKey(name))removed.put(name);
    if(cursor>changes.size())throw new IllegalArgumentException();
    JSONArray page=new JSONArray();int end=Math.min(changes.size(),cursor+limit);
    for(int i=cursor;i<end;i++)page.put(changes.get(i));
    payload=new JSONObject().put("ok",true).put("schema_version",VERSION).put("snapshot_id",s.id)
      .put("mode",mode).put("records",page).put("removed",cursor==0?removed:new JSONArray())
      .put("errors",s.errors).put("total_records",s.rows.size()).put("change_count",changes.size())
      .put("cursor",cursor).put("next_cursor",end<changes.size()?end:JSONObject.NULL)
      .put("read_only",true).put("video_decode_performed",false);
   }
   json(out,200,payload);return true;
  }catch(IOException io){throw io;}
   catch(IllegalArgumentException invalid){send(out,400,"application/json","{\"ok\":false,\"error\":\"invalid_archive_request\"}".getBytes("UTF-8"),false);}
   catch(Exception unavailable){send(out,503,"application/json","{\"ok\":false,\"error\":\"archive_temporarily_unavailable\"}".getBytes("UTF-8"),false);}
  return true;
 }
 private static void asset(OutputStream out,String name,File folder,boolean head)throws Exception{
  File home=folder.getCanonicalFile(),asset;
  if(name.matches("motion_[0-9]{13}[.]mp4[.]thumb[.]jpg"))asset=new File(home,name);
  else if(FACE.matcher(name).matches()) {
   File faces=new File(home,"FaceSnapshots").getCanonicalFile();
   if(!faces.getParentFile().equals(home)){send(out,404,"image/jpeg",new byte[0],head);return;}
   home=faces;asset=new File(home,name);
  }
  else{send(out,404,"image/jpeg",new byte[0],head);return;}
  if(!asset.getCanonicalFile().getParentFile().equals(home)||!asset.isFile()||asset.length()<512||asset.length()>2200000){send(out,404,"image/jpeg",new byte[0],head);return;}
  byte[] jpeg=read(asset,2200000);
  if(jpeg[0]!=(byte)0xff||jpeg[1]!=(byte)0xd8||jpeg[2]!=(byte)0xff)throw new IOException("invalid_jpeg");
  send(out,200,"image/jpeg",jpeg,head);
 }
 private static void json(OutputStream out,int status,JSONObject value)throws IOException{send(out,status,"application/json",value.toString().getBytes("UTF-8"),false);}
 private static void send(OutputStream out,int status,String type,byte[] data,boolean head)throws IOException{
  String reason=status==200?"OK":status==400?"Bad Request":status==404?"Not Found":status==409?"Conflict":"Service Unavailable";
  out.write(("HTTP/1.1 "+status+" "+reason+"\r\nContent-Type: "+type+"\r\nContent-Length: "+data.length+
   "\r\nCache-Control: private, no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
  if(!head)out.write(data);out.flush();
 }
}
