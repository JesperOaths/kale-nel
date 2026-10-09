package nl.kalenel.s9person;
import android.content.*;
import android.os.Build;
import android.util.Log;
public final class Boot extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){
  String a=intent==null?"":intent.getAction();
  if(!Intent.ACTION_BOOT_COMPLETED.equals(a)&&!Intent.ACTION_MY_PACKAGE_REPLACED.equals(a))return;
  try{
   Intent run=new Intent(context,PersonService.class);
   if(Build.VERSION.SDK_INT>=26)context.startForegroundService(run);else context.startService(run);
   Log.i("S9PERSON","boot_started "+a);
  }catch(Exception e){Log.e("S9PERSON","boot_failed",e);}
 }
}