package nl.kalenel.s9security;
import android.content.*;import android.os.Build;
public final class Boot extends BroadcastReceiver {
 @Override public void onReceive(Context ctx,Intent intent){
  if(!ctx.getSharedPreferences("native",Context.MODE_PRIVATE).getBoolean("enabled",false))return;
  Intent i=new Intent(ctx,CameraService.class);
  i.putExtra("enable_native_camera",true);
  i.putExtra("pilot_only",false);
  if(Build.VERSION.SDK_INT>=26)ctx.startForegroundService(i);else ctx.startService(i);
 }
}
