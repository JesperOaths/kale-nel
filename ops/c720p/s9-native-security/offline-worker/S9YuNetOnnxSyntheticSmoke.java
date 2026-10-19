package nl.kalenel.s9offline;
import ai.onnxruntime.*;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/**
 * Phone-only YuNet ONNX model runtime smoke on SYNTHETIC black pixels.
 * Does not inspect saved photos, recognize identities, write evidence,
 * access Camera2 or change the live recorder. Separate from APK classes.
 */
public final class S9YuNetOnnxSyntheticSmoke {
 private S9YuNetOnnxSyntheticSmoke(){}
 private static final String MODEL="/storage/9C33-6BBD/S9OfflineModels/face_five_point_yunet_2023mar.onnx";
 private static final String SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
 private static void need(boolean ok,String why){
  if(!ok)throw new IllegalArgumentException(why);
 }
 static String sha(Path file)throws Exception {
  MessageDigest md=MessageDigest.getInstance("SHA-256");
  try(InputStream in=Files.newInputStream(file)){
   byte[] chunk=new byte[32768];int n;
   while((n=in.read(chunk))>0)md.update(chunk,0,n);
  }
  StringBuilder sb=new StringBuilder(64);
  for(byte b:md.digest())sb.append(String.format(Locale.US,"%02x",b&255));
  return sb.toString();
 }
 public static void main(String[] args)throws Exception {
  need(args.length==1&&args[0].equals("--synthetic-smoke"),
       "only synthetic model smoke is supported");
  Path model=Paths.get(MODEL);
  need(!Files.isSymbolicLink(model)&&Files.isRegularFile(model)&&Files.size(model)==232589,
       "pinned landmark model unavailable");
  need(SHA.equals(sha(model)),"landmark model sha mismatch");
  OrtEnvironment env=OrtEnvironment.getEnvironment("s9-yunet-only");
  try(OrtSession.SessionOptions opts=new OrtSession.SessionOptions()){
   opts.setIntraOpNumThreads(1);opts.setInterOpNumThreads(1);
   try(OrtSession session=env.createSession(MODEL,opts)){
    need(session.getInputNames().size()==1&&session.getInputNames().contains("input"),
         "YuNet input name incompatible");
    Set<String> wanted=new HashSet<>();
    for(int stride:new int[]{8,16,32})for(String head:new String[]{"cls","obj","bbox","kps"})
     wanted.add(head+"_"+stride);
    need(session.getOutputNames().equals(wanted),"unexpected YuNet output heads");
    try(OnnxTensor input=OnnxTensor.createTensor(
          env,FloatBuffer.wrap(new float[3*640*640]),new long[]{1,3,640,640});
        OrtSession.Result out=session.run(Collections.singletonMap("input",input))) {
     Map<String,Object> values=new HashMap<>();
     for(Map.Entry<String,OnnxValue> entry:out)
      values.put(entry.getKey(),entry.getValue().getValue());
     need(values.keySet().equals(wanted),"YuNet output names drifted");
     // Exact tensor ranks and shapes, no face/photo bytes from a real person.
     for(int stride:new int[]{8,16,32}){
      int cells=(640/stride)*(640/stride);
      for(String name:new String[]{"cls","obj","bbox","kps"}){
       Object val=values.get(name+"_"+stride);
       need(val instanceof float[][][],"YuNet tensor dtype/rank mismatch");
       float[][][] row=(float[][][])val;
       int width=name.equals("bbox")?4:name.equals("kps")?10:1;
       need(row.length==1&&row[0].length==cells,
            "YuNet output cell shape mismatch");
       for(float[] cell:row[0])need(cell.length==width,"YuNet feature channel mismatch");
      }
     }
    }
   }
  }
  System.out.println("S9_YUNET_GENUINE_ON_PHONE_ONNX_SYNTHETIC_SHAPE_PASS input=640 heads=12 model_sha_verified=true no_faces_read=true no_identity_assignment=true");
  System.out.flush();
  Runtime.getRuntime().halt(0);
 }
}
