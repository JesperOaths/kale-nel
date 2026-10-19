package nl.kalenel.s9offline;
import ai.onnxruntime.*;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Inspect exactly ONE authentic, SHA-qualified S9 JPEG. No identity inference,
 * photo transfers, crops written, stored vectors, or Camera2 interaction.
 */
public final class S9YuNetOneSnapshotMeasure {
 private static final String DIR="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K/FaceSnapshots";
 private static final String MODEL="/storage/9C33-6BBD/S9OfflineModels/face_five_point_yunet_2023mar.onnx";
 private static final String MODEL_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
 private static void need(boolean yes,String reason){if(!yes)throw new IllegalArgumentException(reason);}
 private static String sha(Path path)throws Exception{
  MessageDigest d=MessageDigest.getInstance("SHA-256");
  try(InputStream in=Files.newInputStream(path)){
   byte[] buf=new byte[16384];int n;
   while((n=in.read(buf))>0)d.update(buf,0,n);
  }
  StringBuilder s=new StringBuilder();
  for(byte b:d.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));
  return s.toString();
 }
 public static void main(String[] args)throws Exception{
  need(args.length==3&&"--one".equals(args[0]),"strict_single_snapshot_only");
  String name=args[1],checksum=args[2];
  need(name.matches("motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg")
       &&checksum.matches("[a-f0-9]{64}"),"invalid_private_snapshot_reference");
  Path root=Paths.get(DIR).toRealPath();
  Path img=root.resolve(name);
  need(Files.isRegularFile(img)&&!Files.isSymbolicLink(img)
       &&img.toRealPath().getParent().equals(root),"private_snapshot_not_regular");
  need(4000<Files.size(img)&&Files.size(img)<2200000
       &&sha(img).equals(checksum),"verified_snapshot_sha_or_size_mismatch");
  Path model=Paths.get(MODEL);
  need(Files.isRegularFile(model)&&!Files.isSymbolicLink(model)
       &&Files.size(model)==232589&&sha(model).equals(MODEL_SHA),
       "pinned_detector_model_not_valid");
  BitmapFactory.Options bounds=new BitmapFactory.Options();
  bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(img.toString(),bounds);
  need(bounds.outWidth==bounds.outHeight&&bounds.outWidth>=70
       &&bounds.outWidth<=4096,"unalignable_native_source_geometry");
  Bitmap source=BitmapFactory.decodeFile(img.toString());
  need(source!=null,"snapshot_decode_failed");
  Bitmap scaled=Bitmap.createScaledBitmap(source,640,640,true);
  int[] pixels=new int[640*640];
  scaled.getPixels(pixels,0,640,0,0,640,640);
  float[] batch=new float[3*pixels.length];
  // OpenCV FaceDetectorYN consumes BGR channels in [0,255], not ImageNet RGB.
  for(int i=0;i<pixels.length;i++){
   int rgb=pixels[i];
   batch[i]=(float)(rgb&255);
   batch[pixels.length+i]=(float)((rgb>>8)&255);
   batch[2*pixels.length+i]=(float)((rgb>>16)&255);
  }
  if(scaled!=source)scaled.recycle();source.recycle();
  int faceCount=0;boolean verified=false;
  OrtEnvironment env=OrtEnvironment.getEnvironment("s9-yunet-private-single");
  try(OrtSession.SessionOptions opts=new OrtSession.SessionOptions()){
   opts.setIntraOpNumThreads(1);opts.setInterOpNumThreads(1);
   try(OrtSession session=env.createSession(MODEL,opts);
       OnnxTensor image=OnnxTensor.createTensor(env,FloatBuffer.wrap(batch),
                                               new long[]{1,3,640,640});
       OrtSession.Result result=session.run(Collections.singletonMap("input",image))){
    Map<String,Object> heads=new HashMap<>();
    for(Map.Entry<String,OnnxValue> entry:result)
     heads.put(entry.getKey(),entry.getValue().getValue());
    List<PhoneYuNetLandmarkDecoder.Face> found=
      PhoneYuNetLandmarkDecoder.decode(heads,bounds.outWidth,bounds.outHeight);
    faceCount=found.size();
    // A crowded/ambiguous image is NOT a verified individual face.
    verified=faceCount==1&&found.get(0).alignment.accepted;
   }
  }
  System.out.println("S9_YUNET_REAL_SINGLE_SNAPSHOT_SCREEN "+
    "{\\"model_valid\\":true,\\"sha_qualified_image\\":true,"+
    "\\"five_point_candidate\\":"+verified+","+
    "\\"detected_faces\\":"+faceCount+","+
    "\\"identity_assigned\\":false,\\"images_written\\":false}");
  System.out.flush();
  Runtime.getRuntime().halt(0);
 }
}
