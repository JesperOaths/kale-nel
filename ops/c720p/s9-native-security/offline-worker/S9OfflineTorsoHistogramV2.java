package nl.kalenel.s9offline;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Source-hash-verified on-S9 upper-torso HSV32 descriptor for OSNet fallback.
 * A single explicit 8 hue x 2 saturation x 2 value binning is applied to
 * BOTH legacy V40 full-person crops and new offline ROI crops. Never compare
 * the old unknown V40 histogram representation with this new one.
 *
 * Read-only original crop; append-only private descriptor, no auto filing.
 */
public final class S9OfflineTorsoHistogramV2 {
  static final String WORKER="/data/local/tmp/s9_worker/";
  static final String ARCHIVE="/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K/";
  static final Pattern KEY=Pattern.compile("[a-f0-9]{64}");
  static final Pattern V40=Pattern.compile(
      "motion_[0-9]{13}[.]mp4[.]t[1-9][0-9]?[.][a-f0-9]{12}[.]"
     +"(?:v3[789][.]|v44[.])?[0-9]{1,9}[.]full[.]jpg");

  static void require(boolean b,String reason){
    if(!b)throw new IllegalArgumentException(reason);
  }
  static String sha(Path p)throws Exception{
    MessageDigest h=MessageDigest.getInstance("SHA-256");
    try(java.io.InputStream s=Files.newInputStream(p)){
      byte[] buf=new byte[65536];int n;
      while((n=s.read(buf))>0)h.update(buf,0,n);
    }
    StringBuilder out=new StringBuilder(64);
    for(byte x:h.digest())out.append(String.format(Locale.US,"%02x",x&255));
    return out.toString();
  }

  static void execute(Path image,Path dest,String key,String cropSha)throws Exception{
    require(KEY.matcher(key).matches()&&KEY.matcher(cropSha).matches(),
            "Invalid source and crop SHA256");
    String filename=image.getFileName().toString();
    boolean old=V40.matcher(filename).matches()&&
       image.toAbsolutePath().normalize().equals(Paths.get(ARCHIVE+filename));
    boolean newSource=filename.equals(key+".jpg")&&
       image.toAbsolutePath().normalize().equals(Paths.get(WORKER+"inbox/"+filename));
    require(old||newSource,"Only private or V40 full-person crops may be described");
    require(dest.toAbsolutePath().normalize().equals(
       Paths.get(WORKER+"features/"+key+"-hsv-v2.json")),
       "Output must be private versioned descriptor");
    require(Files.isRegularFile(image)&&!Files.isSymbolicLink(image)
         &&Files.size(image)>100&&Files.size(image)<12_000_000,
         "Missing or invalid crop original");
    require(!Files.exists(dest)&&!Files.isSymbolicLink(dest),
         "Existing histograms must not be overwritten");
    require(cropSha.equals(sha(image)),"Person crop SHA256 mismatch");
    BitmapFactory.Options bounds=new BitmapFactory.Options();
    bounds.inJustDecodeBounds=true;
    BitmapFactory.decodeFile(image.toString(),bounds);
    require(bounds.outWidth>=40&&bounds.outHeight>=90
        &&bounds.outWidth<=4000&&bounds.outHeight<=4000,
        "Person crop resolution invalid");
    BitmapFactory.Options opts=new BitmapFactory.Options();
    opts.inSampleSize=(bounds.outWidth>1600||bounds.outHeight>1600)?2:1;
    opts.inPreferredConfig=Bitmap.Config.ARGB_8888;
    Bitmap bmp=BitmapFactory.decodeFile(image.toString(),opts);
    require(bmp!=null,"Could not decode verified person crop");
    int[] bins=new int[32];
    int total=0;
    try{
      int w=bmp.getWidth(),h=bmp.getHeight();
      // Exclude head/face region and person-box edges. Use the same
      // normalized upper torso area across old and new full-body crops.
      int x0=(int)(w*.20),x1=(int)(w*.80);
      int y0=(int)(h*.25),y1=(int)(h*.56);
      require(x1>x0+10&&y1>y0+10,"Upper torso patch too small");
      float[] hsv=new float[3];
      int step=Math.max(1,Math.max(w,h)/640);
      for(int y=y0;y<y1;y+=step){
        for(int x=x0;x<x1;x+=step){
          Color.colorToHSV(bmp.getPixel(x,y),hsv);
          if(!Float.isFinite(hsv[0])||!Float.isFinite(hsv[1])
              ||!Float.isFinite(hsv[2]))continue;
          int hue=Math.min(7,Math.max(0,(int)(hsv[0]/45f)));
          int sat=hsv[1]>=.42f?1:0;
          int value=hsv[2]>=.48f?1:0;
          bins[hue*4+sat*2+value]++;
          total++;
        }
      }
    }finally{bmp.recycle();}
    require(total>=200,"Insufficient valid torso-pixel samples");
    JSONArray hist=new JSONArray();
    for(int b:bins)hist.put((double)b/total);
    JSONObject out=new JSONObject();
    out.put("schema","s9_uniform_upper_torso_hsv32_v2");
    out.put("method","hue8_saturation2_value2_center_torso_v2");
    out.put("source_qualified_key",key);
    out.put("crop_sha256",cropSha);
    out.put("upper_hsv32",hist);
    out.put("reference_eligible",true);
    out.put("identity_probability",false);
    out.put("verified_same_person",false);
    out.put("human_review_required",true);
    Files.createDirectories(dest.getParent());
    Path pending=Files.createTempFile(dest.getParent(),".hsv-v2-",".tmp");
    try{
      Files.write(pending,(out.toString()+"\n").getBytes(StandardCharsets.UTF_8));
      Files.move(pending,dest,StandardCopyOption.ATOMIC_MOVE);
    }finally{Files.deleteIfExists(pending);}
    System.out.println("S9_UNIFORM_TORSO_HSV32_V2_WRITTEN bins=32 "+
                       "samples="+total+" human_review=true");
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }

  public static void main(String[] argv)throws Exception {
    require(argv.length==5&&argv[0].equals("--extract"),
        "Usage: --extract verifiedFullPerson.jpg result.json sha_key crop_sha");
    execute(Paths.get(argv[1]),Paths.get(argv[2]),argv[3],argv[4]);
  }
}
