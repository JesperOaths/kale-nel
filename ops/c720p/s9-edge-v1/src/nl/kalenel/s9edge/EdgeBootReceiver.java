package nl.kalenel.s9edge;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
public final class EdgeBootReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context, Intent intent) {
  String action=intent==null?"":intent.getAction();
  if(!Intent.ACTION_BOOT_COMPLETED.equals(action)
     &&!Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))return;
  try {
   Intent run=new Intent(context, EdgeService.class);
   if(Build.VERSION.SDK_INT>=26)context.startForegroundService(run);
   else context.startService(run);
   Log.i("S9EDGE","AUTO_START reason="+action);
  }catch(Exception e){Log.e("S9EDGE","AUTO_START_FAIL",e);}
 }
}
