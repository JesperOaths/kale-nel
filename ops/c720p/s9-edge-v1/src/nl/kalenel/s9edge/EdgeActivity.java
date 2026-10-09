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
  if(Build.VERSION.SDK_INT>=26) startForegroundService(i); else startService(i);
  TextView t=new TextView(this);
  t.setText("S9+ local motion detector running.\n\n"
    +"IP Webcam retains camera ownership. No extra camera access, no uploads, "
    +"no recording changes and no deletion. Motion telemetry is available only "
    +"through localhost port 8798 (ADB forwarded to the hub).");
  t.setTextSize(19); t.setPadding(25,35,25,20); setContentView(t);
 }
}
