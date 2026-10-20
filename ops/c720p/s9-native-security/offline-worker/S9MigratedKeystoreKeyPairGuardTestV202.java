package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

public final class S9MigratedKeystoreKeyPairGuardTestV202 {
    private static SecretKey k(String text){
        return new SecretKeySpec(text.getBytes(StandardCharsets.US_ASCII),
                                 "HmacSHA256");
    }
    @FunctionalInterface interface Checked {void run()throws Exception;}
    private static void denied(Checked work,String message)throws Exception{
        boolean blocked=false;
        try{work.run();}catch(IOException expected){blocked=true;}
        if(!blocked)throw new AssertionError(message);
    }
    public static void main(String[] args)throws Exception {
        if(args.length!=0)throw new AssertionError("host_synthetic_only");
        SecretKey checkpoint=k("synthetic-checkpoint-hmac-key-v202--distinct");
        SecretKey journal=k("synthetic-journal-hmac-key-v202----distinct");
        S9MigratedKeystoreKeyPairGuardV202.requireDistinct(checkpoint,journal);
        denied(()->S9MigratedKeystoreKeyPairGuardV202.requireDistinct(
            checkpoint,checkpoint),"same_handle_rejected");
        denied(()->S9MigratedKeystoreKeyPairGuardV202.requireDistinct(
            checkpoint,k("synthetic-checkpoint-hmac-key-v202--distinct")),
            "different_wrapper_identical_key_rejected");
        denied(()->S9MigratedKeystoreKeyPairGuardV202.requireDistinct(
            checkpoint,null),"missing_alias_rejected");
        denied(()->S9MigratedKeystoreKeyPairGuardV202.requireDistinct(
            new SecretKeySpec("synthetic-wrong-algorithm-0123456789".getBytes(
                StandardCharsets.US_ASCII),"AES"),journal),
            "wrong_algorithm_rejected");
        System.out.println("S9_EXISTING_KEY_PAIR_GUARD_V202_HOST_OK");
    }
}
