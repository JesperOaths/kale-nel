#!/usr/bin/env python3
"""Static regression gates for the read-only S9 sealed source manifest."""
from pathlib import Path
p=Path(__file__).with_name('S9MigratedSealedSourceManifestV216.java')
s=p.read_text()
for required in ('Mac.getInstance("HmacSHA256")','MessageDigest.isEqual(', 'LinkOption.NOFOLLOW_LINKS','sealed_manifest_generation_rollback','sealed_manifest_signature_mismatch','sealed_manifest_order_or_size_invalid','Collections.unmodifiableMap','S9MigratedVerifiedSourceV198.Proof'):
    assert required in s, required
for forbidden in ('ServerSocket','FileOutputStream','KeyGenerator','deleteIfExists','CameraManager','System.loadLibrary','getEncoded('):
    assert forbidden not in s, forbidden
print('S9_SEALED_MANIFEST_V216_SOURCE_SAFE')
