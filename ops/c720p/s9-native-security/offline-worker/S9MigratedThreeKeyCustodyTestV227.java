package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

public final class S9MigratedThreeKeyCustodyTestV227 {
    private static SecretKey hmac(String value) {
        return new SecretKeySpec(value.getBytes(StandardCharsets.US_ASCII),
                                 "HmacSHA256");
    }
    @FunctionalInterface private interface Check {void call()throws Exception;}
    private static void denied(Check check,String label)throws Exception {
        try{check.call();throw new AssertionError("unexpected_valid_key_"+label);}
        catch(IOException expected){}
    }
    public static void main(String[] args)throws Exception {
        if(args.length!=0)throw new AssertionError("synthetic_host_only");
        SecretKey c=hmac("only-test-checkpoint-key-aaaaaaaaaaaaaaaa");
        SecretKey j=hmac("only-test-journal-key-bbbbbbbbbbbbbbbb");
        SecretKey m=hmac("only-test-manifest-key-cccccccccccccccc");
        S9MigratedThreeKeyCustodyV227.requireDistinct(c,j,m);
        denied(()->S9MigratedThreeKeyCustodyV227.requireDistinct(c,j,c),
               "reused_checkpoint_handle");
        denied(()->S9MigratedThreeKeyCustodyV227.requireDistinct(c,j,j),
               "reused_journal_handle");
        denied(()->S9MigratedThreeKeyCustodyV227.requireDistinct(c,j,
               hmac("only-test-checkpoint-key-aaaaaaaaaaaaaaaa")),
               "same_material_different_handle");
        denied(()->S9MigratedThreeKeyCustodyV227.requireDistinct(c,c,m),
               "reused_journal_checkpoint");
        denied(()->S9MigratedThreeKeyCustodyV227.requireDistinct(c,j,null),
               "missing_manifest_alias");
        denied(()->S9MigratedThreeKeyCustodyV227.requireDistinct(c,
            new SecretKeySpec("wrong-algorithm-0123456789012345".getBytes(
              StandardCharsets.US_ASCII),"AES"),m),"wrong_algorithm");
        if(S9MigratedThreeKeyCustodyV227.provisionsProductionKeys() ||
           S9MigratedThreeKeyCustodyV227.enablesSaveDelete() ||
           S9MigratedThreeKeyCustodyV227.permitsRecordingDeletion())
           throw new AssertionError("no_production_mutation");
        System.out.println("S9_THREE_DISTINCT_KEY_CUSTODY_V227_HOST_OK");
    }
}
