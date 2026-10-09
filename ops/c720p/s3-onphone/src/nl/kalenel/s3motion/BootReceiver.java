package nl.kalenel.s3motion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent) {
        if(intent==null)return;
        String a=intent.getAction();
        if(!Intent.ACTION_BOOT_COMPLETED.equals(a) &&
            !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a))return;
        Intent start=new Intent(context,MotionActivity.class);
        start.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            context.startActivity(start);
            Log.i("S3MOTION","BOOT_LAUNCH requested");
        }catch(Exception e) {
            Log.e("S3MOTION","BOOT_LAUNCH_FAILED "+e.getClass().getSimpleName());
        }
    }
}
