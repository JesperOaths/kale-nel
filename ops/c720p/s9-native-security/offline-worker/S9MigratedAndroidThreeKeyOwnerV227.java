package nl.kalenel.s9offline;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.security.Key;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * SOURCE-ONLY AndroidKeyStore implementation of the V227 first-use barrier.
 * Not installed, not an Android component or HTTP endpoint.
 *
 * Requires an Android Context for the future DEDICATED companion UID
 * nl.kalenel.s9migrated. Never run this from Camera2, ADB shell or old Edge.
 * HMAC aliases are NONEXPORTABLE. A failed first enrollment is permanently
 * blocked by its pre-generation durable intent; no automatic key deletion,
 * rotation, repair, uninstallation or privilege workaround.
 */
public final class S9MigratedAndroidThreeKeyOwnerV227
        implements S9MigratedThreeKeyEnrollmentV227.KeyStoreOps {
    private final Context app;
    private final KeyStore store;

    private S9MigratedAndroidThreeKeyOwnerV227(Context context)
            throws IOException {
        if(context==null || context.getApplicationContext()==null)
            throw new IOException("trusted_android_context_required");
        app=context.getApplicationContext();
        if(!S9MigratedThreeKeyEnrollmentV227.PACKAGE.equals(app.getPackageName()))
            throw new IOException("dedicated_companion_uid_required");
        if(app.getFilesDir()==null ||
           !app.getFilesDir().isDirectory() ||
           Files.isSymbolicLink(app.getFilesDir().toPath()))
            throw new IOException("app_internal_files_dir_required");
        try {
            store=KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
        } catch(Exception error) {
            throw new IOException("android_keystore_not_ready");
        }
    }
    public static S9MigratedThreeKeyEnrollmentV227.Receipt enrollFirstOnly(
            Context trustedContext,String independentManifestSha256,
            S9MigratedThreeKeyEnrollmentV227.VirginApproval independentApproval)
            throws IOException {
        S9MigratedAndroidThreeKeyOwnerV227 owner=
            new S9MigratedAndroidThreeKeyOwnerV227(trustedContext);
        return S9MigratedThreeKeyEnrollmentV227.enrollOnce(
            owner.app.getFilesDir(),owner.app.getPackageName(),
            independentManifestSha256,independentApproval,owner);
    }
    public static S9MigratedThreeKeyEnrollmentV227.Receipt verifyExistingOnly(
            Context trustedContext,String independentManifestSha256)
            throws IOException {
        S9MigratedAndroidThreeKeyOwnerV227 owner=
            new S9MigratedAndroidThreeKeyOwnerV227(trustedContext);
        return S9MigratedThreeKeyEnrollmentV227.verifyExisting(
            owner.app.getFilesDir(),owner.app.getPackageName(),
            independentManifestSha256,owner);
    }
    private static void checkAlias(String alias)throws IOException {
        if(!S9MigratedThreeKeyEnrollmentV227.CHECKPOINT.equals(alias) &&
           !S9MigratedThreeKeyEnrollmentV227.JOURNAL.equals(alias) &&
           !S9MigratedThreeKeyEnrollmentV227.SOURCE.equals(alias))
            throw new IOException("unapproved_android_hmac_alias");
    }
    @Override public boolean contains(String alias)throws IOException {
        checkAlias(alias);
        try {return store.containsAlias(alias);}
        catch(Exception error){throw new IOException("keystore_alias_probe_failed");}
    }
    @Override public void createNewHmac256(String alias)throws IOException {
        checkAlias(alias);
        if(contains(alias))throw new IOException("keystore_alias_already_exists");
        try {
            KeyGenerator generator=KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_HMAC_SHA256,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,
                KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false).build());
            generator.generateKey();
        }catch(Exception error){
            // Even if generation partially succeeded the intent marker
            // must remain; a second attempt is categorically forbidden.
            throw new IOException("keystore_first_key_generation_failed");
        }
    }
    private SecretKey getExisting(String alias)throws IOException {
        checkAlias(alias);
        try {
            Key key=store.getKey(alias,null);
            if(!(key instanceof SecretKey))
                throw new IOException("keystore_key_not_hmac");
            SecretKey result=(SecretKey)key;
            if(!"HmacSHA256".equalsIgnoreCase(result.getAlgorithm()) ||
               result.getEncoded()!=null)
                throw new IOException("nonexportable_hmac256_required");
            return result;
        }catch(IOException error){throw error;}
        catch(Exception error){throw new IOException("keystore_key_read_failed");}
    }
    @Override public boolean isNonExportableHmac256(String alias)
            throws IOException {
        return getExisting(alias)!=null;
    }
    @Override public byte[] sign(String alias,byte[] message)throws IOException {
        if(message==null || message.length<1 || message.length>1000)
            throw new IOException("bounded_hmac_message_required");
        try {
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(getExisting(alias));
            return mac.doFinal(message);
        }catch(IOException error){throw error;}
        catch(Exception error){throw new IOException("keystore_sign_operation_failed");}
    }
    public static boolean cameraAppModified(){return false;}
    public static boolean rawKeysExported(){return false;}
    public static boolean installedProductionEndpoint(){return false;}
}
