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
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SOURCE ONLY: fail-closed one-time KEY custody for a future, separately
 * authenticated S9 metadata companion. NOT a production enrollment command.
 *
 * A virgin, independently approved app UID may generate THREE separate
 * non-exportable AndroidKeyStore HmacSHA256 handles: independent checkpoint,
 * microSD journal, and sealed source manifest. Remote-action signing remains
 * separate: never invent a shared C720P relay secret here.
 *
 * Durable INTENT file is created and fsynced BEFORE creating any keys.
 * A crash, power loss or partial KeyGenerator failure after that point
 * leaves a non-retryable state, never silent key rotation/re-enrollment.
 * A COMPLETED receipt is created/fsynced only after all three keys exist,
 * have distinct real HMAC outputs and are non-exportable. This does not
 * independently attest an Android UID or an approved source SHA: a trusted
 * app context and an out-of-band first-enrollment authority are REQUIRED.
 */
public final class S9MigratedThreeKeyEnrollmentV227 {
    public static final String PACKAGE="nl.kalenel.s9migrated";
    public static final String CHECKPOINT="nl.kalenel.s9migrated.checkpoint.hmac.v202";
    public static final String JOURNAL="nl.kalenel.s9migrated.journal.hmac.v202";
    public static final String SOURCE="nl.kalenel.s9migrated.source_manifest.hmac.v227";
    public static final String INTENT="s9-migrated-hmac-enrollment-intent-v227";
    public static final String COMPLETED="s9-migrated-hmac-enrollment-complete-v227";
    private static final String[] ALIASES={CHECKPOINT,JOURNAL,SOURCE};
    private static final Pattern HEX=Pattern.compile("[0-9a-f]{64}");
    private static final String DOMAIN="S9-KEY-ENROLLMENT-V227|";
    private static final byte[] DISTINCT= "s9-v227-distinct-keys-not-user-data"
        .getBytes(StandardCharsets.US_ASCII);

    public interface KeyStoreOps {
        boolean contains(String alias)throws IOException;
        void createNewHmac256(String alias)throws IOException;
        boolean isNonExportableHmac256(String alias)throws IOException;
        byte[] sign(String alias,byte[] message)throws IOException;
    }
    /** An independent, authenticated, one-time APPROVAL, not a web flag. */
    public interface VirginApproval {
        boolean permitsOnce(String companionPackage,String approvedManifestDigest)
            throws IOException;
    }
    public static final class Receipt {
        public final boolean completed;
        public final String approvedManifestSha256;
        public final boolean allKeyProofsVerified;
        private Receipt(String digest) {
            completed=true;approvedManifestSha256=digest;
            allKeyProofsVerified=true;
        }
        public boolean mayDeleteMedia(){return false;}
        public boolean enablesRemoteActions(){return false;}
        public boolean provisionsRelaySigningKey(){return false;}
    }
    private S9MigratedThreeKeyEnrollmentV227(){}

    private static Path privateDir(File file)throws IOException {
        if(file==null)throw new IOException("internal_directory_required");
        Path path=file.toPath();
        if(Files.isSymbolicLink(path) ||
                !Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("internal_directory_untrusted");
        String real=path.toRealPath(LinkOption.NOFOLLOW_LINKS).toString();
        if(real.startsWith("/storage/") || real.startsWith("/sdcard/") ||
            real.startsWith("/mnt/media_rw/"))
            throw new IOException("enrollment_never_on_micro_sd");
        return path;
    }
    private static void validDigest(String digest)throws IOException {
        if(digest==null || !HEX.matcher(digest).matches())
            throw new IOException("independent_manifest_digest_required");
    }
    private static byte[] ascii(String value) {
        return value.getBytes(StandardCharsets.US_ASCII);
    }
    private static String toHex(byte[] in) {
        StringBuilder out=new StringBuilder(in.length*2);
        for(byte n:in) {
            out.append(Character.forDigit((n>>>4)&15,16));
            out.append(Character.forDigit(n&15,16));
        }
        return out.toString();
    }
    private static void forceDir(Path directory)throws IOException {
        try(FileChannel ch=FileChannel.open(directory,StandardOpenOption.READ)){
            ch.force(true);
        }
    }
    private static Set<PosixFilePermission> privateMode() {
        Set<PosixFilePermission> mode=new HashSet<PosixFilePermission>();
        mode.add(PosixFilePermission.OWNER_READ);
        mode.add(PosixFilePermission.OWNER_WRITE);
        return mode;
    }
    /** CREATE_NEW is an irreversible admission marker, including on failure. */
    private static void writeOnce(Path path,String value)throws IOException {
        byte[] bytes=ascii(value);
        try(FileChannel channel=FileChannel.open(path,
              StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,
              LinkOption.NOFOLLOW_LINKS)){
            Files.setPosixFilePermissions(path,privateMode());
            ByteBuffer data=ByteBuffer.wrap(bytes);
            while(data.hasRemaining())channel.write(data);
            channel.force(true);
        }finally{
            Arrays.fill(bytes,(byte)0);
        }
        forceDir(path.getParent());
    }
    private static String readExact(Path path)throws IOException {
        if(Files.isSymbolicLink(path) ||
           !Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS) ||
           Files.size(path)<75 || Files.size(path)>600)
            throw new IOException("key_enrollment_record_missing_or_replaced");
        return new String(Files.readAllBytes(path),StandardCharsets.US_ASCII);
    }
    private static byte[] tag(KeyStoreOps keys,String alias,byte[] message)
            throws IOException {
        if(!keys.isNonExportableHmac256(alias))
            throw new IOException("nonexportable_hmac256_required");
        byte[] output=keys.sign(alias,message);
        if(output==null || output.length!=32)
            throw new IOException("invalid_keystore_hmac_result");
        return output;
    }
    private static String[] signedProofs(KeyStoreOps keys,String digest,
            String nonce)throws IOException {
        byte[][] identity=new byte[3][];
        byte[] challenge=ascii(DOMAIN+"DISTINCT|"+nonce);
        try {
            for(int k=0;k<ALIASES.length;k++){
                if(!keys.contains(ALIASES[k]))
                    throw new IOException("missing_enrolled_hmac_alias");
                identity[k]=tag(keys,ALIASES[k],challenge);
            }
            for(int i=0;i<3;i++)for(int j=i+1;j<3;j++)
                if(MessageDigest.isEqual(identity[i],identity[j]))
                    throw new IOException("distinct_aliases_share_hmac_key");
            String[] proof=new String[3];
            for(int i=0;i<3;i++){
                byte[] message=ascii(DOMAIN+"ATTEST|"+i+"|"+digest+"|"+nonce);
                byte[] mac=tag(keys,ALIASES[i],message);
                proof[i]=toHex(mac);
                Arrays.fill(mac,(byte)0);
                Arrays.fill(message,(byte)0);
            }
            return proof;
        }finally{
            for(byte[] value:identity)if(value!=null)Arrays.fill(value,(byte)0);
            Arrays.fill(challenge,(byte)0);
        }
    }
    private static boolean exact(String a,String b) {
        return MessageDigest.isEqual(ascii(a),ascii(b));
    }

