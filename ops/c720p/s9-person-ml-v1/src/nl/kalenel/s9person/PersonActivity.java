package nl.kalenel.s9person;
import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.widget.TextView;
public final class PersonActivity extends Activity {
 @Override public void onCreate(Bundle b) {
  super.onCreate(b);
  Intent i=new Intent(this,PersonService.class);
  if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);
  TextView t=new TextView(this);
  t.setText("S9+ local person recognition\n\n"
    +"TensorFlow Lite analysis runs on this phone. "
    +"This companion does NOT control recording or delete evidence. "
    +"Telemetry: localhost:8799 (via ADB).");
  t.setTextSize(19);t.setPadding(25,35,25,25);setContentView(t);
 }
}