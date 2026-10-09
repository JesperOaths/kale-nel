package nl.kalenel.s3motion;

import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import android.hardware.Camera;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.content.pm.PackageManager;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.Window;
import android.view.WindowManager;
import android.util.Log;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.graphics.Color;
import android.view.Gravity;
import java.util.List;
import java.util.Arrays;

/* All motion analysis occurs ON the Galaxy S3. Only small events go to logcat.
 * No screenshots, image uploads, IP camera server, Internet permission, or recording.
 */
@SuppressWarnings("deprecation")
public final class MotionActivity extends Activity
        implements SurfaceHolder.Callback, Camera.PreviewCallback, SensorEventListener {
    private static final String TAG="S3MOTION";
    private final int GX=24, GY=18, N=432;
    private SurfaceView surface;
    private Camera camera;
    private int cameraWidth=320,cameraHeight=240;
    private byte[] buffer;
    private final float[] background=new float[N];
    private final int[] sample=new int[N];
    private final boolean[] mask=new boolean[N];
    private boolean initialized=false, dark=true;
    private float previousMean=-1,prevCx=-1,prevCy=-1;
    private long lastRead=0,lastLog=0,lastTrigger=0,frames=0,sequence=0;
    private int recent=0, hitCount=0, missCount=0;
    private long session=System.currentTimeMillis();
    private TextView status;
    private boolean holderReady=false;
    private int cameraId=1, blackFrames=0;
    private SensorManager lightManager;
    private Sensor ambientLightSensor;
    private volatile float ambientLux=-1f;
    private volatile long lastLuxAt=0;
    private static final float LUX_DARK_BELOW=35f;
    private static final float LUX_BRIGHT_ABOVE=85f;

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                |WindowManager.LayoutParams.FLAG_FULLSCREEN);
        WindowManager.LayoutParams lp=getWindow().getAttributes();
        lp.screenBrightness=0.02f;
        getWindow().setAttributes(lp);
        FrameLayout root=new FrameLayout(this);
        surface=new SurfaceView(this);
        root.addView(surface,new FrameLayout.LayoutParams(-1,-1));
        status=new TextView(this);
        status.setTextColor(Color.WHITE);status.setBackgroundColor(0x99111111);
        status.setTextSize(14);status.setPadding(12,12,12,12);
        status.setText("S3 bedroom motion – starting camera");
        FrameLayout.LayoutParams label=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        root.addView(status,label);
        setContentView(root);
        surface.getHolder().addCallback(this);
        lightManager=(SensorManager)getSystemService(SENSOR_SERVICE);
        if(lightManager!=null)ambientLightSensor=lightManager.getDefaultSensor(Sensor.TYPE_LIGHT);
        Log.i(TAG,"AMBIENT_SENSOR available="+(ambientLightSensor!=null)+
                " darkBelow="+LUX_DARK_BELOW+" brightAbove="+LUX_BRIGHT_ABOVE);
        Log.i(TAG,"APP_START session="+session+" version=3 lux_gating=true on_phone=true");
    }
    @Override public void surfaceCreated(SurfaceHolder h){holderReady=true; startCamera(h);}
    @Override public void surfaceChanged(SurfaceHolder h,int fmt,int w,int hgt){}
    @Override public void surfaceDestroyed(SurfaceHolder h){holderReady=false;stopCamera();}
    @Override public void onResume(){
        super.onResume();
        if(lightManager!=null && ambientLightSensor!=null)
            lightManager.registerListener(this,ambientLightSensor,SensorManager.SENSOR_DELAY_NORMAL);
        if(holderReady && camera==null)startCamera(surface.getHolder());
    }
    @Override public void onPause(){
        if(lightManager!=null)lightManager.unregisterListener(this);
        stopCamera();
        super.onPause();
    }
    @Override public void onAccuracyChanged(Sensor sensor,int accuracy){}
    @Override public void onSensorChanged(SensorEvent event){
        if(event.sensor.getType()!=Sensor.TYPE_LIGHT || event.values.length==0)return;
        float v=event.values[0];
        if(Float.isNaN(v)||v<0f||v>150000f)return;
        ambientLux=(ambientLux<0f)?v:ambientLux*.75f+v*.25f;
        lastLuxAt=SystemClock.elapsedRealtime();
    }
    @Override public void onDestroy(){stopCamera();super.onDestroy();}

    private void startCamera(SurfaceHolder holder){
        if(camera!=null)return;
        try {
            if(getPackageManager().checkPermission("android.permission.CAMERA",getPackageName())
                    !=PackageManager.PERMISSION_GRANTED) {
                Log.e(TAG,"CAMERA_PERMISSION_MISSING");status.setText("Camera permission required");return;
            }
            camera=Camera.open(cameraId);
            Camera.Parameters p=camera.getParameters();
            Camera.Size best=null;
            for(Camera.Size s:p.getSupportedPreviewSizes()){
                if(best==null || Math.abs(s.width*s.height-320*240)<Math.abs(best.width*best.height-320*240))
                    best=s;
            }
            if(best!=null){cameraWidth=best.width;cameraHeight=best.height;
                p.setPreviewSize(cameraWidth,cameraHeight);}
            int[] fpsChoice=null;
            for(int[] fps:p.getSupportedPreviewFpsRange()) {
                if(fpsChoice==null ||
                   Math.abs(fps[1]-10000)<Math.abs(fpsChoice[1]-10000))
                   fpsChoice=fps;
            }
            if(fpsChoice!=null)p.setPreviewFpsRange(fpsChoice[0],fpsChoice[1]);
            p.setPreviewFormat(android.graphics.ImageFormat.NV21);
            camera.setParameters(p);
            camera.setDisplayOrientation(90);
            buffer=new byte[cameraWidth*cameraHeight*3/2];
            camera.setPreviewDisplay(holder);
            camera.addCallbackBuffer(buffer);
            camera.setPreviewCallbackWithBuffer(this);
            camera.startPreview();
            initialized=false;frames=0;recent=0;hitCount=0;missCount=0;
            previousMean=-1;lastRead=0;lastLog=0;prevCx=-1;prevCy=-1;
            session=System.currentTimeMillis();
            Log.i(TAG,"READY session="+session+" camera="+cameraWidth+"x"+cameraHeight+" camera_id="+cameraId);
            status.setText("S3 motion active – on-phone detection");
        }catch(Exception e){
            Log.e(TAG,"CAMERA_ERROR "+e.getClass().getSimpleName()+" "+e.getMessage());
            status.setText("Camera unavailable");
            stopCamera();
        }
    }
    private void stopCamera(){
        Camera c=camera;camera=null;
        if(c!=null) {
            try{c.setPreviewCallbackWithBuffer(null);}catch(Exception ignored){}
            try{c.stopPreview();}catch(Exception ignored){}
            try{c.release();}catch(Exception ignored){}
        }
    }
    @Override public void onPreviewFrame(byte[] data,Camera source){
        try {
            long now=SystemClock.elapsedRealtime();
            if(now-lastRead>=400 && data!=null && data.length>=cameraWidth*cameraHeight) {
                lastRead=now; analyze(data,now);
            }
        } catch(Exception e){Log.e(TAG,"ANALYSIS_ERROR "+e.getClass().getSimpleName());}
        if(camera==source&&buffer!=null) {
            try{source.addCallbackBuffer(buffer);}catch(Exception ignored){}
        }
    }
    private void analyze(byte[] y,long now){
        long total=0;
        for(int j=0;j<GY;j++){
            int sy=(j*cameraHeight/GY+cameraHeight/(GY*2));
            int offset=sy*cameraWidth;
            for(int i=0;i<GX;i++){
                int sx=i*cameraWidth/GX+cameraWidth/(GX*2);
                int v=y[offset+sx]&255;
                int at=j*GX+i;
                sample[at]=v;
                total+=v;
            }
        }
        float mean=(float)total/N;
        if(mean<5.0f)blackFrames++;else blackFrames=0;
        if(blackFrames>=25 && cameraId==0){
            Log.w(TAG,"BLACK_PREVIEW switching_to_front_camera");
            blackFrames=0;
            runOnUiThread(new Runnable(){
                @Override public void run(){
                    stopCamera();
                    cameraId=1;
                    startCamera(surface.getHolder());
                }
            });
            return;
        }
        if(blackFrames==25 && cameraId==1)
            Log.e(TAG,"BLACK_PREVIEW front_camera_also_blank");

        boolean luxValid=(ambientLux>=0f && SystemClock.elapsedRealtime()-lastLuxAt<120000L);
        if(luxValid){
            // Native ambient light sensor is not fooled by camera auto-exposure.
            if(ambientLux>=LUX_BRIGHT_ABOVE)dark=false;
            else if(ambientLux<=LUX_DARK_BELOW)dark=true;
        }else{
            if(mean>=100)dark=false;
            else if(mean<=73)dark=true;
        }
        frames++;
        if(!initialized){
            for(int k=0;k<N;k++)background[k]=sample[k];
            previousMean=mean;initialized=true;
            heartbeat(now,mean,0,0);return;
        }
        float shift=mean-previousMean;
        int changed=0;
        for(int k=0;k<N;k++){
            // Compensate exposure globally rather than treating it as movement.
            boolean diff=Math.abs(sample[k]-background[k]-shift)>24;
            mask[k]=diff;
            if(diff)changed++;
        }
        float fraction=(float)changed/N;
        float largestArea=0,cx=-1,cy=-1;
        // Connected-component check rejects isolated noisy pixels.
        boolean[] seen=new boolean[N];
        int[] queue=new int[N];
        for(int index=0;index<N;index++){
            if(!mask[index] || seen[index])continue;
            int start=0,end=1,count=0;
            float xx=0,yy=0;
            queue[0]=index;seen[index]=true;
            while(start<end){
                int q=queue[start++],x=q%GX,z=q/GX;count++;xx+=x;yy+=z;
                int[] nb={x>0?q-1:-1,x<GX-1?q+1:-1,z>0?q-GX:-1,z<GY-1?q+GX:-1};
                for(int n:nb)if(n>=0 && mask[n] && !seen[n]){
                    seen[n]=true;queue[end++]=n;
                }
            }
            if(count>largestArea){
                largestArea=count;
                cx=xx/count;cy=yy/count;
            }
        }
        boolean exposure=Math.abs(shift)>20 || fraction>.52f;
        boolean candidate=!exposure && fraction>.025f && fraction<.40f
                && largestArea>=9 && largestArea<=N*.40f;
        boolean moving=prevCx<0 || cx<0 || Math.abs(cx-prevCx)+Math.abs(cy-prevCy)>=.45f;
        if(candidate && moving) {
            hitCount=Math.min(5,hitCount+1);missCount=0;
            prevCx=cx;prevCy=cy;
        } else {
            missCount++;
            if(missCount>=2)hitCount=Math.max(0,hitCount-1);
        }
        if(candidate)recent++;else recent=0;
        float alpha=candidate?.004f:.04f;
        for(int k=0;k<N;k++)background[k]+=(sample[k]-background[k])*alpha;
        previousMean=mean;
        if(dark && hitCount>=3 && recent>=2 && frames>=8 && now-lastTrigger>18000) {
            lastTrigger=now;hitCount=0;recent=0;
            sequence++;
            Log.i(TAG,"MOTION session="+session+" seq="+sequence+
                    " luma="+Math.round(mean)+" changed="+Math.round(fraction*100)+
                    " cluster="+Math.round(largestArea)+" lux="+
                    (ambientLux>=0f?Math.round(ambientLux):-1)+" dark=1");
            status.setText("S3 motion detected (phone processed)");
        }
        heartbeat(now,mean,fraction,largestArea);
    }
    private void heartbeat(long now,float mean,float changed,float largest){
        if(now-lastLog<10000)return;
        lastLog=now;
        Log.i(TAG,"HEARTBEAT session="+session+" luma="+Math.round(mean)+
                " lux="+(ambientLux>=0f?Math.round(ambientLux):-1)+
                " dark="+(dark?1:0)+" changed="+Math.round(changed*100)+
                " largest="+Math.round(largest)+" frames="+frames);
    }
}