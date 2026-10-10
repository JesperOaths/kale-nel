#!/usr/bin/env python3
"""Offline source/build safety contract (no S9+, Android SDK or network required)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
source = (ROOT / "src/nl/kalenel/s9security/CameraService.java").read_text()
fetch = (ROOT / "fetch-source.sh").read_text()
compile_script = (ROOT / "compile-only.sh").read_text()
package_script = (ROOT / "package-only.sh").read_text()
installer = (ROOT / "build-install.sh").read_text()

assert "S9_SECURITY_REF" in fetch
assert "commits/$ENCODED" in fetch and "/$SHA/" in fetch
assert "PreviewJpeg Boot RecordingRate" in fetch
assert 'rm -f "$ROOT/.compiled-commit"' in fetch
assert '"$BASE/fetch-source.sh"' in compile_script
assert "PreviewJpeg.class" in compile_script
assert "APK_SOURCE_COMPILE_REVISION_MISMATCH" in package_script
assert "apksigner verify" in package_script
assert 'S9_INSTALL_SHADOW' in installer
assert "REFUSING_SHADOW_INSTALL_EXISTING_NATIVE_PACKAGE" in installer
assert 'stopRecording("service_shutdown")' in source
assert 'reviewer.execute' in source and 'reviewer.shutdown()' in source
assert 'cloud_upload",false' in source
print("S9_NATIVE_SECURITY_PIPELINE_SOURCE_CONTRACT_OK")

assert "RecordingRate.java" in (ROOT / "fetch-source.sh").read_text() or "RecordingRate" in fetch
assert "startup_recovered" in source and "recoverArchive" in source
assert "fallback_evidence_saved" in source
assert "priority_reserve" in source

assert fetch.count("PreviewJpeg Boot RecordingRate CameraControls OutfitEvidence AnonymousClipTracks CameraOrientation; do") == 2, "all Camera2 and on-phone appearance classes must be both downloaded and published"
