package nl.kalenel.s9offline;

/**
 * Tiny standalone ART startup test. No model, image, microphone, camera,
 * network, file write, biometric class or ONNX dependency.
 * This tests only whether adb's normal shell context can start Java.
 */
public final class S9AppProcessNoImageBaselineV166 {
    private S9AppProcessNoImageBaselineV166() {}
    public static void main(String[] args) {
        if (args.length != 1 || !"--baseline-no-image".equals(args[0])) {
            System.err.println("S9_NOIMAGE_BAD_ARGUMENTS_V166");
            System.exit(2);
        }
        System.out.println("S9_APP_PROCESS_NO_IMAGE_BASELINE_V166_OK");
    }
}
