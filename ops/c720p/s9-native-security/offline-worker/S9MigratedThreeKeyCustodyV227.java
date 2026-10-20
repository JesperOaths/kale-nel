package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * SOURCE ONLY. Check independent custody of the three HmacSHA256 handles:
 * microSD journal, internal checkpoint, private source-manifest signature.
 *
 * Not a key provisioner. Never exports/generates/deletes/rotates keys.
 * The receiving app's UID and package signature must be authorized by a
 * separately reviewed trusted entry point before this code is invoked.
 */
public final class S9MigratedThreeKeyCustodyV227 {
    private static final byte[] CHALLENGE=
        "s9-c720p-v227-three-independent-key-domains"
            .getBytes(StandardCharsets.US_ASCII);

    private S9MigratedThreeKeyCustodyV227(){}

    public static void requireDistinct(SecretKey checkpoint,
            SecretKey journal,SecretKey sourceManifest)throws IOException {
        SecretKey[] keys={checkpoint,journal,sourceManifest};
        for(int i=0;i<keys.length;i++) {
            if(keys[i]==null || !"HmacSHA256".equalsIgnoreCase(keys[i].getAlgorithm()))
                throw new IOException("three_independent_hmac_handles_required");
            for(int j=0;j<i;j++) {
                if(keys[i]==keys[j] || keys[i].equals(keys[j]))
                    throw new IOException("three_hmac_aliases_are_not_distinct");
            }
        }
        byte[][] tags=new byte[3][];
        try{
            for(int i=0;i<keys.length;i++) {
                Mac mac=Mac.getInstance("HmacSHA256");
                mac.init(keys[i]);
                tags[i]=mac.doFinal(CHALLENGE);
                if(tags[i].length!=32)
                    throw new IOException("hmac_tag_size_invalid");
            }
            for(int i=0;i<tags.length;i++)
                for(int j=0;j<i;j++)
                    if(MessageDigest.isEqual(tags[i],tags[j]))
                        throw new IOException("three_hmac_aliases_same_key_material");
        }catch(GeneralSecurityException error){
            throw new IOException("three_hmac_keystore_signing_failed",error);
        }finally{
            for(byte[] tag:tags)if(tag!=null)Arrays.fill(tag,(byte)0);
        }
    }

    public static boolean provisionsProductionKeys(){return false;}
    public static boolean enablesSaveDelete(){return false;}
    public static boolean permitsRecordingDeletion(){return false;}
}
