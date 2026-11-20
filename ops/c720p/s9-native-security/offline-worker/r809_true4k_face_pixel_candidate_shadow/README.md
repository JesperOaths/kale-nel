# R809 true native 4K face candidate extraction, guarded shadow ONLY

Keeps source-sha-pinned, owner-approved single-person input, YuNet,
R807 corrected 640 tensor geometry, R808 .82 review-only score
threshold, 18 px minimum eye spacing, head roll, upper-body ROI and
no automatic gallery approval/People-folder assignment.

**Only variation vs R808:** request full 3840x2160 source frame from
MediaMetadataRetriever, instead of downscaling the original to
1920x1080 before the upper-body head ROI. Process max 2 of 3
requested frames to limit decoder memory/thermal impact.
No new camera config or app installation. Source SHA checked on phone
before and after, shared decoder locks, camera FPS/temp/recording
guards active throughout. Failed/slow resource admission must ABSTAIN.

Any detected face is UNAPPROVED evidence saved privately on phone in
new r809 store. Outputs to C720P are only aggregate metrics, not
face pixels, crops, feature vectors or person identities.
No independent recognition performance claim from proposals.
