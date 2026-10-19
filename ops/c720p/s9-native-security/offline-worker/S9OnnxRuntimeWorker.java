package nl.kalenel.s9offline;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;
import java.nio.FloatBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;

/**
 * Standalone app_process entrypoint. NO Android service, APK, camera, or network.
 *
 * Use official ARM64 ONNX Runtime JNI and native libraries beside a DEX jar.
 * --runtime-test validates actual native library loading.
 * --model-smoke validates input shape and 512-D output using deterministic
 * synthetic pixels; does not read recordings, faces or private crop images.
 */
public final class S9OnnxRuntimeWorker {
    private S9OnnxRuntimeWorker() {}
    private static final int VECTOR_SIZE=512;

    private static void require(boolean ok, String reason) {
        if (!ok) throw new IllegalArgumentException(reason);
    }

    private static float[] l2(Object raw) {
        if (!(raw instanceof float[][])) {
            throw new IllegalStateException("ONNX output must be float32 rank-2");
        }
        float[][] rows=(float[][])raw;
        require(rows.length==1 && rows[0].length==VECTOR_SIZE,
                "Unexpected ONNX embedding dimensions");
        float[] v=rows[0].clone();
        double squared=0.0;
        for (float x : v) {
            if (!Float.isFinite(x)) throw new IllegalStateException("Nonfinite embedding");
            squared+=(double)x*(double)x;
        }
        if (!(squared>1e-20) || !Double.isFinite(squared)) {
            throw new IllegalStateException("Degenerate embedding");
        }
        double norm=Math.sqrt(squared);
        for (int i=0;i<v.length;i++) v[i]=(float)(v[i]/norm);
        return v;
    }

    private static float[] synthetic(String mode, int width, int height) {
        float[] values=new float[3*height*width];
        for (int channel=0;channel<3;channel++) {
            for (int i=0;i<width*height;i++) {
                float sample=(float)(((i+channel*43)%251)/250.);
                values[channel*width*height+i]=
                   "structural".equals(mode) ? 2f*sample-1f :
                   (sample-(channel==0?.485f:channel==1?.456f:.406f))/
                   (channel==0?.229f:channel==1?.224f:.225f);
            }
        }
        return values;
    }

    private static void runModel(String type, Path model) throws Exception {
        require(Files.isRegularFile(model) && !Files.isSymbolicLink(model),
                "Verified model file missing");
        require(type.equals("visual") || type.equals("structural"),"Unknown model type");
        int height=type.equals("visual")?256:112;
        int width=type.equals("visual")?128:112;
        OrtEnvironment env=OrtEnvironment.getEnvironment("s9-independent-offline");
        try(OrtSession.SessionOptions config=new OrtSession.SessionOptions()) {
            config.setIntraOpNumThreads(1);
            config.setInterOpNumThreads(1);
            try(OrtSession session=env.createSession(model.toString(),config)) {
                require(session.getInputNames().size()==1,
                        "Expected one ONNX image input");
                require(session.getOutputNames().size()==1,
                        "Expected one ONNX embedding output");
                String in=session.getInputNames().iterator().next();
                try(OnnxTensor t=OnnxTensor.createTensor(
                        env,FloatBuffer.wrap(synthetic(type,width,height)),
                        new long[]{1,3,height,width});
                    OrtSession.Result result=session.run(
                            Collections.singletonMap(in,t))) {
                    require(result.size()==1,"Expected one vector output");
                    OnnxValue val=result.get(0);
                    float[] descriptor=l2(val.getValue());
                    double norm=0d;
                    for(float x:descriptor)norm+=(double)x*x;
                    require(Math.abs(norm-1)<.0001,"L2 normalization failed");
                    // Do not print biometric vectors, file paths or image bytes.
                    System.out.println("S9_STANDALONE_ONNX_512D_SMOKE_PASS "+
                        type+" dim="+descriptor.length+" l2=true");
                }
            }
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length==1 && args[0].equals("--runtime-test")) {
            OrtEnvironment env=OrtEnvironment.getEnvironment("s9-independent-offline");
            require(env.getVersion()!=null && !env.getVersion().isEmpty(),
                    "ORT native runtime could not initialize");
            System.out.println("S9_STANDALONE_ORT_NATIVE_LOAD_PASS");
            // Android 10 app_process triggers a native ORT static-destructor
            // mutex abort AFTER this marker on ordinary JVM shutdown.
            // This process is deliberately short-lived, does no archive writes
            // and is isolated from Camera2. Exit immediately once stdout is
            // confirmed flushed; real backfill is gated on separate tests.
            System.out.flush();
            Runtime.getRuntime().halt(0);
            return;
        }
        if (args.length==3 && args[0].equals("--model-smoke")) {
            runModel(args[1],Paths.get(args[2]));
            System.out.flush();
            Runtime.getRuntime().halt(0);
            return;
        }
        throw new IllegalArgumentException(
                "usage: --runtime-test | --model-smoke visual|structural <local.onnx>");
    }
}
