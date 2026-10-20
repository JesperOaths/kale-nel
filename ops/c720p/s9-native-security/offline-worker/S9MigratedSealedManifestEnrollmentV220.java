package nl.kalenel.s9offline;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * SOURCE-ONLY, FIRST-ENROLMENT UTILITY. NO WEB ROUTE OR INSTALLED SERVICE.
 *
 * Build an *initial*, app-internal, independently approved HMAC-sealed
 * manifest for the six historical C720P MP4s. Strictly create-only.
 * This class does not provision keys, authenticate clients, inspect or
 * delete original video, perform subsequent updates, or authorize Save/Delete.
 *
 * Callers MUST independently attest each original's SHA-256 and size, own
 * the private app UID, supply an already provisioned Android Keystore HMAC
 * handle, and hold a durable, separately protected never-enrolled marker.
 *
 * Failed writes are never repaired silently. A target created before a
 * reported failure must be reviewed under independently trusted authority.
 */
public final class S9MigratedSealedManifestEnrollmentV220 {
    public interface IndependentFirstEnrollment {
        boolean approvesVirginBatch(long generation,
             Map<String,S9MigratedVerifiedSourceV198.Proof> independentlyProven)
             throws IOException;
    }

    public static final int HISTORICAL_COUNT=6;
    public static final long HISTORICAL_TOTAL_BYTES=214181934L;
    private static final Pattern MP4=Pattern.compile(
        "[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    private static final Pattern SHA=Pattern.compile("[a-f0-9]{64}");
    private static final String HEADER="S9-MIGRATED-MANIFEST-V216|1|6\n";
    private static final String NAME=S9MigratedSealedSourceManifestV216.FILE_NAME;

    public static final class EnrollmentReceipt {
        public final int entries;
        public final long generation;
        public final long totalBytes;
        public final boolean privateReadbackVerified;
        private EnrollmentReceipt() {
            entries=HISTORICAL_COUNT;
            generation=1L;
            totalBytes=HISTORICAL_TOTAL_BYTES;
            privateReadbackVerified=true;
        }
        public boolean permitsOriginalDeletion(){return false;}
        public boolean enablesLiveSaveDelete(){return false;}
        public boolean changesPersonReviews(){return false;}
    }

    private S9MigratedSealedManifestEnrollmentV220(){}

    private static String hex(byte[] value) {
        StringBuilder b=new StringBuilder(value.length*2);
        for(byte n:value)
            b.append(Character.forDigit((n>>>4)&15,16))
             .append(Character.forDigit(n&15,16));
        return b.toString();
    }

    /**
     * This method is intentionally incapable of first-use key provisioning.
     * Caller grants an authenticated, single-use enrollment authorization,
     * independent of HTTP or a requester-provided manifest.
     */
    public static EnrollmentReceipt enrollFirstOnly(
          File appPrivateInternalFilesDir,
          SecretKey existingManifestHmacKey,
          Map<String,S9MigratedVerifiedSourceV198.Proof> independentlyProven,
          IndependentFirstEnrollment firstEnrollmentAuthority)throws IOException {
        if(appPrivateInternalFilesDir==null || existingManifestHmacKey==null ||
           !"HmacSHA256".equalsIgnoreCase(existingManifestHmacKey.getAlgorithm()) ||
           independentlyProven==null ||
           independentlyProven.size()!=HISTORICAL_COUNT ||
           firstEnrollmentAuthority==null)
            throw new IOException("initial_manifest_provisioning_incomplete");
        Path directory=appPrivateInternalFilesDir.toPath();
        if(Files.isSymbolicLink(directory) ||
           !Files.isDirectory(directory,LinkOption.NOFOLLOW_LINKS) ||
           directory.toRealPath(LinkOption.NOFOLLOW_LINKS).toString().startsWith("/storage/") ||
           directory.toRealPath(LinkOption.NOFOLLOW_LINKS).toString().startsWith("/sdcard/") ||
           directory.toRealPath(LinkOption.NOFOLLOW_LINKS).toString().startsWith("/mnt/media_rw/"))
            throw new IOException("initial_manifest_must_use_private_internal_directory");
        Path target=directory.resolve(NAME);
        if(Files.exists(target,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("initial_manifest_existing_target_never_replaced");

        // Snapshot the approved import set BEFORE the external authorization
        // callback. An upstream mutable catalog cannot change the record
        // names or bytes after approval but before sealed publication.
        Map<String,S9MigratedVerifiedSourceV198.Proof> stable=
            new java.util.LinkedHashMap<String,S9MigratedVerifiedSourceV198.Proof>(
                independentlyProven);
        List<String> names=new ArrayList<String>(stable.keySet());
        Collections.sort(names);
        long total=0;
        String previous=null;
        StringBuilder body=new StringBuilder(HEADER);
        for(String name:names){
            S9MigratedVerifiedSourceV198.Proof proof=stable.get(name);
            if(name==null || !MP4.matcher(name).matches() || name.contains("..") ||
               (previous!=null && previous.compareTo(name)>=0) ||
               proof==null || !name.equals(proof.name) ||
               proof.sha256==null || !SHA.matcher(proof.sha256).matches() ||
               proof.bytes<10000 || proof.bytes>900L*1024*1024 ||
               !proof.copiedAndIndexed || Long.MAX_VALUE-total<proof.bytes)
                throw new IOException("initial_manifest_source_not_independently_qualified");
            total+=proof.bytes;
            body.append("FILE|").append(name).append('|')
                .append(proof.sha256).append('|').append(proof.bytes)
                .append("|1\n");
            previous=name;
        }
        if(total!=HISTORICAL_TOTAL_BYTES)
            throw new IOException("initial_manifest_historical_total_mismatch");
        if(!firstEnrollmentAuthority.approvesVirginBatch(1L,
                 Collections.unmodifiableMap(stable)))
            throw new IOException("initial_manifest_independent_enrollment_denied");

        final String macHex;
        try{
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(existingManifestHmacKey);
            byte[] signature=mac.doFinal(body.toString()
                  .getBytes(StandardCharsets.US_ASCII));
            macHex=hex(signature);
            Arrays.fill(signature,(byte)0);
        }catch(GeneralSecurityException e){
            throw new IOException("initial_manifest_keystore_hmac_unavailable",e);
        }
        byte[] payload=(body.toString()+"HMAC|"+macHex+"\n")
                .getBytes(StandardCharsets.US_ASCII);
        if(payload.length>1050000)
            throw new IOException("initial_manifest_payload_unbounded");

        // App-private same-volume temporary inode, fsynced before publication.
        // Hard-link publication is atomic, *create only*, unlike ATOMIC_MOVE
        // whose existing-destination behavior is provider-dependent.
        Path temp=Files.createTempFile(directory,".s9-manifest-v220-",".pending");
        boolean linked=false;
        try{
            Files.setPosixFilePermissions(temp,privatePermissions());
            try(FileChannel channel=FileChannel.open(temp,
                    StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){
                ByteBuffer bytes=ByteBuffer.wrap(payload);
                while(bytes.hasRemaining())channel.write(bytes);
                channel.force(true);
            }
            if(Files.exists(target,LinkOption.NOFOLLOW_LINKS))
                throw new IOException("initial_manifest_concurrent_enrollment_refused");
            Files.createLink(target,temp);
            linked=true;
            // On any unsupported directory force or I/O error, do not claim
            // durability, and do NOT erase or replace a published target.
            forceDirectory(directory);
            Files.delete(temp);
            forceDirectory(directory);
            S9MigratedSealedSourceManifestV216.Verified result=
                S9MigratedSealedSourceManifestV216.verifyExisting(
                    appPrivateInternalFilesDir,existingManifestHmacKey,1L);
            if(result.generation!=1L ||
               result.sourceRows.size()!=HISTORICAL_COUNT)
                throw new IOException("initial_manifest_readback_invalid");
            for(String name:names){
                S9MigratedVerifiedSourceV198.Proof expected=stable.get(name);
                S9MigratedVerifiedSourceV198.Proof actual=result.sourceRows.get(name);
                if(actual==null || actual.bytes!=expected.bytes ||
                   !MessageDigest.isEqual(actual.sha256.getBytes(StandardCharsets.US_ASCII),
                    expected.sha256.getBytes(StandardCharsets.US_ASCII)))
                    throw new IOException("initial_manifest_readback_invalid");
            }
            return new EnrollmentReceipt();
        }finally{
            Arrays.fill(payload,(byte)0);
            // A failed pre-publication attempt may clean its own .pending file.
            // After publication a failure remains a protected failed-closed
            // state; never auto-delete the new target.
            if(!linked)Files.deleteIfExists(temp);
        }
    }
    private static Set<PosixFilePermission> privatePermissions(){
        Set<PosixFilePermission> set=new HashSet<PosixFilePermission>();
        set.add(PosixFilePermission.OWNER_READ);
        set.add(PosixFilePermission.OWNER_WRITE);
        return set;
    }
    private static void forceDirectory(Path directory)throws IOException{
        try(FileChannel channel=FileChannel.open(directory,StandardOpenOption.READ)){
            channel.force(true);
        }
    }
    public static boolean liveEndpointInstalled(){return false;}
    public static boolean canRemoveLegacyMedia(){return false;}
}
