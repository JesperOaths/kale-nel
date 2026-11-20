# R805 isolated YuNet shadow input correction
Original camera APK, original FaceEyes.java, original worker and galleries untouched.
The baseline 320 fallback puts just 320x320 pixels in top-left of an ONNX
640x640 tensor. R805 uses a 320 image downsample followed by full
640x640 upsample, fills all 3x640x640 BGR input pixels, reads full
output head grids, and scales model coordinates using source_width/640.
First 640 mode unchanged. R805 outputs only anonymous rejection
histograms. No automatic person identity, matching, enrollment or filing.
Faces if detected stay phone-only as UNAPPROVED candidates.
