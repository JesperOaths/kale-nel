# S9 migrated Save/Delete — owner enrollment review package V235

**State on 21 October 2026: NOT READY FOR HUMAN APPROVAL.**
This document is an approval *specification*, not a request to approve unseen credentials. The live `nl.kalenel.s9migrated` service is neither installed, signed, nor first-enrolled. Chat1 owns app-private Save/Delete, Chat3 owns the shared authenticated hub/browser relay, and Chat2 owns camera/phone-first inference. No camera APK or human decisions are changed.

## Currently verified review artifacts

| Property | Status / exact evidence |
|---|---|
| Existing V233 companion package | `nl.kalenel.s9migrated` on Android 10, separate UID from camera |
| Previous unsigned package | SHA-256 `56faffdf005532eac66f95ed0ede132538b008b840e2d97fc9e51d6ab02e992a`; contains old V231 |
| Corrected-parser **preview** unsigned APK | SHA-256 `80c5fbec76a86d7f6082917747afac2e5751ca9796d9be7dc2be3164885daac5`, 36,263 bytes, source PR #1169 head `58fe20a65561b4283153c1249228790905b93027`; GitHub run #39673576546, build artifact #12380817215 |
| Corrected V231 source | SHA-256 `a252b747806f7dc8068225960da37b0941787d18e97ffb1e5e5326a3b6c1c740`, compiled DEX string plus source pin validated |
| Current signed production companion APK | **NOT CREATED — no signed-release SHA or certificate** |
| Production signing public X.509 certificate SHA-256 | **NOT SELECTED OR APPROVED — fingerprint unknown** |
| Independent six-original manifest SHA-256 | **NOT AVAILABLE — authenticated physical original/source digests cannot currently be read** |
| Manifest population | **UNKNOWN; do not copy synthetic test fixture into production** |
| Companion first-enrollment record, app-UID keys, production action signer | **NOT PRESENT/NOT APPROVED** |
| Live app-private Save/Delete listener, hub route, browser signed action | **NOT INSTALLED/NOT PHYSICALLY VERIFIED** |
| Physical interruption/reboot/outage + fallback behavior | **NOT ACCEPTED** |

The GitHub Actions artifact is temporary and **unsigned**. It is safe as a build/bytecode review artifact only, never as an approved release or install target. The artifact zip digest and inner APK SHA differ; use the **inner APK SHA** for any APK comparison.

## Exact six-original trust computation

Independent qualified evidence requires **six separate original-vs-S9-copy SHA-256 and exact byte-length matches**, source names and trustworthy recording revisions. Historical total is **214,181,934 bytes**. Evidence must come from directly reading the genuine C720P originals and S9+ microSD copies—not a catalog row, browser assertion, a synthetic test file, or a hash embedded by the unsigned app.

`prepare_enrollment_review_v235.py` accepts a private local JSON object with six `rows` holding name, `c720p_original.sha256`, `c720p_original.bytes`, `c720p_original.receipt_id`, and the corresponding `s9_copy.*`. It rejects duplicate/path-unsafe names, missing receipts, divergent digests, divergent sizes and an incorrect overall byte count.

It computes the exact V230/V220 canonical manifest preimage:
```text
S9-MIGRATED-MANIFEST-V216|1|6
FILE|<sorted exact name>|<sha256>|<byte count>|1
...six FILE lines total...
```
A final LF terminates **every** line. The review digest is SHA-256 of the ASCII preimage **without the HMAC trailer**; it is not the APK digest, signing certificate digest or HMAC of the journal. A second, app-private source-manifest HMAC seal is generated only after actual approved first enrollment.

The script can compute a **candidate** digest from supplied receipts. It explicitly sets `approved:false`, `ready_for_human_approval:false`, `actual_media_bytes_verified_by_this_tool:false` and never provisions secrets or permits deletion. A candidate digest alone does NOT establish independent receipt provenance.

## Dedicated production signing and key custody

The trusted release administrator must choose an owner-controlled, protected Android APK signing certificate for the **separate** package `nl.kalenel.s9migrated`, and supply its **public X.509 certificate only** for review. Never upload a private signing key to a GitHub PR or chat. The fingerprint to approve is `SHA256(DER encoded X.509 certificate)`, independently compared with the **actual finally signed APK** certificate (e.g., through `apksigner verify --print-certs`). Do not borrow `nl.kalenel.s9security`'s recorder signing identity or create a debug identity as the silent default.