    /** The caller MUST be the future companion's real app Context, not ADB. */
    public static synchronized Receipt enrollOnce(File privateInternalDirectory,
        String companionPackage,String independentlyApprovedManifestSha256,
        VirginApproval independentAuthority,KeyStoreOps keys)throws IOException {
        if(!PACKAGE.equals(companionPackage) || keys==null ||
           independentAuthority==null)
            throw new IOException("privileged_companion_authority_required");
        validDigest(independentlyApprovedManifestSha256);
        Path dir=privateDir(privateInternalDirectory);
        Path intent=dir.resolve(INTENT),done=dir.resolve(COMPLETED);
        // Every retry, including a crash after just one key, fails closed.
        if(Files.exists(intent,LinkOption.NOFOLLOW_LINKS) ||
           Files.exists(done,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("prior_enrollment_requires_manual_audit");
        for(String alias:ALIASES)if(keys.contains(alias))
            throw new IOException("preexisting_key_requires_manual_audit");
        if(!independentAuthority.permitsOnce(PACKAGE,
                independentlyApprovedManifestSha256))
            throw new IOException("independent_first_enrollment_denied");

        byte[] nonceBytes=new byte[32];
        new SecureRandom().nextBytes(nonceBytes);
        String nonce=toHex(nonceBytes);
        Arrays.fill(nonceBytes,(byte)0);
        String intentBody="INTENT|1|"+independentlyApprovedManifestSha256+
                          "|"+nonce+"\n";
        // The durable, create-only admission marker MUST precede generation.
        writeOnce(intent,intentBody);
        for(String alias:ALIASES) {
            // No recovery/deletion branch: an incomplete issuance is unsafe.
            if(keys.contains(alias))
                throw new IOException("key_appeared_after_admission");
            keys.createNewHmac256(alias);
            if(!keys.contains(alias) ||
               !keys.isNonExportableHmac256(alias))
                throw new IOException("key_generation_not_verified");
        }
        String[] tags=signedProofs(keys,independentlyApprovedManifestSha256,nonce);
        String completedBody="COMPLETE|1|"+independentlyApprovedManifestSha256+
                 "|"+nonce+"|"+tags[0]+"|"+tags[1]+"|"+tags[2]+"\n";
        writeOnce(done,completedBody);
        return verifyExisting(privateInternalDirectory,companionPackage,
                              independentlyApprovedManifestSha256,keys);
    }

    /** No regeneration, no implicit approval; prove both files and all keys. */
    public static synchronized Receipt verifyExisting(File internalDirectory,
       String companionPackage,String independentlyTrustedManifestSha256,
       KeyStoreOps keys)throws IOException {
        if(!PACKAGE.equals(companionPackage) || keys==null)
            throw new IOException("privileged_companion_authority_required");
        validDigest(independentlyTrustedManifestSha256);
        Path dir=privateDir(internalDirectory);
        String intent=readExact(dir.resolve(INTENT));
        String done=readExact(dir.resolve(COMPLETED));
        String[] a=intent.trim().split("\\|",-1);
        String[] b=done.trim().split("\\|",-1);
        if(a.length!=4 || b.length!=7 ||
           !"INTENT".equals(a[0]) || !"COMPLETE".equals(b[0]) ||
           !"1".equals(a[1]) || !"1".equals(b[1]) ||
           !independentlyTrustedManifestSha256.equals(a[2]) ||
           !exact(a[2],b[2]) || !HEX.matcher(a[3]).matches() ||
           !exact(a[3],b[3]))
            throw new IOException("trusted_key_enrollment_anchor_diverged");
        String[] expected=signedProofs(keys,a[2],a[3]);
        for(int i=0;i<3;i++)
            if(!HEX.matcher(b[i+4]).matches() || !exact(expected[i],b[i+4]))
                throw new IOException("trusted_key_enrollment_hmac_mismatch");
        return new Receipt(a[2]);
    }

    public static boolean liveEndpointInstalled(){return false;}
    public static boolean permitsC720pOriginalRetirement(){return false;}
}
