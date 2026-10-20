package nl.kalenel.s9keyprobev219;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * Isolated Android 10 Keystore HMAC feasibility test, NOT production enrollment.
 * Unique disposable APP UID + two TEST aliases; no camera/media/network access.
 * Never logs aliases, raw key material, MAC bytes, filenames or personal data.
 *
 * On first use, refuse ANY preexisting alias. Delete only this invocation's
 * test-created aliases, even if one KeyGenerator operation fails midway.
 * No production alias or installed native/edge package is ever touched.
 */
public final class KeyProbe extends BroadcastReceiver {
    private static final String ACTION="nl.kalenel.s9keyprobev219.CHECK";
    private static final String TAG="S9_KEYSTORE_PROBE_V219";
    private static final String A="nl.kalenel.s9keyprobev219.disposable.hmac.a";
    private static final String B="nl.kalenel.s9keyprobev219.disposable.hmac.b";
    private static final byte[] CHALLENGE=
        "s9-keystore-v219-test-input-not-sensitive".getBytes(StandardCharsets.US_ASCII);

    private static SecretKey generate(String alias)throws Exception {
        KeyGenerator generator=KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_HMAC_SHA256,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false).build());
        return generator.generateKey();
    }
    private static byte[] mac(SecretKey key)throws Exception {
        Mac m=Mac.getInstance("HmacSHA256");
        m.init(key);
        return m.doFinal(CHALLENGE);
    }

    @Override public void onReceive(Context context,Intent intent) {
        if(intent==null || !ACTION.equals(intent.getAction()))return;
        boolean createdA=false,createdB=false,nonexportable=false;
        boolean distinct=false,stable=false,cleaned=false,preexisting=false;
        KeyStore store=null;
        try {
            store=KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            preexisting=store.containsAlias(A)||store.containsAlias(B);
            if(!preexisting) {
                SecretKey a=generate(A);
                createdA=true;
                SecretKey b=generate(B);
                createdB=true;
                nonexportable=a!=null && b!=null &&
                    "HmacSHA256".equalsIgnoreCase(a.getAlgorithm()) &&
                    "HmacSHA256".equalsIgnoreCase(b.getAlgorithm()) &&
                    a.getEncoded()==null && b.getEncoded()==null;
                if(nonexportable) {
                    byte[] first=mac(a);
                    byte[] repeat=mac(a);
                    byte[] second=mac(b);
                    stable=first.length==32 && MessageDigest.isEqual(first,repeat);
                    distinct=second.length==32 &&
                        !MessageDigest.isEqual(first,second);
                    java.util.Arrays.fill(first,(byte)0);
                    java.util.Arrays.fill(repeat,(byte)0);
                    java.util.Arrays.fill(second,(byte)0);
                }
            }
        } catch(Exception ignored) {
            // A failure is a negative result, never a reason to retry
            // generation or modify the production camera app.
        } finally {
            try {
                if(store!=null) {
                    if(createdB)store.deleteEntry(B);
                    if(createdA)store.deleteEntry(A);
                    cleaned=!store.containsAlias(A) && !store.containsAlias(B);
                }
            } catch(Exception ignored) {cleaned=false;}
        }
        boolean pass=!preexisting && createdA && createdB && nonexportable
            && stable && distinct && cleaned;
        Log.i(TAG,"PROBE_RESULT pass="+pass
            +" preexisting_alias="+preexisting
            +" created_two_test_keys="+(createdA&&createdB)
            +" nonexportable="+nonexportable
            +" stable_mac="+stable
            +" keys_distinct="+distinct
            +" test_aliases_removed="+cleaned
            +" production_aliases_modified=false"
            +" camera_or_media_touched=false");
    }
}
