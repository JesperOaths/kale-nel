package nl.kalenel.s9offline;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * A SINGLE on-phone original face inspection JPEG, no biometric enrollment.
 * No connection to the Camera2 APK, gallery, other clips, or human decisions.
 *
 * Genuine YuNet landmarks are inspected at native JPEG pixel resolution.
 * No aligned crop or embedding is written during this evidence-only stage.
 * Image, identity and landmark coordinates never leave the S9.
 */
public final class S9YuNetSingleSnapshotAudit {
  static final String MODEL="/storage/9C33-6BBD/S9OfflineModels/face_five_point_yunet_2023mar.onnx";
  static final String MODEL_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
  static final String ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K/FaceSnapshots/";
  static final String PREFIX="S9_YUNET_ONE_FACE_SNAPSHOT_RESULT ";
  private S9YuNetSingleSnapshotAudit(){}
  static void need(boolean b,String code){if(!b)throw new IllegalArgumentException(code);}
  static String sha(Path path) throws Exception {
    MessageDigest dig=MessageDigest.getInstance("SHA-256");
    try(InputStream in=Files.newInputStream(path)){
      byte[] buf=new byte[32768];int n;
      while((n=in.read(buf))>0)dig.update(buf,0,n);
    }
    StringBuilder b=new StringBuilder(64);
    for(byte x:dig.digest())b.append(String.format(Locale.US,"%02x",x&255));
    return b.toString();
  }
  static void checkedFile(Path actual,Path root,String expected,long max) throws Exception{
    need(actual.toAbsolutePath().normalize().startsWith(root.toAbsolutePath().normalize()),
        "outside_readonly_snapshot_or_model_folder");
    need(!Files.isSymbolicLink(actual)&&Files.isRegularFile(actual)&&
        Files.size(actual)>100&&Files.size(actual)<max,"untrusted_phone_readonly_file");
    need(sha(actual).equals(expected),"phone_snapshot_sha256_drift");
  }
  static float[] bgrInput(Bitmap original){
    final int n=640*640;
    Bitmap small=Bitmap.createScaledBitmap(original,640,640,true);
    int[] pixels=new int[n];float[] image=new float[n*3];
    try{
      small.getPixels(pixels,0,640,0,0,640,640);
      // This EXACTLY matches OpenCV FaceDetectorYN's
      // dnn::blobFromImage(BGR Mat) defaults: 0..255, BGR,
      // 1x3x640x640, no mean subtraction, no channel swapping.
      for(int i=0;i<n;i++){
        int p=pixels[i];
        image[i]=p&255;
        image[n+i]=(p>>>8)&255;
        image[n*2+i]=(p>>>16)&255;
      }
      return image;
    } finally {
      if(small!=original)small.recycle();
    }
  }
  static String cleanName(String name){
    need(name.matches("motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2]\\.jpg"),
        "not_native_review_snapshot_filename");
    return name;
  }
  public static void main(String[] args) throws Exception {
    need(args.length==3&&"--audit-single".equals(args[0]),
         "one_snapshot_audit_only");
    String name=cleanName(args[1]),evidenceHash=args[2];
    need(evidenceHash.matches("[a-f0-9]{64}"),"untrusted_snapshot_hash");
    Path root=Paths.get(ROOT),image=root.resolve(name),model=Paths.get(MODEL);
    checkedFile(image,root,evidenceHash,2*1024*1024);
    checkedFile(model,model.getParent(),MODEL_SHA,512*1024);
    BitmapFactory.Options dims=new BitmapFactory.Options();
    dims.inJustDecodeBounds=true;
    BitmapFactory.decodeFile(image.toString(),dims);
    // FaceSnapshot captures are square native crops, never landscape or
    // body bounding boxes. Fail closed rather than guessing resize mapping.
    need(dims.outWidth>=70&&dims.outWidth<=2048
        &&dims.outWidth==dims.outHeight,"not_native_square_face_snapshot");
    BitmapFactory.Options read=new BitmapFactory.Options();
    read.inPreferredConfig=Bitmap.Config.ARGB_8888;
    Bitmap bitmap=BitmapFactory.decodeFile(image.toString(),read);
    need(bitmap!=null&&bitmap.getWidth()==dims.outWidth
       &&bitmap.getHeight()==dims.outHeight,"bitmap_decode_dimensions_drift");
    float[] input;
    try{input=bgrInput(bitmap);}finally{bitmap.recycle();}
    OrtEnvironment env=OrtEnvironment.getEnvironment("s9-yunet-one-native-crop");
    java.util.List<PhoneYuNetLandmarkDecoder.Face> faces;
    try(OrtSession.SessionOptions opts=new OrtSession.SessionOptions()){
      opts.setIntraOpNumThreads(1);
      opts.setInterOpNumThreads(1);
      try(OrtSession session=env.createSession(MODEL,opts);
          OnnxTensor tensor=OnnxTensor.createTensor(env,FloatBuffer.wrap(input),
                     new long[]{1,3,640,640});
          OrtSession.Result outputs=session.run(java.util.Collections.singletonMap("input",tensor))){
        Map<String,Object> heads=new HashMap<>();
        for(Map.Entry<String,OnnxValue> item:outputs)
          heads.put(item.getKey(),item.getValue().getValue());
        faces=PhoneYuNetLandmarkDecoder.decode(heads,dims.outWidth,dims.outHeight);
      }
    }
    // With multiple faces in a single crop we deliberately record only
    // ambiguous: no enrollment, coordinates or identifying biometric data.
    boolean unique=faces.size()==1;
    System.out.println(PREFIX+"{\"detector_executed_on_phone\":true,"+
        "\"genuine_five_point_geometry_valid\":"+(unique?"true":"false")+","+
        "\"aligned_crop_written\":false,\"reference_created\":false,"+
        "\"detector_valid_face_count\":"+faces.size()+","+
        "\"ambiguous_or_rejected\":"+(unique?"false":"true")+","+
        "\"source_image_read_only\":true,\"human_review_required\":true,"+
        "\"automatic_person_assignments\":0,\"camera_apk_modified\":false,"+
        "\"originals_modified\":false}");
  }
}
