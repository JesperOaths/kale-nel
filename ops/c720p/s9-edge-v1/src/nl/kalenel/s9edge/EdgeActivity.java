package nl.kalenel.s9edge;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Build;
import android.widget.TextView;

public class EdgeActivity extends Activity {
 @Override public void onCreate(Bundle b) {
  super.onCreate(b);
  Intent i=new Intent(this,EdgeService.class);
  if(getIntent()!=null&&getIntent().hasExtra("pilot_recording"))
   i.putExtra("pilot_recording",getIntent().getBooleanExtra("pilot_recording",false));
  if(getIntent()!=null&&getIntent().getBooleanExtra("test_recording_once",false)) i.putExtra("test_recording_once",true);
  if(Build.VERSION.SDK_INT>=26) startForegroundService(i); else startService(i);
  TextView t=new TextView(this);
  t.setText("S9+ local motion detector running.\n\n"
    +"IP Webcam retains camera ownership. Local motion analysis and guarded recording; "
    +"no automatic deletion. Motion telemetry is available only "
    +"through localhost port 8798 (ADB forwarded to the hub).");
  t.setTextSize(19); t.setPadding(25,35,25,20); setContentView(t);
 }
 @Override protected void onNewIntent(Intent intent){
  super.onNewIntent(intent);
  setIntent(intent);
  Intent control=new Intent(this,EdgeService.class);
  if(intent!=null&&intent.hasExtra("pilot_recording"))
   control.putExtra("pilot_recording",intent.getBooleanExtra("pilot_recording",false));
  if(intent!=null&&intent.getBooleanExtra("test_recording_once",false)) control.putExtra("test_recording_once",true);
  if(Build.VERSION.SDK_INT>=26)startForegroundService(control);else startService(control);
 }

}
