package nl.kalenel.s9offline;

import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.security.Key;
import java.security.KeyStore;
import javax.crypto.SecretKey;

/**
 * SOURCE-ONLY Android-app-private Keystore read path. No Android component,
 * APK, production alias, initial enrollment or permission bypass is installed.
 *
 * This MUST be invoked inside the future authorized Android application UID,
 * never ADB shell / external app without proved media access. Its aliases
 * must be provisioned once, under a separately audited first-use ceremony.
 * A missing alias after reinstall/rollback is NEVER silently recreated:
 * existing microSD metadata or checkpoint may belong to an older key.
 *
 * Opening does NOT establish any recording source proof, user approval,
 * live remote action, or ability to remove a local C720P original.
 */
public final class S9MigratedAndroidKeystoreOwnerV202 {
    public static final String CHECKPOINT_ALIAS=
        "nl.kalenel.s9migrated.checkpoint.hmac.v202";
    public static final String JOURNAL_ALIAS=
        "nl.kalenel.s9migrated.journal.hmac.v202";

    public static final class Existing {
        public final SecretKey internalCheckpoint;
        public final SecretKey microSdJournal;
        public final File privateFilesDir;
        private Existing(SecretKey c,SecretKey j,File dir) {
            internalCheckpoint=c;microSdJournal=j;privateFilesDir=dir;
        }
        public boolean productionKeysCreated(){return false;}
        public boolean mayRemoveOriginal(){return false;}
        public boolean authorizesRemoteMutation(){return false;}
    }

    private S9MigratedAndroidKeystoreOwnerV202(){}

    public static Existing openExisting(Context context) throws IOException {
        if(context==null || context.getApplicationContext()==null)
            throw new IOException("android_app_context_required");
        Context app=context.getApplicationContext();
        if(app.getPackageName()==null || app.getPackageName().isEmpty())
            throw new IOException("android_app_identity_unavailable");
        File files=app.getFilesDir();
        if(files==null || !files.isDirectory() ||
                Files.isSymbolicLink(files.toPath()))
            throw new IOException("android_internal_storage_untrusted");
        String path=files.toPath().toAbsolutePath().normalize().toString();
        if(path.startsWith("/storage/") || path.startsWith("/sdcard/")
                || path.startsWith("/mnt/media_rw/"))
            throw new IOException("keystore_owner_filesdir_not_internal");

        try {
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if(!store.containsAlias(CHECKPOINT_ALIAS)
                || !store.containsAlias(JOURNAL_ALIAS))
                throw new IOException("trusted_hmac_alias_missing_fail_closed");
            Key ck=store.getKey(CHECKPOINT_ALIAS,null);
            Key jk=store.getKey(JOURNAL_ALIAS,null);
            if(!(ck instanceof SecretKey) || !(jk instanceof SecretKey))
                throw new IOException("trusted_hmac_alias_wrong_type");
            SecretKey c=(SecretKey)ck,j=(SecretKey)jk;
            // AndroidKeyStore HMAC keys should not expose raw encoded bytes.
            // Never accept an accidentally imported software key as custody.
            if(c.getEncoded()!=null || j.getEncoded()!=null)
                throw new IOException("trusted_hmac_key_material_exportable");
            S9MigratedKeystoreKeyPairGuardV202.requireDistinct(c,j);
            return new Existing(c,j,files);
        } catch(IOException error) {
            throw error;
        } catch(Exception error) {
            // No aliases, credential contents or key identifiers in errors.
            throw new IOException("android_keystore_open_existing_failed");
        }
    }
}