On first successful independent owner approval, a trusted, app-UID-private human-consent pathway must use the existing V227 create-only durable intent record, then create **three distinct AndroidKeyStore non-exportable HmacSHA256 aliases**: `nl.kalenel.s9migrated.checkpoint.hmac.v202`, `nl.kalenel.s9migrated.journal.hmac.v202`, and `nl.kalenel.s9migrated.source_manifest.hmac.v227`. Each alias must be inaccessible to C720P, Chat3 and the browser. The separate C720P intent signing key is a different trust domain and requires its own authorized custody. Half-completed enrollment is **permanent fail closed for review**, not silent key rotation or automatic retry.

Once enrolled, verify the generation-1 V220 HMAC-sealed manifest and the independently protected V230 six-source digest before opening the V197 dual-store fsynced microSD journal and phone-internal trusted checkpoint. For each subsequent authenticated user intent, enforce V231 strict canonical bytes → V198 signed HMAC/nonce/time → V201 distinct human and on-phone original SHA/size proof → V197 fsync commit/readback → V232 current trusted head/sequence/status. Unbound legacy decisions remain unbound; saved_metadata and deleted_tombstone are **metadata only**, never source retirement authority.

## Smallest possible user approval — **NOT actionable yet**

Only after all source and signer fields above are independently populated, a **single explicit, separately authenticated** owner decision can authorize the exact tuple below for once-only first enrollment:

> I approve only the independently checked six-original generation-1 manifest SHA-256 **[64 hex, not yet available]**, original/S9 receipt set **[six verified pairs]**, dedicated package **nl.kalenel.s9migrated**, final signed APK SHA-256 **[not yet available]** and production signing certificate SHA-256 **[not yet available]**, for a single first enrollment with three distinct non-exportable AndroidKeyStore HMAC aliases and a separately controlled C720P action signer. I do **not** authorize deletion of original video/JPEG files, historical review rewriting, bypassing crash/replay safeguards, silent re-enrollment or a camera restart.

Do not ask the user to approve placeholder values. This conversation alone and the initial unsigned-build authorization do not imply approval of new secrets, APK signing identity, original provenance or enrollment.

## Deployment and interruption gates

1. Independent source/phone digest receipts + final signed APK certificate fingerprint, documented and separately reviewed; on-device package UID and Android permission grant verified.
2. No competing Camera2 APK install or recorder restart; keep app package isolated. A real authenticated, non-exported app-private enrollment and action service must be code-reviewed and signed before ANY installation. The current V233 scaffold has no such service.
3. Test normal denial when no approval, missing or partial 3-key enrollment, changed original SHA/size, changed manifest generation, stale challenge/nonce, wrong HMAC, stale head, unsigned decimal aliases (V231 fix), journal truncated tail, checkpoint ahead/behind and concurrent writers.
4. Only after trusted lifecycle is working, test an actual authorized metadata-only save/delete tombstone and readback across process interruption, network outage/reconnect and **real phone reboot** (journal+internal checkpoint and source original unchanged).
5. Chat3 relay/browser must authenticate actual reviewed revision and return a **source-qualified** status with name+SHA+size+manifest generation+trusted head/sequence, never rely on action ticket issuance as proof of human media viewing. Unauthorized/expired/changed source fails closed. `no_remote_decision` means no trusted remote decision and is not the same as Unsaved.
6. Preserve all six C720P MP4, 17 JPEG fallback files and 48 old unbound reviews. Retirement requires its **own separate** later owner authorization, backed by actual outage/rollback readiness.

## Exact physical access blocker

At approximately 22:29 CEST on 21 October 2026, a previously working private C720P `c720p_status` command succeeded, but three subsequent `c720p_run_command` attempts (including a read-only `date -Is`) were rejected verbatim by the platform:

```
This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.
```

There was **no more detailed reason** available in that response. The user explicitly prohibited using another executor or scheduled job to circumvent the denial, and that boundary was respected. Therefore current MemAvailable, swap, S9 temperature, natural catalog/auxiliary/historical receipts, owner-controlled source hash measurements, Android package installation and genuine phone power/reboot acceptance are **not freshly verifiable** from the denied environment. Prior 17:46 CEST values are historical, not current.

GitHub Actions and repository review are separately available and may provide **source/host/build** evidence only, not access to the private hub or approval authority. Chat2 owns the draft phone-first PR #1164; Chat3 owns shared integration PR #1170. No deployment, signature, credential or media changes should be inferred from GitHub CI.

## Rollback

For source-only code, revert the PR or discard the unsigned build. For a future signed companion, retain the previous approved APK/certificate and sealed app state; physical installation rollback must **not** destroy non-exportable enrolled keys or phone-internal trusted head. Downgrading code without a proved schema/key compatibility check must fail closed. Never uninstall the companion to solve an interrupted commit unless an independently authorized migration explicitly accounts for retained Keystore aliases and trusted journal readback. Existing Camera2 service and C720P original-copy fallback remain authoritative until physical acceptance.
