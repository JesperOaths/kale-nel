package nl.kalenel.s9offline;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.FloatBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Single-crop real image inference with isolated private sidecar output.
 * Separate from Camera2 APK, media indexes and user review decisions.
 * A facial embedding requires caller-verified aligned face evidence.
 *
 * Invocation: visual|structural <onnx> <inbox.jpg> <output.json>
 *             <sourceQualifiedSHA256> <cropSHA256>
 *
 * All paths are constrained to separate worker paths on the S9+. One
 * invocation processes only one crop; caller rate limits and deletes
 * temporary input after completion.
 */
public final class S9OnnxCropWorker {
  static final String ROOT="/data/local/tmp/s9_worker/";
  static final String MODELS="/storage/9C33-6BBD/S9OfflineModels/";
  static final String VISUAL_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d";
  static final String STRUCT_SHA="4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43";
  static final Pattern HEX=Pattern.compile("[a-f0-9]{64}");

  static void need(boolean valid,String reason) {
    if (!valid) throw new IllegalArgumentException(reason);
  }

  static String hash(Path input) throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream stream=Files.newInputStream(input)) {
      byte[] buf=new byte[65536];int n;
      while((n=stream.read(buf))>0)md.update(buf,0,n);
    }
    StringBuilder b=new StringBuilder(64);
    for(byte x:md.digest())b.append(String.format(Locale.US,"%02x",x&255));
    return b.toString();
  }

  static float[] normalized(Object result) {
    need(result instanceof float[][],"Embedding output is not float[][]");
    float[][] values=(float[][])result;
    need(values.length==1&&values[0].length==512,"Embedding dimension mismatch");
    float[] v=values[0].clone();
    double sum=0;
    for(float x:v) {
      need(Float.isFinite(x),"Nonfinite embedding");
      sum+=(double)x*x;
    }
    need(Double.isFinite(sum)&&sum>1e-20,"Zero embedding");
    for(int j=0;j<v.length;j++)v[j]/=(float)Math.sqrt(sum);
    return v;
  }

  static float[] imageBatch(String kind,Path image,int w,int h) throws Exception {
    need(Files.isRegularFile(image)&&!Files.isSymbolicLink(image),
      "Missing private cropped image");
    need(Files.size(image)>100&&Files.size(image)<2*1024*1024,
      "Cropped image outside bounded size");
    BitmapFactory.Options opts=new BitmapFactory.Options();
    opts.inJustDecodeBounds=true;
    BitmapFactory.decodeFile(image.toString(),opts);
    need(opts.outWidth>=16&&opts.outHeight>=16&&opts.outWidth<=4096
        &&opts.outHeight<=4096,"Invalid crop image dimensions");
    BitmapFactory.Options decode=new BitmapFactory.Options();
    decode.inPreferredConfig=Bitmap.Config.ARGB_8888;
    Bitmap original=BitmapFactory.decodeFile(image.toString(),decode);
    need(original!=null,"Image cannot be decoded");
    Bitmap scaled=Bitmap.createScaledBitmap(original,w,h,true);
    int[] pixels=new int[w*h];
    scaled.getPixels(pixels,0,w,0,0,w,h);
    float[] out=new float[3*w*h];
    float[] mean={.485f,.456f,.406f};
    float[] std={.229f,.224f,.225f};
    for(int i=0;i<pixels.length;i++) {
      int p=pixels[i];
      float[] rgb={(float)((p>>16)&255),(float)((p>>8)&255),
                    (float)(p&255)};
      for(int c=0;c<3;c++) {
        out[c*w*h+i]=kind.equals("visual")
          ?(rgb[c]/255f-mean[c])/std[c]
          :(rgb[c]-127.5f)/127.5f;
      }
    }
    if(scaled!=original)scaled.recycle();
    original.recycle();
    return out;
  }

  static void write(Path dest,String kind,String id,String cropSha,
                    String modelSha,float[] embedding) throws Exception {
    need(dest.toAbsolutePath().normalize().startsWith(
          Paths.get(ROOT+"features").toAbsolutePath().normalize()),
          "Output must be in private feature store");
    need(!Files.exists(dest)&&!Files.isSymbolicLink(dest),
          "Existing metadata sidecar must never be overwritten");
    Path parent=dest.getParent();
    Files.createDirectories(parent);
    String field=kind.equals("visual")?"visual_embedding":"structural_crop_embedding";
    StringBuilder data=new StringBuilder(7900);
    data.append("{\"schema\":\"s9_offline_appearance_embedding_v1\",");
    data.append("\"source_qualified_key\":\"").append(id).append("\",");
    data.append("\"crop_sha256\":\"").append(cropSha).append("\",");
    data.append("\"model_sha256\":\"").append(modelSha).append("\",");
    data.append("\"model_type\":\"").append(kind).append("\",");
    data.append("\"appearance_only\":true,\"verified_same_person\":false,");
    data.append("\"human_review_required\":true,\"").append(field).append("\":[");
    for(int i=0;i<embedding.length;i++) {
      if(i>0)data.append(',');
      data.append(Float.toString(embedding[i]));
    }
    data.append("]}\n");
    Path pending=Files.createTempFile(parent,".feature-",".tmp");
    try {
      Files.write(pending,data.toString().getBytes(StandardCharsets.UTF_8),
                  StandardOpenOption.TRUNCATE_EXISTING);
      Files.move(pending,dest,StandardCopyOption.ATOMIC_MOVE);
    } finally {
      Files.deleteIfExists(pending);
    }
  }

  static void run(String kind,Path model,Path input,Path dest,String id,
                  String cropSha) throws Exception {
    need(kind.equals("visual")||kind.equals("structural"),"Unknown model");
    need(HEX.matcher(id).matches()&&HEX.matcher(cropSha).matches(),
         "Invalid source/crop SHA256 identifier");
    String modelFile=kind.equals("visual")?"visual_backbone_512d.onnx"
                                          :"structural_upper_crop_512d.onnx";
    String expected=kind.equals("visual")?VISUAL_SHA:STRUCT_SHA;
    need(model.toAbsolutePath().normalize().equals(Paths.get(MODELS+modelFile)),
         "Model cannot be loaded outside verified S9 microSD model folder");
    need(input.toAbsolutePath().normalize().startsWith(
           Paths.get(ROOT+"inbox").toAbsolutePath().normalize()),
         "Only temporary worker inbox crops are accepted");
    need(Files.isRegularFile(model)&&!Files.isSymbolicLink(model),
         "Missing verified model");
    need(hash(model).equals(expected),"Model SHA256 mismatch");
    need(hash(input).equals(cropSha),"Crop transferred SHA256 mismatch");
    int h=kind.equals("visual")?256:112;
    int w=kind.equals("visual")?128:112;
    float[] batch=imageBatch(kind,input,w,h);
    OrtEnvironment env=OrtEnvironment.getEnvironment("s9-standalone-real-crop");
    try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()) {
      options.setIntraOpNumThreads(1);
      options.setInterOpNumThreads(1);
      try(OrtSession session=env.createSession(model.toString(),options)) {
        need(session.getInputNames().size()==1,"Unexpected model inputs");
        String name=session.getInputNames().iterator().next();
        try(OnnxTensor tensor=OnnxTensor.createTensor(
                env,FloatBuffer.wrap(batch),new long[]{1,3,h,w});
            OrtSession.Result outputs=session.run(
                Collections.singletonMap(name,tensor))) {
          need(outputs.size()==1,"Unexpected model outputs");
          float[] embedding=normalized(outputs.get(0).getValue());
          write(dest,kind,id,cropSha,expected,embedding);
        }
      }
    }
    System.out.println("S9_OFFLINE_REAL_CROP_512D_PERSISTED "+kind+
                       " dim=512 l2=true sidecar=true");
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }

  public static void main(String[] args) throws Exception {
    need(args.length==7&&args[0].equals("--extract"),
         "Usage: --extract visual|structural model.onnx inbox.jpg result.json idSHA cropSHA");
    run(args[1],Paths.get(args[2]),Paths.get(args[3]),Paths.get(args[4]),
        args[5],args[6]);
  }
}
