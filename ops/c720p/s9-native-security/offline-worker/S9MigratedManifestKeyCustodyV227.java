package nl.kalenel.s9offline;

import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.security.Key;
import java.security.KeyStore;
import javax.crypto.SecretKey;

/**
 * SOURCE ONLY. Open existing app-UID-private signing keys without creating
 * aliases. In particular, the separately sealed MP4 source manifest must
 * NEVER reuse the journal or internal antirollback checkpoint key.
 *
 * This class is NOT an exported Android component, an installer, a runtime
 * service, a manifest provisioner or an endpoint. A future privileged app
 * must still authenticate the caller, establish user authorization, and
 * independently anchor trustedMinimumGeneration against downgrade/reinstall.
 */
public final class S9MigratedManifestKeyCustodyV227 {
    public static final String SOURCE_MANIFEST_ALIAS=
        "nl.kalenel.s9migrated.source_manifest.hmac.v227";

    public static final class Existing {
        public final SecretKey internalCheckpoint;
        public final SecretKey microSdJournal;
        public final SecretKey sealedSourceManifest;
        public final File privateFilesDir;
        private Existing(S9MigratedAndroidKeystoreOwnerV202.Existing existing,
                         SecretKey third){
            internalCheckpoint=existing.internalCheckpoint;
            microSdJournal=existing.microSdJournal;
            sealedSourceManifest=third;
            privateFilesDir=existing.privateFilesDir;
        }
        /** No generation is accepted from HTTP or browser input. */
        public S9MigratedSealedSourceManifestV216.Verified
                verifyAlreadyEnrolled(long trustedMinimumGeneration)
                throws IOException {
            if(trustedMinimumGeneration<1)
                throw new IOException("external_source_generation_anchor_required");
            return S9MigratedSealedSourceManifestV216.verifyExisting(
                privateFilesDir,sealedSourceManifest,trustedMinimumGeneration);
        }
        public boolean createdKeys(){return false;}
        public boolean enablesRemoteSaveDelete(){return false;}
        public boolean permitsMediaRemoval(){return false;}
    }

    private S9MigratedManifestKeyCustodyV227(){}

    public static Existing openExisting(Context context)throws IOException {
        // V202 establishes a non-exportable, distinct journal/checkpoint pair
        // in the caller's own app UID; never assume Camera2 shares its UID.
        S9MigratedAndroidKeystoreOwnerV202.Existing pair=
            S9MigratedAndroidKeystoreOwnerV202.openExisting(context);
        try {
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if(!store.containsAlias(SOURCE_MANIFEST_ALIAS))
                throw new IOException("source_manifest_keystore_alias_missing");
            Key key=store.getKey(SOURCE_MANIFEST_ALIAS,null);
            if(!(key instanceof SecretKey))
                throw new IOException("source_manifest_hmac_key_wrong_type");
            SecretKey third=(SecretKey)key;
            if(!"HmacSHA256".equalsIgnoreCase(third.getAlgorithm())
                    || third.getEncoded()!=null)
                throw new IOException("source_manifest_hmac_key_untrusted");
            S9MigratedThreeKeyCustodyV227.requireDistinct(
                pair.internalCheckpoint,pair.microSdJournal,third);
            return new Existing(pair,third);
        }catch(IOException error){
            throw error;
        }catch(Exception error){
            // Do not expose aliases, credentials or MAC contents.
            throw new IOException("source_manifest_existing_keystore_open_failed");
        }
    }

    public static boolean provisionsProductionKeys(){return false;}
    public static boolean installsCompanionService(){return false;}
    public static boolean grantsMediaMutation(){return false;}
}
