package nl.kalenel.s9offline;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.Locale;

/**
 * R740: independent S9+ synthetic-only person Re-ID ONNX compatibility probe.
 *
 * Does not inspect photos, decode MP4, contact a network, mutate an APK, or
 * write embeddings. A fixed batch of 16 is handled exactly as declared by the
 * model, never misinterpreted as 16 independently verified people.
 *
 * Usage: --synthetic /data/local/tmp/s9_reid_r740/model.onnx SHA256
 * The invoker must separately enforce camera/thermal/recording admission,
 * run at nice 15, and keep this experiment detached from the live pipeline.
 */
public final class S9ReidSyntheticProbeV740 {
  static final Path ROOT=Paths.get("/data/local/tmp/s9_reid_r740").toAbsolutePath();
  static final int HEIGHT=256, WIDTH=128, DIM=512, MAX_BATCH=16;

  private S9ReidSyntheticProbeV740() {}
  static void require(boolean ok,String reason) {
    if(!ok)throw new IllegalArgumentException(reason);
  }

  static String sha256(Path path)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream in=Files.newInputStream(path)){
      byte[] b=new byte[32768];int n;
      while((n=in.read(b))>0)md.update(b,0,n);
    }
    StringBuilder out=new StringBuilder(64);
    for(byte v:md.digest())out.append(String.format(Locale.US,"%02x",v&255));
    return out.toString();
  }

  static float[] sample(int batch) {
    float[] out=new float[batch*3*HEIGHT*WIDTH];
    final float[] mean={.485f,.456f,.406f},std={.229f,.224f,.225f};
    int plane=HEIGHT*WIDTH;
    for(int b=0;b<batch;b++)for(int ch=0;ch<3;ch++){
      int start=(b*3+ch)*plane;
      for(int j=0;j<plane;j++){
        float px=((j*13+b*23+ch*41)%251)/250f;
        out[start+j]=(px-mean[ch])/std[ch];
      }
    }
    return out;
  }

  static double[] check(Object value,int batch){
    require(value instanceof float[][],"ONNX output must be rank-2 float32");
    float[][] rows=(float[][])value;
    require(rows.length==batch,"Output batch differs from model input");
    double min=Double.POSITIVE_INFINITY,max=0;
    for(float[] row:rows){
      require(row!=null&&row.length==DIM,"Unexpected feature dimension");
      double sum=0;
      for(float x:row){
        require(Float.isFinite(x),"Nonfinite output vector");
        sum+=(double)x*x;
      }
      double norm=Math.sqrt(sum);
      require(Double.isFinite(norm)&&norm>1e-8,"Degenerate feature vector");
      min=Math.min(min,norm);max=Math.max(max,norm);
    }
    return new double[]{min,max};
  }

  static void probe(Path model,String expected)throws Exception {
    require(expected.matches("[a-f0-9]{64}"),"Missing pinned SHA-256");
    require(model.isAbsolute() && model.normalize().getParent().equals(ROOT),
        "Only isolated experiment model path allowed");
    require(Files.isRegularFile(model,LinkOption.NOFOLLOW_LINKS),"Missing model");
    require(Files.size(model)>=100_000 && Files.size(model)<=40_000_000,
        "Model outside bounded size");
    require(model.getParent().toRealPath().equals(ROOT.toRealPath()),
        "Model path resolves outside experiment directory");
    require(sha256(model).equals(expected),"Model SHA mismatch");

    OrtEnvironment env=OrtEnvironment.getEnvironment("s9-reid-v740-synthetic");
    try(OrtSession.SessionOptions opt=new OrtSession.SessionOptions()){
      opt.setIntraOpNumThreads(1);
      opt.setInterOpNumThreads(1);
      try(OrtSession session=env.createSession(model.toString(),opt)){
        require(session.getInputNames().size()==1,"Expected one image input");
        require(session.getOutputNames().size()==1,"Expected one feature output");
        String in=session.getInputNames().iterator().next();
        TensorInfo ti=(TensorInfo)session.getInputInfo().get(in).getInfo();
        long[] shape=ti.getShape();
        require(shape.length==4 && shape[1]==3 && shape[2]==HEIGHT
            && shape[3]==WIDTH,"Unsupported ONNX input shape");
        int batch=(shape[0]==-1)?1:Math.toIntExact(shape[0]);
        require(batch>=1&&batch<=MAX_BATCH,"Unsupported ONNX batch size");
        long[] output=((TensorInfo)session.getOutputInfo().values()
            .iterator().next().getInfo()).getShape();
        require(output.length==2&&(output[0]==batch||output[0]==-1)
            && output[1]==DIM,"Unsupported ONNX embedding shape");

        try(OnnxTensor tensor=OnnxTensor.createTensor(env,
            FloatBuffer.wrap(sample(batch)),
            new long[]{batch,3,HEIGHT,WIDTH})){
          double min=0,max=0;
          long[] timings=new long[3];
          for(int i=0;i<3;i++){
            long begin=System.nanoTime();
            try(OrtSession.Result res=session.run(Collections.singletonMap(in,tensor))){
              require(res.size()==1,"Expected one ONNX output");
              double[] ns=check(res.get(0).getValue(),batch);
              min=ns[0];max=ns[1];
            }
            timings[i]=System.nanoTime()-begin;
          }
          // First pass warms up ORT. Both remaining timings are disclosed.
          System.out.println(String.format(Locale.US,
            "S9_REID_V740_SYNTHETIC_PASS {\"model_sha256\":\"%s\","
            +"\"batch\":%d,\"feature_dim\":%d,\"warmup_ms\":%.2f,"
            +"\"timed_ms\":[%.2f,%.2f],\"norm_min\":%.6f,"
            +"\"norm_max\":%.6f,\"person_identity_validated\":false,"
            +"\"real_crops_processed\":0,\"auto_assignments\":0}",
            expected,batch,DIM,timings[0]/1e6,timings[1]/1e6,
            timings[2]/1e6,min,max));
          System.out.flush();
        }
      }
    }
  }

  public static void main(String[] args)throws Exception {
    require(args.length==3&&"--synthetic".equals(args[0]),
      "Usage: --synthetic /data/local/tmp/s9_reid_r740/model.onnx SHA256");
    probe(Paths.get(args[1]),args[2]);
    // Android 10 app_process/ORT JNI destructor may abort on JVM exit.
    Runtime.getRuntime().halt(0);
  }
}
