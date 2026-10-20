package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SOURCE ONLY: exact canonical six-original V216/V220 body binding.
 *
 * The first-use V227 signed key receipt binds a 64-hex externally approved
 * digest, but an HMAC-valid V216 manifest by itself does not prove that its
 * CONTENTS are that exact independently approved set. This computes SHA-256
 * of the canonical V220 MANIFEST PREIMAGE (no HMAC trailer) and requires
 * its equality at every future boot, before opening the two-store journal.
 *
 * Untrusted clients must NEVER supply the approved digest at action time.
 * A protected enrollment authority must store the digest independently.
 * This is NOT an independent proof that the actual S9 MP4 bytes match their
 * advertised SHA-256: the V198 source verifier remains mandatory.
 */
public final class S9MigratedApprovedSixDigestV230 {
    private static final int REQUIRED=6;
    private static final long REQUIRED_BYTES=214181934L;
    private static final Pattern NAME=Pattern.compile(
        "[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    private static final Pattern HEX=Pattern.compile("[a-f0-9]{64}");
    private static final String HEADER="S9-MIGRATED-MANIFEST-V216|1|6\n";

    private S9MigratedApprovedSixDigestV230(){}

    public static String canonicalSha256(
            Map<String,S9MigratedVerifiedSourceV198.Proof> approved)
            throws IOException {
        if(approved==null || approved.size()!=REQUIRED)
            throw new IOException("approved_six_source_rows_required");
        List<String> names=new ArrayList<String>(approved.keySet());
        Collections.sort(names);
        StringBuilder payload=new StringBuilder(HEADER);
        String previous=null;
        long total=0;
        for(String name:names) {
            S9MigratedVerifiedSourceV198.Proof row=approved.get(name);
            if(name==null || !NAME.matcher(name).matches() ||
               name.contains("..") || (previous!=null && previous.compareTo(name)>=0)
               || row==null || !name.equals(row.name)
               || !row.copiedAndIndexed || row.sha256==null
               || !HEX.matcher(row.sha256).matches()
               || row.bytes<10000 || row.bytes>900L*1024*1024
               || Long.MAX_VALUE-total<row.bytes)
                throw new IOException("approved_six_source_row_invalid");
            total+=row.bytes;
            payload.append("FILE|").append(name).append('|')
               .append(row.sha256).append('|').append(row.bytes)
               .append("|1\n");
            previous=name;
        }
        if(total!=REQUIRED_BYTES)
            throw new IOException("approved_six_source_bytes_mismatch");
        byte[] digest;
        try {
            digest=MessageDigest.getInstance("SHA-256").digest(
                 payload.toString().getBytes(StandardCharsets.US_ASCII));
        }catch(GeneralSecurityException error){
            throw new IOException("approved_six_source_digest_unavailable");
        }
        StringBuilder hex=new StringBuilder(64);
        for(byte b:digest) {
            hex.append(Character.forDigit((b>>>4)&15,16));
            hex.append(Character.forDigit(b&15,16));
        }
        Arrays.fill(digest,(byte)0);
        return hex.toString();
    }

    public static void requireSealedManifestEqualsEnrollment(
            S9MigratedSealedSourceManifestV216.Verified sealed,
            String independentlyTrustedFirstEnrollmentDigest)throws IOException {
        if(sealed==null || sealed.generation!=1 ||
           independentlyTrustedFirstEnrollmentDigest==null ||
           !HEX.matcher(independentlyTrustedFirstEnrollmentDigest).matches())
            throw new IOException("source_set_generation_or_anchor_missing");
        String actual=canonicalSha256(sealed.sourceRows);
        if(!MessageDigest.isEqual(
            actual.getBytes(StandardCharsets.US_ASCII),
            independentlyTrustedFirstEnrollmentDigest.getBytes(
                StandardCharsets.US_ASCII)))
            throw new IOException("sealed_source_set_differs_from_approved_enrollment");
    }

    public static boolean installsAndroidApp(){return false;}
    public static boolean authorizesRemoteActions(){return false;}
    public static boolean validatesRealVideoBytes(){return false;}
    public static boolean authorizesC720pOriginalDeletion(){return false;}
}
