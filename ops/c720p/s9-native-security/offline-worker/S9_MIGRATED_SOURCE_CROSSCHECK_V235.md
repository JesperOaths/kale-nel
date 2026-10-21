# V235 independent original/copy digest comparison — source-only

Use this to **prepare**, not grant, the future owner-first enrollment of the dedicated S9 migrated-metadata companion.

## Inputs and independence

Supply two **separately obtained** SHA-256 inventory documents:

- C720P original readback, `role: "c720p-original-hash"`.
- S9+ microSD copied-source readback, `role: "s9-copied-microsd-hash"`.

Each input has exactly `schema: "s9_migrated_source_inventory_v235"` and six entries `{"name":"...mp4","sha256":"64-lowercase-hex","bytes":12345,"hash_complete":true}`. The historical six must total **214,181,934 bytes**. This component does **not** produce either report or calculate a recording's SHA-256 from media. The owner must independently authenticate where each report came from and that hashing actually completed. Claims inside JSON, even `hash_complete:true`, are untrusted assertions.

Run: `python3 s9_migrated_enrollment_provenance_crosscheck_v235.py --c720p-original-inventory /path/to/c720p-report.json --s9-copied-inventory /path/to/phone-report.json`. The utility performs bounded read-only comparison, rejects duplicates/unknown fields/incorrect source totals and any digest, name, size or completeness mismatch; it emits a SHA-256 of the exact V230/V220 generation-one manifest body if **reported** hashes match. It never contacts an actual device, saves a production approval, provisions signing keys, signs APKs, generates or installs the S9 service, edits recordings or removes C720P fallback media.

## What it does *not* prove

The output carries `comparison=MATCHING_REPORTED_HASHES_NOT_INDEPENDENT_ATTESTATION` and explicitly sets `independently_authenticated=false`, `human_owner_approved=false`, `keystore_enrolled=false`, `allows_signed_actions=false`, `allows_media_retirement=false`. Neither the two caller-supplied role labels nor matching digests establish independent origins, trust in the on-phone bytes, absence of copying errors during later mutation, human review, or durable journal state.

Only an independently authenticated **owner/delegated release administrator** may compare these outputs with actual physical hash receipts and separately consent to the exact candidate `candidate_manifest_preimage_sha256` and controlled companion signing certificate. Later one-time V227 Android KeyStore enrollment must bind that exact digest under an app-private antirollback anchor, then seal six actual on-phone sources and verify current SHA via V198 on every action. Do not pass this candidate JSON as a remote consent token, synthesize a VirginApproval callback, or infer that any missing historical decision is an unsaved item.

Production still requires a signed, separately owned Android companion, a local authenticated consent interface and service, Chat3's authenticated hub relay, one real signed action, independent two-store readback and reboot/outage acceptance. **No enrolled state is created by this tool.**
