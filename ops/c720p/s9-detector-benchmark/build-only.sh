#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
REV="$(printenv S9_BENCHMARK_REF)"
[[ "$REV" =~ ^[0-9a-f]{40}$ ]] || { echo "PIN_FULL_SOURCE_COMMIT" >&2;exit 2; }
ROOT="$HOME/c720p-home-hub/build/s9-detector-benchmark"
SRC="$ROOT/src/nl/kalenel/s9benchmark"
DEPEND="$HOME/c720p-home-hub/build/s9-person-ml-v1/deps"
mkdir -p "$SRC" "$ROOT/assets" "$ROOT/classes" "$ROOT/dex" "$ROOT/pkg/lib/arm64-v8a"
ORIGIN="https://raw.githubusercontent.com/JesperOaths/kale-nel"
curl -fLsS --retry 2 "$ORIGIN/$REV/ops/c720p/s9-detector-benchmark/src/nl/kalenel/s9benchmark/BenchmarkService.java" -o "$SRC/BenchmarkService.java"
curl -fLsS --retry 2 "$ORIGIN/$REV/ops/c720p/s9-detector-benchmark/AndroidManifest.xml" -o "$ROOT/AndroidManifest.xml"
cp "$HOME/c720p-home-hub/build/s9-person-ml-v1/assets/detect.tflite" "$ROOT/assets/baseline.tflite"
curl -fLsS --retry 3 --connect-timeout 12 --max-time 120 \
 "https://tfhub.dev/tensorflow/lite-model/efficientdet/lite0/detection/metadata/1?lite-format=tflite" \
 -o "$ROOT/assets/efficientdet_lite0_int8.tflite"
python3 - "$ROOT/assets" <<'PY'
from pathlib import Path
import hashlib,sys
p=Path(sys.argv[1])
for name in ['baseline.tflite','efficientdet_lite0_int8.tflite']:
 b=(p/name).read_bytes()
 assert 1000000<len(b)<15000000 and b[4:8]==b'TFL3',(name,len(b))
 sha=hashlib.sha256(b).hexdigest()
 if name=='efficientdet_lite0_int8.tflite':
  expected='2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b'
  assert sha==expected,'model_provenance_or_output_format_changed'
 print("BENCH_MODEL",name,len(b),sha)
PY
JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
test -s "$JAR"
CP="$JAR:$DEPEND/tensorflow-lite.jar:$DEPEND/tensorflow-lite-api.jar"
test -s "$DEPEND/tensorflow-lite.jar"
rm -rf "$ROOT/classes" "$ROOT/dex"
mkdir -p "$ROOT/classes" "$ROOT/dex"
javac -source 8 -target 8 -cp "$CP" -d "$ROOT/classes" "$SRC/BenchmarkService.java"
d8 --min-api 26 --lib "$JAR" --output "$ROOT/dex" \
 "$ROOT/classes/nl/kalenel/s9benchmark/"*.class \
 "$DEPEND/tensorflow-lite.jar" "$DEPEND/tensorflow-lite-api.jar"
unzip -p "$DEPEND/tensorflow-lite.aar" jni/arm64-v8a/libtensorflowlite_jni.so > "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_jni.so"
test -s "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_jni.so"
aapt package -f -M "$ROOT/AndroidManifest.xml" -I "$JAR" -A "$ROOT/assets" -F "$ROOT/unsigned.apk"
(cd "$ROOT/dex" && aapt add "$ROOT/unsigned.apk" classes.dex)
(cd "$ROOT/pkg" && aapt add "$ROOT/unsigned.apk" lib/arm64-v8a/libtensorflowlite_jni.so)
PASS="$ROOT/testpass"
KEY="$ROOT/testonly.jks"
if [[ ! -s "$PASS" ]]; then
 python3 - "$PASS" <<'PY'
from pathlib import Path
import secrets,sys
p=Path(sys.argv[1]);p.write_text(secrets.token_hex(24));p.chmod(0o600)
PY
fi
if [[ ! -s "$KEY" ]];then
 p="$(cat "$PASS")"
 keytool -genkeypair -noprompt -alias s9bench -keyalg RSA -keysize 2048 -validity 365 \
 -dname 'CN=S9 Offline Benchmark,O=Kalenel' -keystore "$KEY" -storepass "$p" -keypass "$p" >/dev/null
fi
apksigner sign --ks "$KEY" --ks-key-alias s9bench --ks-pass "file:$PASS" \
 --out "$ROOT/s9-detector-benchmark.apk" "$ROOT/unsigned.apk"
apksigner verify --verbose "$ROOT/s9-detector-benchmark.apk"
sha256sum "$ROOT/s9-detector-benchmark.apk" > "$ROOT/s9-detector-benchmark.apk.sha256"
printf '%s\n' "$REV" > "$ROOT/.source-commit"
echo "S9_BENCHMARK_BUILD_ONLY_PASS"
