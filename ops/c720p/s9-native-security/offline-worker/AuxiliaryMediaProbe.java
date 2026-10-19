package nl.kalenel.s9security;

import android.media.MediaExtractor;
import android.media.MediaFormat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.Comparator;

/**
 * Isolated Android shell-process read-only structural sample probe.
 * NEVER decodes footage, modifies a recording, starts the camera, or makes
 * an identity decision. Runs separately from the Camera2 APK.
 *
 * Output is evidence of a readable compressed video track and samples,
 * NOT proof that every video frame is decodable or that the clip contains
 * a person. Files with an absent original remain protected.
 */
public final class AuxiliaryMediaProbe {
 private static final String ARCHIVE="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K";
 private static final String PREFIX="S9_AUXILIARY_MEDIA_PROBE ";
 private static final int MAX_FILES=12, MAX_LIST=20000, MAX_ROWS=700;
 private static final long MAX_BYTES=32000000L;
 static String role(String name) {
  if(name.matches("motion_[0-9]{13}[.]mp4[.]preroll[.]mp4"))return "preroll";
  if(name.matches("motion_[0-9]{13}[.]mp4[.]complete[.]partial[.]mp4"))return "partial";
  if(name.matches("motion_[0-9]{13}[.]mp4[.]complete[.]mp4"))return "complete";
  return "";
 }
 static String primary(String name){
  String r=role(name);
  if(r.equals("preroll"))return name.substring(0,name.length()-".preroll.mp4".length());
  if(r.equals("complete"))return name.substring(0,name.length()-".complete.mp4".length());
  if(r.equals("partial"))return name.substring(0,name.length()-".complete.partial.mp4".length());
  return "";
 }
 static boolean original(String name){return name.matches("motion_[0-9]{13}[.]mp4");}
 private static JSONObject inspect(File f,String role)throws Exception{
  JSONObject row=new JSONObject().put("name",f.getName()).put("role",role)
      .put("bytes",f.length()).put("read_only",true);
  if(f.length()<256||f.length()>MAX_BYTES) {
   return row.put("status","size_outside_probe_limits");
  }
  if(f.lastModified()<=0||f.lastModified()>System.currentTimeMillis()-120000L) {
   return row.put("status","possibly_active_or_untrusted_mtime");
  }
  MediaExtractor reader=new MediaExtractor();
  try {
   reader.setDataSource(f.getAbsolutePath());
   int track=-1;
   MediaFormat video=null;
   for(int i=0;i<Math.min(reader.getTrackCount(),8);i++){
    MediaFormat test=reader.getTrackFormat(i);
    String mime=test.containsKey(MediaFormat.KEY_MIME)?test.getString(MediaFormat.KEY_MIME):"";
    if(mime!=null&&mime.startsWith("video/")){track=i;video=test;break;}
   }
   if(track<0)return row.put("status","no_video_track");
   String mime=video.getString(MediaFormat.KEY_MIME);
   int width=video.containsKey(MediaFormat.KEY_WIDTH)?video.getInteger(MediaFormat.KEY_WIDTH):0;
   int height=video.containsKey(MediaFormat.KEY_HEIGHT)?video.getInteger(MediaFormat.KEY_HEIGHT):0;
   long duration=video.containsKey(MediaFormat.KEY_DURATION)?video.getLong(MediaFormat.KEY_DURATION):0;
   row.put("mime",mime).put("width",width).put("height",height)
      .put("duration_us",duration);
   if(width<1||height<1||width>4096||height>2160||
      !("video/avc".equals(mime)||"video/hevc".equals(mime))) {
    return row.put("status","untrusted_video_format");
   }
   reader.selectTrack(track);
   ByteBuffer buf=ByteBuffer.allocate(524288);
   int samples=0;
   for(int i=0;i<2;i++){
    buf.clear();
    int size=reader.readSampleData(buf,0);
    if(size<=0)break;
    samples++;
    if(!reader.advance())break;
   }
   row.put("compressed_samples_read",samples);
   return row.put("status",samples>0?"compressed_video_samples_read":"no_video_samples");
  }catch(Exception e){
   return row.put("status","extractor_unavailable_or_incomplete")
      .put("error_type",e.getClass().getSimpleName());
  }finally{reader.release();}
 }
 private static JSONArray scan(int offset,int limit)throws Exception {
  File base=new File(ARCHIVE);
  if(Files.isSymbolicLink(base.toPath()))throw new IllegalStateException("archive_symlink");
  if(!base.isDirectory()||!base.canRead()||!ARCHIVE.equals(base.getCanonicalPath()))
   throw new IllegalStateException("untrusted_archive_path");
  File[] all=base.listFiles();
  if(all==null||all.length>MAX_LIST)throw new IllegalStateException("unbounded_directory");
  Set<String> originalNames=new HashSet<>();
  for(File f:all)if(f.isFile()&&!Files.isSymbolicLink(f.toPath())&&original(f.getName()))
   originalNames.add(f.getName());
  List<File> candidates=new ArrayList<>();
  for(File f:all){
   if(!f.isFile()||Files.isSymbolicLink(f.toPath()))continue;
   String name=f.getName();
   if(!role(name).isEmpty()&&!originalNames.contains(primary(name)))candidates.add(f);
  }
  if(candidates.size()>MAX_ROWS)throw new IllegalStateException("unbounded_candidates");
  candidates.sort(Comparator.comparing(File::getName));
  JSONArray rows=new JSONArray();
  int end=Math.min(candidates.size(),offset+limit);
  for(int i=offset;i<end;i++){
   File f=candidates.get(i);
   if(!ARCHIVE.equals(f.getCanonicalFile().getParent()))throw new IllegalStateException("unexpected_file_path");
   rows.put(inspect(f,role(f.getName())));
  }
  return new JSONArray().put(candidates.size()).put(rows);
 }
 public static void main(String[] args){
  try{
   if(args.length!=2)throw new IllegalArgumentException("expected_offset_and_limit");
   int offset=Integer.parseInt(args[0]),limit=Integer.parseInt(args[1]);
   if(offset<0||offset>MAX_ROWS||limit<1||limit>MAX_FILES)
    throw new IllegalArgumentException("out_of_bounds");
   JSONArray result=scan(offset,limit);
   JSONObject reply=new JSONObject()
     .put("schema_version","s9_auxiliary_media_probe_v1")
     .put("total_unpaired_auxiliary_files",result.getInt(0))
     .put("offset",offset).put("batch_size",limit)
     .put("rows",result.getJSONArray(1))
     .put("video_decoded",false)
     .put("no_recording_bytes_transferred_to_hub",true)
     .put("files_modified",false)
     .put("manual_reviews_modified",false);
   System.out.println(PREFIX+reply.toString());
  }catch(Throwable failure){
   System.err.println("S9_AUXILIARY_MEDIA_PROBE_UNAVAILABLE "+failure.getClass().getSimpleName());
   System.exit(2);
  }
 }
}
