package nl.kalenel.s9storageprobev204;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.util.regex.Pattern;

/**
 * Disposable, read-only Android 10 cross-app storage permission probe.
 * No recorder, Camera2, network, uploads, SHA or model. Does NOT read any
 * MP4 byte: opening an InputStream and immediately closing is sufficient to
 * establish whether the OS permits file access from this separate app UID.
 * Never logs filenames, contents, user identities or private paths.
 */
public final class StorageProbe extends BroadcastReceiver {
    private static final String TAG="S9_STORAGE_PROBE_V204";
    private static final String ACTION="nl.kalenel.s9storageprobev204.CHECK";
    private static final String SD=
        "/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigrated";
    private static final Pattern MP4=Pattern.compile(
        "[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    @Override public void onReceive(Context context,Intent intent) {
        if(intent==null || !ACTION.equals(intent.getAction()))return;
        File directory=new File(SD);
        boolean directoryExists=directory.isDirectory();
        boolean enumerationAllowed=false;
        boolean oneFileOpenedReadOnly=false;
        int candidateCount=0;
        if(directoryExists) {
            String[] names=directory.list();
            if(names!=null && names.length<5000) {
                enumerationAllowed=true;
                for(String name:names) {
                    if(name==null || !MP4.matcher(name).matches()
                            || name.contains(".."))continue;
                    candidateCount++;
                    if(oneFileOpenedReadOnly)continue;
                    File file=new File(directory,name);
                    if(!file.isFile() || !file.canRead())continue;
                    try(FileInputStream stream=new FileInputStream(file)) {
                        // Deliberately do not consume the stream; zero media bytes.
                        oneFileOpenedReadOnly=true;
                    } catch(Exception ignored) {
                        // Only fixed booleans are logged; no private exceptions.
                    }
                }
            }
        }
        Log.i(TAG,"RESULT directory_exists="+directoryExists
            +" enumeration_allowed="+enumerationAllowed
            +" found_mp4="+(candidateCount>0)
            +" opened_readonly="+oneFileOpenedReadOnly
            +" bytes_read=0"
            +" media_modified=false");
    }
}
