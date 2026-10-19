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
public final class S9StandalonePersonRoiAuditV2 {
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
  static String lastReason="not_run";
  static void note(String label){lastReason=label;}
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
    note("unclassified");
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
    if(persons.size()!=1){
      note(persons.isEmpty()?"no_person_above_045":"multiple_people_above_045");
      return null;
    }
    int i=persons.get(0);
    float score=scores[0][i];
    if(score<.56f){note("person_confidence_045_to_056");return null;}
    float[] b=boxes[0][i];
    for(float v:b)if(!Float.isFinite(v)||v<-.01f||v>1.01f){
      note("invalid_person_coordinates");return null;
    }
    float top=b[0],left=b[1],bottom=b[2],right=b[3];
    if(top<=.012f||left<=.012f||bottom>=.988f||right>=.988f){
      note("person_box_clipped_by_frame_edge");return null;
    }
    if(!(bottom>top&&right>left)){
      note("invalid_person_coordinates");return null;
    }
    int imageW=frame.getWidth(),imageH=frame.getHeight();
    int x=Math.max(0,(int)(left*imageW));
    int y=Math.max(0,(int)(top*imageH));
    int w=Math.min(imageW-x,(int)((right-left)*imageW));
    int h=Math.min(imageH-y,(int)((bottom-top)*imageH));
    float aspect=(float)h/Math.max(1,w);
    if(w<50||h<100){note("person_box_too_small");return null;}
    if(aspect<1.15f||aspect>5.0f){note("person_box_aspect_invalid");return null;}
    if(((double)w*h)/(imageW*(double)imageH)<.005){
      note("person_box_area_too_small");return null;
    }
    note("eligible_single_full_person");
    Candidate candidate=new Candidate();
    candidate.frame=frame;candidate.left=x;candidate.top=y;
    candidate.width=w;candidate.height=h;
    candidate.confidence=score;candidate.timeMs=timeMs;
    return candidate;
  }
  static void audit(Path original)throws Exception {
    String file=original.getFileName().toString();
    require(CLIP.matcher(file).matches(),"Unsupported source filename");
    require(original.toAbsolutePath().normalize().equals(
          Paths.get(ARCHIVE+file)),"Only saved S9+ primary originals accepted");
    require(Files.isRegularFile(original)&&!Files.isSymbolicLink(original)
          &&Files.size(original)>1024&&Files.size(original)<1024L*1024*1024,
          "Missing original");
    Path detector=Paths.get(MODEL),labels=Paths.get(LABELS);
    require(Files.isRegularFile(detector)&&Files.isRegularFile(labels)
          &&!Files.isSymbolicLink(detector)&&!Files.isSymbolicLink(labels),
          "Missing standalone verified detector");
    require(MODEL_SHA.equals(hash(detector))&&LABEL_SHA.equals(hash(labels)),
          "Verified detector hashes changed");
    String[] list=new String(Files.readAllBytes(labels),"UTF-8")
      .toLowerCase(Locale.US).split("\\R");
    ByteBuffer weights=ByteBuffer.allocateDirect((int)Files.size(detector))
      .order(ByteOrder.nativeOrder());
    weights.put(Files.readAllBytes(detector));weights.rewind();
    java.util.TreeMap<String,Integer> reasons=new java.util.TreeMap<>();
    int scanned=0;
    int eligibleFirstThree=0,eligibleLaterFive=0;
    MediaMetadataRetriever grabber=new MediaMetadataRetriever();
    try(Interpreter net=new Interpreter(weights,new Interpreter.Options().setNumThreads(1))) {
      grabber.setDataSource(original.toString());
      String length=grabber.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
      long duration=Long.parseLong(length);
      require(duration>=1000&&duration<=15*60*1000,"Unexpected duration");
      // EXACT frame sampling and ROI thresholds as production offline extractor.
      for(double fraction:new double[]{.33,.66,.12,.05,.22,.47,.79,.92}) {
        long ms=Math.min(duration-1,(long)(duration*fraction));
        Bitmap image=null;
        String reason;
        try {
          image=grabber.getFrameAtTime(ms*1000,
              MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
          if(image==null)reason="video_frame_unavailable";
          else {
            Candidate hit=detect(net,image,ms,list);
            reason=lastReason;
            // Diagnostics never persist a crop even for successful boxes.
            if(hit!=null && !"eligible_single_full_person".equals(reason))
              throw new IllegalStateException("Detector and audit classification diverged");
          }
        } finally {
          if(image!=null)image.recycle();
        }
        reasons.put(reason,1+reasons.getOrDefault(reason,0));
        if("eligible_single_full_person".equals(reason)) {
          if(scanned<3)eligibleFirstThree++;
          else eligibleLaterFive++;
        }
        scanned++;
      }
    }finally{grabber.release();}
    JSONObject result=new JSONObject();
    result.put("schema","s9_roi_rejection_audit_v2");
    result.put("frames_requested",8);
    result.put("frames_scanned",scanned);
    result.put("categories",new JSONObject(reasons));
    result.put("eligible_first_three",eligibleFirstThree>0);
    result.put("eligible_extra_five",eligibleLaterFive>0);
    result.put("extra_five_only_rescued",eligibleFirstThree==0&&eligibleLaterFive>0);
    result.put("source","s9_sd");
    result.put("camera_changed",false);
    result.put("recordings_modified",false);
    result.put("person_assignment_modified",false);
    result.put("crop_images_saved",0);
    // No clip names, person coordinates, images, embeddings or precise times.
    System.out.println("S9_OFFLINE_ROI_REJECTION_AUDIT_V2 "+result.toString());
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
  public static void main(String[] args)throws Exception {
    require(args.length==2&&args[0].equals("--audit"),
         "Usage: --audit saved-original.mp4");
    audit(Paths.get(args[1]));
  }
}
