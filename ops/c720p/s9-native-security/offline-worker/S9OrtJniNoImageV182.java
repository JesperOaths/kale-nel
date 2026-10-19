package nl.kalenel.s9offline;

import ai.onnxruntime.OrtEnvironment;

/**
 * Discriminate native ONNX Runtime JNI initialization from YuNet inference.
 * No model, tensor, image, camera, file system or network access.
 */
public final class S9OrtJniNoImageV182 {
    private S9OrtJniNoImageV182() {}
    public static void main(String[] args) {
        if (args.length!=1 || !"--no-image-ort-env".equals(args[0])) {
            System.exit(2);
        }
        OrtEnvironment.getEnvironment("s9-ort-jni-no-image-v182");
        System.out.println("S9_ORT_JNI_NO_IMAGE_ENV_OK_V182");
        System.out.flush();
        Runtime.getRuntime().halt(0);
    }
}
