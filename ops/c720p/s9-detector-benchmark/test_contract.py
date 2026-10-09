from pathlib import Path
r=Path(__file__).parent
src=(r/'src/nl/kalenel/s9benchmark/BenchmarkService.java').read_text()
manifest=(r/'AndroidManifest.xml').read_text()
build=(r/'build-only.sh').read_text()
assert 'MAX_FILES=8, FRAMES=3, MAX_TEMP=37' in src
assert 'new MediaMetadataRetriever()' in src
assert 'DataType.UINT8' in src
assert 'camera_not_idle' in src
assert 'getOutputTensorCount()!=4' in src
assert 'ground_truth_available",false' in src
assert 'CameraManager' not in src and 'MediaRecorder' not in src
assert 'CAMERA' not in manifest and 'WRITE_EXTERNAL_STORAGE' not in manifest
assert 'INTERNET' in manifest and 'READ_EXTERNAL_STORAGE' in manifest
assert 'nl.kalenel.s9benchmark' in manifest and 'nl.kalenel.s9security' not in manifest
assert 'S9_BENCHMARK_BUILD_ONLY_PASS' in build
assert 'S9_BENCHMARK_REF' in build
assert 's9-native-security-sign' not in build
assert 'tfhub.dev/tensorflow/lite-model/efficientdet/lite0/detection/metadata/1' in build
assert '2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b' in build
assert 'unknown_model_output_semantics' in src
assert 'out.put(indices[0],boxes)' in src
assert 'removable_SD_results_path_unavailable' in src
assert 'android.permission.FOREGROUND_SERVICE' in manifest
print('S9_OFFLINE_BENCHMARK_CONTRACT_PASS')
