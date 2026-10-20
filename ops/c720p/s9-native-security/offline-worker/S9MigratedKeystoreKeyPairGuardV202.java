package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * Portable proof that two HmacSHA256 handles do not represent the same key.
 * Used by a future app-owned AndroidKeystore key resolver; never imports,
 * exports, generates, destroys, provisions, or logs any production key.
 */
public final class S9MigratedKeystoreKeyPairGuardV202 {
    private S9MigratedKeystoreKeyPairGuardV202(){}
    private static final byte[] DOMAIN=
        "s9-migrated-v202-independent-key-custody-probe"
            .getBytes(StandardCharsets.US_ASCII);

    public static void requireDistinct(SecretKey checkpoint,SecretKey journal)
            throws IOException {
        if(checkpoint==null || journal==null ||
           checkpoint==journal || checkpoint.equals(journal) ||
           !"HmacSHA256".equalsIgnoreCase(checkpoint.getAlgorithm()) ||
           !"HmacSHA256".equalsIgnoreCase(journal.getAlgorithm()))
            throw new IOException("independent_hmac_keys_required");
        byte[] c=null,j=null;
        try {
            Mac ca=Mac.getInstance("HmacSHA256");
            ca.init(checkpoint);
            c=ca.doFinal(DOMAIN);
            Mac ja=Mac.getInstance("HmacSHA256");
            ja.init(journal);
            j=ja.doFinal(DOMAIN);
            if(c.length!=32 || j.length!=32 ||
                 MessageDigest.isEqual(c,j))
                throw new IOException("keystore_handles_same_key_or_invalid");
        } catch(GeneralSecurityException err) {
            throw new IOException("keystore_hmac_operation_unavailable",err);
        } finally {
            if(c!=null)java.util.Arrays.fill(c,(byte)0);
            if(j!=null)java.util.Arrays.fill(j,(byte)0);
        }
    }
}
