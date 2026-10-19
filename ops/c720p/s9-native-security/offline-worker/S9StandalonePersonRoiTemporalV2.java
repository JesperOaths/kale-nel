package nl.kalenel.s9offline;

import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import org.json.JSONArray;
import org.json.JSONObject;
import org.tensorflow.lite.Interpreter;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * A separate app_process CPU-only person ROI scanner for already saved MP4s.
 * Uses a SHA-verified read-only COPY of the live APK's quantized SSD person
 * detector. Does not call Camera2, import the camera service, or change the
 * original video, its manifest, a person assignment, or an old crop.
 *
 * Exactly one best legitimate single-person frame/crop per clip, max 3 reads.
 * Produces an unassigned JPEG and provenance sidecar for the standalone
 * ONNX OSNet worker; detection itself never asserts personal identity.
 */
public final class S9StandalonePersonRoiTemporalV2 {
  static final String ARCHIVE="/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K/";
  static final String WORKER="/data/local/tmp/s9_worker/";
  static final String MODEL=WORKER+"models/person_detect.tflite";
  static final String LABELS=WORKER+"models/labelmap.txt";
  static final String MODEL_SHA="e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13";
  static final String LABEL_SHA="c7e79c855f73cbba9f33d649d60e1676eb0a974021a41696d1ac0d4b7f7e0211";
  static final Pattern CLIP=Pattern.compile("motion_[0-9]{13}[.]mp4");
  static final Pattern KEY=Pattern.compile("[a-f0-9]{64}");
  static final int WIDTH=300,HEIGHT=300;
  static void require(boolean ok,String why) {
    if(!ok)throw new IllegalArgumentException(why);
  }
  static String hash(Path file)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream stream=Files.newInputStream(file)){
      byte[] bytes=new byte[65536];int n;
      while((n=stream.read(bytes))>0)md.update(bytes,0,n);
    }
    StringBuilder h=new StringBuilder(64);
    for(byte v:md.digest())h.append(String.format(Locale.US,"%02x",v&255));
    return h.toString();
  }
  static final class Candidate {
    Bitmap frame;
    int left,top,width,height;
    long timeMs;
    float confidence;
  }
  static Candidate detect(Interpreter net,Bitmap frame,long timeMs,String[] labels)throws Exception {
    Bitmap resized=Bitmap.createScaledBitmap(frame,WIDTH,HEIGHT,true);
    ByteBuffer input=ByteBuffer.allocateDirect(WIDTH*HEIGHT*3)
      .order(ByteOrder.nativeOrder());
    int[] px=new int[WIDTH*HEIGHT];
    resized.getPixels(px,0,WIDTH,0,0,WIDTH,HEIGHT);
    for(int pixel:px) {
      input.put((byte)((pixel>>16)&255));
      input.put((byte)((pixel>>8)&255));
      input.put((byte)(pixel&255));
    }
    input.rewind();
    if(resized!=frame)resized.recycle();
    float[][][] boxes=new float[1][10][4];
    float[][] classes=new float[1][10],scores=new float[1][10];
    float[] count=new float[1];
    java.util.HashMap<Integer,Object> outputs=new java.util.HashMap<>();
    outputs.put(0,boxes);outputs.put(1,classes);
    outputs.put(2,scores);outputs.put(3,count);
    net.runForMultipleInputsOutputs(new Object[]{input},outputs);
    List<Integer> persons=new ArrayList<>();
    for(int i=0;i<Math.min(10,Math.max(0,Math.round(count[0])));i++){
      int idx=Math.round(classes[0][i])+1;
      if(idx>=0&&idx<labels.length&&
         "person".equals(labels[idx])&&scores[0][i]>=.45f)
        persons.add(i);
    }
    // A mixture of multiple people must never become a single outfit.
    if(persons.size()!=1)return null;
    int i=persons.get(0);
    float score=scores[0][i];
    if(score<.56f)return null;
    float[] b=boxes[0][i];
    for(float v:b)if(!Float.isFinite(v)||v<-.01f||v>1.01f)return null;
    float top=b[0],left=b[1],bottom=b[2],right=b[3];
    if(top<=.012f||left<=.012f||bottom>=.988f||right>=.988f)return null;
    if(!(bottom>top&&right>left))return null;
    int imageW=frame.getWidth(),imageH=frame.getHeight();
    int x=Math.max(0,(int)(left*imageW));
    int y=Math.max(0,(int)(top*imageH));
    int w=Math.min(imageW-x,(int)((right-left)*imageW));
    int h=Math.min(imageH-y,(int)((bottom-top)*imageH));
    float aspect=(float)h/Math.max(1,w);
    if(w<50||h<100||aspect<1.15f||aspect>5.0f
       ||((double)w*h)/(imageW*(double)imageH)<.005)return null;
    Candidate candidate=new Candidate();
    candidate.frame=frame;candidate.left=x;candidate.top=y;
    candidate.width=w;candidate.height=h;
    candidate.confidence=score;candidate.timeMs=timeMs;
    return candidate;
  }
  static void atomic(Path dest,byte[] bytes)throws Exception {
    require(!Files.exists(dest)&&!Files.isSymbolicLink(dest),
            "Never overwrite a crop or provenance sidecar");
    Files.createDirectories(dest.getParent());
    Path stage=Files.createTempFile(dest.getParent(),".s9-roi-",".tmp");
    try {
      Files.write(stage,bytes);
      Files.move(stage,dest,StandardCopyOption.ATOMIC_MOVE);
    }finally{Files.deleteIfExists(stage);}
  }
  static void run(Path original,Path jpeg,Path metadata,String key)throws Exception {
    require(KEY.matcher(key).matches(),"Invalid source-qualified key");
    String file=original.getFileName().toString();
    require(CLIP.matcher(file).matches(),"Unsupported source filename");
    require(original.toAbsolutePath().normalize().equals(
          Paths.get(ARCHIVE+file)),"Only saved S9+ original MP4s accepted");
    require(jpeg.toAbsolutePath().normalize().equals(
          Paths.get(WORKER+"inbox/"+key+".jpg")),"Invalid private ROI path");
    require(metadata.toAbsolutePath().normalize().equals(
          Paths.get(WORKER+"features/"+key+"-detector.json")),
          "Invalid private provenance path");
    require(Files.isRegularFile(original)&&!Files.isSymbolicLink(original)
          &&Files.size(original)>1024&&Files.size(original)<1024L*1024*1024,
          "Missing or unreasonable original");
    require(!Files.exists(jpeg)&&!Files.exists(metadata),
          "Already processed: no overwrite");
    Path detector=Paths.get(MODEL),labels=Paths.get(LABELS);
    require(Files.isRegularFile(detector)&&Files.isRegularFile(labels)
          &&!Files.isSymbolicLink(detector)&&!Files.isSymbolicLink(labels),
          "Missing standalone model");
    require(MODEL_SHA.equals(hash(detector))&&LABEL_SHA.equals(hash(labels)),
          "Detector or labelmap differs from live APK fingerprint");
    String[] labelList=new String(Files.readAllBytes(labels),"UTF-8")
      .toLowerCase(Locale.US).split("\\R");
    ByteBuffer weights=ByteBuffer.allocateDirect((int)Files.size(detector))
      .order(ByteOrder.nativeOrder());
    weights.put(Files.readAllBytes(detector));weights.rewind();
    MediaMetadataRetriever grabber=new MediaMetadataRetriever();
    Candidate best=null;
    Interpreter.Options options=new Interpreter.Options();
    options.setNumThreads(1);
    try(Interpreter net=new Interpreter(weights,options)) {
        grabber.setDataSource(original.toString());
        String length=grabber.extractMetadata(
          MediaMetadataRetriever.METADATA_KEY_DURATION);
        long duration=Long.parseLong(length);
        require(duration>=1000&&duration<=15*60*1000,
                "Unreasonable recording duration");
        // Default three frames; decode up to five extra ONLY when none passes.
        // Preserve identical model, person-box and threshold semantics.
        double[][] groups={{.33,.66,.12},{.05,.22,.47,.79,.92}};
        int samplesRead=0;
        for(double[] group:groups){
          if(best!=null)break;
          for(double fraction:group) {
            samplesRead++;
          long ms=Math.min(duration-1,(long)(duration*fraction));
          Bitmap frame=null;
          try{
            frame=grabber.getFrameAtTime(ms*1000,
              MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if(frame==null)continue;
            Candidate c=detect(net,frame,ms,labelList);
            if(c!=null&&(best==null||c.confidence>best.confidence)){
              if(best!=null&&best.frame!=null)best.frame.recycle();
              best=c;frame=null;
            }
          }finally{if(frame!=null)frame.recycle();}
          }
        }
      }
    finally{grabber.release();}
    if(best==null){
      System.out.println("S9_OFFLINE_SINGLE_PERSON_ROI_NOT_FOUND frames<=8");
      return;
    }
    try{
      Bitmap person=Bitmap.createBitmap(best.frame,best.left,best.top,
                                      best.width,best.height);
      ByteArrayOutputStream stream=new ByteArrayOutputStream(130000);
      try{
        require(person.compress(Bitmap.CompressFormat.JPEG,90,stream),
                "Cropping JPEG encoding failed");
      }finally{person.recycle();}
      byte[] image=stream.toByteArray();
      require(image.length>=1024&&image.length<=1900000,
              "Person JPEG too small or large");
      atomic(jpeg,image);
      JSONObject metadataJson=new JSONObject();
      metadataJson.put("schema","s9_offline_single_person_roi_v1");
      metadataJson.put("extractor_revision","s9_three_plus_five_temporal_fallback_v2");
      metadataJson.put("sampling_policy","additional_frames_only_when_first_three_rejected");
      metadataJson.put("source","s9_sd");
      metadataJson.put("source_clip",file);
      metadataJson.put("source_qualified_key",key);
      metadataJson.put("detector_sha256",MODEL_SHA);
      metadataJson.put("crop_sha256",hash(jpeg));
      metadataJson.put("time_ms",best.timeMs);
      metadataJson.put("confidence",best.confidence);
      metadataJson.put("crop_width",best.width);
      metadataJson.put("crop_height",best.height);
      metadataJson.put("crop_left",best.left);
      metadataJson.put("crop_top",best.top);
      metadataJson.put("identity_verified",false);
      metadataJson.put("requires_human_review",true);
      atomic(metadata,(metadataJson.toString()+"\n").getBytes("UTF-8"));
      System.out.println("S9_OFFLINE_SINGLE_PERSON_ROI_STAGED"
        +" one_full_person=true review_required=true crop_sha256="+hash(jpeg));
    }finally{if(best.frame!=null)best.frame.recycle();}
  }
  public static void main(String[] args)throws Exception {
    require(args.length==5&&args[0].equals("--extract"),
       "Usage: --extract source.mp4 private.jpg private.json sha256_key");
    run(Paths.get(args[1]),Paths.get(args[2]),Paths.get(args[3]),args[4]);
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
}
