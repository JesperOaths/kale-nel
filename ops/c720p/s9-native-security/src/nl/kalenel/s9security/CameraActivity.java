package nl.kalenel.s9security;
import android.app.*;import android.os.*;import android.content.*;import android.content.pm.PackageManager;
import android.view.*;import android.widget.*;
public final class CameraActivity extends Activity {
 @Override public void onCreate(Bundle b){
  super.onCreate(b);
  LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
  root.setPadding(20,25,20,20);
  TextView label=new TextView(this);
  label.setText("S9+ Native Security\n\n4K Camera2 / motion events / SD-only video\n"
    +"Local post-clip people, vehicle, and animal categorization.\n"
    +"No cloud uploads or persistent verified face identification.\n\n"
    +"Use PILOT to test the Camera2 image stream without saving or switching your main camera.\n"
    +"Enable native mode only after camera handoff has been verified.");
  label.setTextSize(17);root.addView(label);
  Button pilot=new Button(this);pilot.setText("Start analysis-only pilot");
  pilot.setOnClickListener(v->startCamera(true));root.addView(pilot);
  Button live=new Button(this);live.setText("Enable native 4K security mode");
  live.setOnClickListener(v->startCamera(false));root.addView(live);
  Button stop=new Button(this);stop.setText("Stop native service");
  stop.setOnClickListener(v->{Intent i=new Intent(this,CameraService.class);i.setAction("STOP");startForegroundService(i);});
  root.addView(stop);
  setContentView(root);
  if(getIntent()!=null)dispatch(getIntent());
 }
 private void dispatch(Intent i){
  if(i.getBooleanExtra("enable_native_camera",false))
   startCamera(i.getBooleanExtra("pilot_only",false));
  else if(i.getBooleanExtra("pilot_only",false))startCamera(true);
 }
 @Override protected void onNewIntent(Intent i){
  super.onNewIntent(i);setIntent(i);dispatch(i);
 }
 private void startCamera(boolean pilot){
  if(checkSelfPermission("android.permission.CAMERA")!=PackageManager.PERMISSION_GRANTED){
   requestPermissions(new String[]{"android.permission.CAMERA"},100);return;
  }
  Intent i=new Intent(this,CameraService.class);
  i.putExtra("enable_native_camera",true);
  i.putExtra("pilot_only",pilot);
  i.putExtra("validate_dual_stream",pilot);
  i.putExtra("takeover_ipwebcam",!pilot);
  startForegroundService(i);
 }
}
