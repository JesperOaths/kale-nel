package nl.kalenel.s9security;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import org.json.JSONObject;

/** Standalone read-only single-original SHA256, not a Camera2 APK component.
 * Fails closed whenever current native camera health is unknown, a clip starts
 * recording, or thermal protection is active. No original is ever changed.
 */
public final class PhoneArchiveIntegrityCli {
 private static final String HOME=
  "/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K";
 private static final class CaptureGate implements PhoneArchiveIntegrity.Gate {
  private long last=0;
  private boolean good=false;
  @Override public boolean allowed(){
   long now=System.nanoTime();
   if(now-last<350_000_000L)return good;
   last=now;good=false;
   HttpURLConnection connection=null;
   try{
    connection=(HttpURLConnection)new URL("http://127.0.0.1:8808/status").openConnection();
    connection.setConnectTimeout(650);connection.setReadTimeout(700);
    if(connection.getResponseCode()!=200)return false;
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    try(InputStream in=connection.getInputStream()){
     byte[] buf=new byte[2048];int n;
     while((n=in.read(buf))>0){
      if(bytes.size()+n>65536)return false;
      bytes.write(buf,0,n);
     }
    }
    JSONObject status=new JSONObject(bytes.toString("UTF-8"));
    Object temperature=status.opt("temperature_c");
    double temp=(temperature instanceof Number)?((Number)temperature).doubleValue():999;
    good=(status.optBoolean("ok",false)&&status.optBoolean("continuous_4k_ready",false)
      &&status.optBoolean("native_4k_enabled",false)
      &&status.optInt("continuous_4k_dropped_output_frames",1)==0
      &&"watching".equals(status.optString("mode"))
      &&temp>=0&&temp<39.0);
    return good;
   }catch(Exception ignored){return false;}
   finally{if(connection!=null)connection.disconnect();}
  }
 }
 public static void main(String[] args) {
  try{
   if(args.length!=2||!HOME.equals(args[0])
      ||!args[1].matches("motion_[0-9]{13}[.]mp4"))
    throw new IllegalArgumentException("bad_original_request");
   File archive=new File(HOME).getCanonicalFile();
   if(!archive.isDirectory()||archive.getUsableSpace()<20L*1024*1024*1024)
    throw new IOException("microSD_reserve_or_archive_unavailable");
   CaptureGate gate=new CaptureGate();
   if(!gate.allowed())throw new IOException("camera_capture_priority_active");
   JSONObject result=PhoneArchiveIntegrity.audit(archive,args[1],gate);
   if(!gate.allowed())throw new IOException("camera_changed_after_hash");
   System.out.println("S9_STANDALONE_ORIGINAL_SHA256 "+result.toString());
  }catch(Exception unavailable){
   System.err.println("S9_STANDALONE_ORIGINAL_SHA256_DEFERRED "+
     unavailable.getClass().getSimpleName());
   System.exit(2);
  }
 }
}
