package nl.kalenel.s9nativefourk;
import android.app.*;import android.os.*;import android.content.*;import android.content.pm.PackageManager;
import android.hardware.camera2.*;import android.media.CamcorderProfile;import android.util.Log;import android.widget.TextView;
public final class CameraActivity extends Activity {
 @Override public void onCreate(Bundle b){
  super.onCreate(b);
  StringBuilder report=new StringBuilder();
  try {
   CameraManager mgr=(CameraManager)getSystemService(CAMERA_SERVICE);
   for(String id:mgr.getCameraIdList()){
    CameraCharacteristics ch=mgr.getCameraCharacteristics(id);
    int facing=ch.get(CameraCharacteristics.LENS_FACING);
    boolean has=CamcorderProfile.hasProfile(Integer.parseInt(id),CamcorderProfile.QUALITY_2160P);
    report.append("id=").append(id).append(" facing=").append(facing).append(" profile2160=").append(has);
    if(has){CamcorderProfile p=CamcorderProfile.get(Integer.parseInt(id),CamcorderProfile.QUALITY_2160P);
     report.append(" width=").append(p.videoFrameWidth).append(" height=").append(p.videoFrameHeight).append(" fps=").append(p.videoFrameRate).append(" bitrate=").append(p.videoBitRate);}
    report.append("; ");
   }
  } catch(Exception e){report.append(" error=").append(e);}
  Log.i("S9_NATIVE4K_CAPS",report.toString());
  TextView t=new TextView(this);t.setText("Native S9+ 4K capability audit\n"+report.toString());t.setTextSize(16);setContentView(t);
  if(getIntent().getBooleanExtra("start_test",false)){
   if(checkSelfPermission("android.permission.CAMERA")!=PackageManager.PERMISSION_GRANTED){Log.e("S9_NATIVE4K","CAMERA_PERMISSION_MISSING");return;}
   Intent i=new Intent(this,CameraService.class);
   i.putExtra("seconds",Math.min(12,Math.max(4,getIntent().getIntExtra("seconds",8))));
   i.putExtra("manage_ipwebcam",true);
   startForegroundService(i);
  }
 }
}
