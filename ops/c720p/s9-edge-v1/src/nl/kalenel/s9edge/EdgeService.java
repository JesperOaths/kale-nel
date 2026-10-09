package nl.kalenel.s9edge;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.media.MediaMetadataRetriever;
import android.os.*;
import android.util.Log;
import org.json.JSONObject;
import org.json.JSONArray;
import java.security.MessageDigest;
import java.util.Locale;
import java.io.*;
import java.net.*;
import java.util.*;

public final class EdgeService extends Service {
 private static final String TAG="S9EDGE";
 private static final int GX=24,GY=14,N=GX*GY;
 private final float[] bg=new float[N],prev=new float[N];
 private final boolean[] mask=new boolean[N],seen=new boolean[N];
 private volatile boolean run=false,ready=false,candidate=false,personCandidate=false,active=false,sdReady=false;
 private volatile long lastFrameMs=0,lastEventMs=0,startedMs=0,events=0,frames=0,failedFrames=0;
 private volatile double changedPct=0,light=0,componentRatio=0;
 private volatile int coherent=0,componentWidth=0,componentHeight=0,temperatureDeciC=0;
 private volatile String error="",sdDirectory="";
 private float previousLight=-1;
 private int streak=0;
 private long lastTrigger=0;
 private Thread analyzer,api,archiver,mlWatcher;
 private volatile boolean personMlHealthy=false;
 private volatile String personMlBackend="none",personMlStatus="not_connected";
 private volatile long personMlFrameAgeMs=-1,personMlEventSeq=0,personMlEventsAccepted=0,personMlLastSeen=0;
 private volatile double personMlLastConfidence=0;
 private volatile int personMlCurrentCount=0;
 private volatile boolean eventFromMl=false;
 private volatile String lastMlPersonBox="";
 private long personMlPreviousSeq=-1;
 private final ArrayDeque<Long> captureTimes=new ArrayDeque<Long>();
 private volatile boolean captureEnabled=false,captureBusy=false;
 private volatile long captureCount=0,captureFailures=0,lastCaptureMs=0;
 private volatile String captureStatus="disabled";
 private android.content.SharedPreferences prefs;
 private volatile long archivedClips=0, archiveErrors=0, lastArchiveMs=0;
 private volatile String lastArchiveResult="idle";
 private ServerSocket server;

 @Override public IBinder onBind(Intent i) { return null; }
 @Override public int onStartCommand(Intent i,int flags,int id) {
   if(i!=null&&i.hasExtra("pilot_recording")){
    captureEnabled=i.getBooleanExtra("pilot_recording",false);
    captureStatus=captureEnabled?"pilot_armed":"disabled";
    prefs.edit().putBoolean("record_pilot",captureEnabled).apply();
    Log.i(TAG,"RECORD_PILOT="+captureEnabled);
    if(captureEnabled&&i.getBooleanExtra("test_recording_once",false))
     maybeCapture(SystemClock.elapsedRealtime(),true,18);
   }
   return START_STICKY;
  }
 @Override public void onCreate() {
  super.onCreate();
  run=true;startedMs=SystemClock.elapsedRealtime();
  prefs=getSharedPreferences("security_capture",MODE_PRIVATE);
  captureEnabled=prefs.getBoolean("record_pilot",false);
  captureCount=prefs.getLong("complete_total",0);
  captureStatus=captureEnabled?"armed_persistent":"disabled";
  if(!prefs.getString("pending_filename","").isEmpty()){
   captureEnabled=false;captureStatus="orphan_capture_requires_inspection";
  }
  if(Build.VERSION.SDK_INT>=26){
   NotificationChannel c=new NotificationChannel("motion","S9+ edge motion",NotificationManager.IMPORTANCE_LOW);
   ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
  }
  Notification n=Build.VERSION.SDK_INT>=26
   ?new Notification.Builder(this,"motion").setContentTitle("S9+ camera motion").setContentText("Local motion analysis, no image uploads").setSmallIcon(android.R.drawable.ic_menu_camera).build()
   :new Notification.Builder(this).setContentTitle("S9+ camera motion").setContentText("Local analysis").setSmallIcon(android.R.drawable.ic_menu_camera).build();
  startForeground(1079,n);
  checkSd();
  analyzer=new Thread(new Runnable(){public void run(){analyzeLoop();}},"edge-motion");
  api=new Thread(new Runnable(){public void run(){serve();}},"edge-api");
  analyzer.start();api.start();
  archiver=new Thread(new Runnable(){public void run(){archiveLoop();}},"edge-sd-archiver");
  archiver.start();
  mlWatcher=new Thread(new Runnable(){public void run(){personMlLoop();}},"s9-person-ml-link");
  mlWatcher.start();
  Log.i(TAG,"START local_only=true sdk="+Build.VERSION.SDK_INT);
 }
 @Override public void onDestroy(){
  run=false;
  try{if(server!=null)server.close();}catch(Exception ignored){}
  if(analyzer!=null)analyzer.interrupt();
  if(api!=null)api.interrupt();
  if(archiver!=null)archiver.interrupt();
  if(mlWatcher!=null)mlWatcher.interrupt();
  super.onDestroy();
 }
 private void checkSd(){
  try {
   File[] dirs=getExternalFilesDirs(null);
   if(dirs!=null) for(File d:dirs){
    if(d==null || d.getAbsolutePath().startsWith("/storage/emulated"))continue;
    if(!"mounted".equals(android.os.Environment.getExternalStorageState(d)))continue;
    StatFs s=new StatFs(d.getAbsolutePath());
    long free=s.getAvailableBytes();
    sdReady=free>10L*1024*1024*1024;
    sdDirectory=d.getAbsolutePath();
    return;
   }
  }catch(Exception e){error="sd:"+e.getClass().getSimpleName();}
  sdReady=false;sdDirectory="";
 }
 private int batteryTemperature(){
  try{
   Intent b=registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
   return b==null?0:b.getIntExtra("temperature",0);
  }catch(Exception e){return 0;}
 }
 private static int grey(int c){return ((c>>16&255)*30+(c>>8&255)*59+(c&255)*11)/100;}
 private void analyzeLoop(){
  while(run){
   // When real on-phone person ML is healthy, suspend the older pixel detector.
   if(personMlHealthy&&SystemClock.elapsedRealtime()-personMlLastSeen<5500){
    try{Thread.sleep(1250);}catch(InterruptedException ignored){}
    continue;
   }
   long start=SystemClock.elapsedRealtime();
   try{
    HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8080/shot.jpg").openConnection();
    c.setConnectTimeout(1500);c.setReadTimeout(1800);c.setUseCaches(false);
    InputStream in=c.getInputStream();
    BitmapFactory.Options o=new BitmapFactory.Options();o.inSampleSize=8;o.inPreferredConfig=Bitmap.Config.RGB_565;
    Bitmap b=BitmapFactory.decodeStream(in,null,o);in.close();c.disconnect();
    if(b==null)throw new IOException("snapshot decode returned null");
    evaluate(b,SystemClock.elapsedRealtime());
    b.recycle();
    error="";
   }catch(Exception e){failedFrames++;ready=false;active=false;candidate=false;error=e.getClass().getSimpleName()+":"+e.getMessage();}
   if(frames%35==0){temperatureDeciC=batteryTemperature();checkSd();}
   long ms=temperatureDeciC>=430?1300:Math.max(150,350-(SystemClock.elapsedRealtime()-start));
   try{Thread.sleep(ms);}catch(InterruptedException ignored){}
  }
 }
 private void evaluate(Bitmap b,long now){
  int w=b.getWidth(),h=b.getHeight();int[] img=new int[w*h];b.getPixels(img,0,w,0,0,w,h);
  float[] cur=new float[N];float mean=0;
  for(int y=0;y<GY;y++)for(int x=0;x<GX;x++){
   int ix=Math.min(w-2,Math.max(1,(2*x+1)*w/(2*GX)));
   int iy=Math.min(h-2,Math.max(1,(2*y+1)*h/(2*GY)));
   float p=(grey(img[iy*w+ix])+grey(img[(iy-1)*w+ix])+grey(img[iy*w+ix-1])+grey(img[(iy+1)*w+ix+1]))/4f;
   cur[y*GX+x]=p;mean+=p;
  }
  mean/=N; frames++;lastFrameMs=now;light=mean;
  if(!ready){
   System.arraycopy(cur,0,bg,0,N);System.arraycopy(cur,0,prev,0,N);
   ready=true;previousLight=mean;return;
  }
  int hits=0;
  for(int i=0;i<N;i++){
   float dBg=Math.abs(cur[i]-bg[i]),dPrev=Math.abs(cur[i]-prev[i]);
   boolean m=(dBg>=19&&dPrev>=7)||(dPrev>=23&&dBg>=14);
   mask[i]=m;if(m)hits++;
  }
  boolean illumination=Math.abs(previousLight-mean)>13 && hits>=(int)(N*0.28);
  previousLight=mean;changedPct=100.0*hits/N;
  int best=0,bw=0,bh=0,by=0;
  Arrays.fill(seen,false);
  int[] q=new int[N];
  for(int i=0;i<N;i++){
   if(!mask[i]||seen[i])continue;
   int s=0,e=0;q[e++]=i;seen[i]=true;
   int minx=GX,miny=GY,maxx=0,maxy=0;
   while(s<e){
    int a=q[s++],x=a%GX,y=a/GX;
    if(x<minx)minx=x;if(y<miny)miny=y;if(x>maxx)maxx=x;if(y>maxy)maxy=y;
    for(int k=0;k<4;k++){
     int nx=x+(k==0?1:k==1?-1:0),ny=y+(k==2?1:k==3?-1:0);
     if(nx>=0&&nx<GX&&ny>=0&&ny<GY){
      int j=ny*GX+nx;
      if(mask[j]&&!seen[j]){seen[j]=true;q[e++]=j;}
     }
    }
   }
   if(e>best){best=e;bw=maxx-minx+1;bh=maxy-miny+1;by=miny;}
  }
  coherent=best;componentWidth=bw;componentHeight=bh;componentRatio=bw==0?0.0:(double)bh/bw;
  boolean vehicleShape=bw>=8&&bh<=3&&by>=3&&by<=10&&bw>=bh*2.6;
  boolean personShape=best>=6&&bh>=4&&bw>=2&&bh>=bw*1.1&&!vehicleShape;
  boolean generic=best>=13&&hits>=18&&bh>=3&&!vehicleShape;
  candidate=!illumination&&(personShape||generic);
  personCandidate=!illumination&&personShape;
  streak=candidate?Math.min(10,streak+1):Math.max(0,streak-1);
  if(streak>=4&&now-lastTrigger>=7000){
   if(!active) {events++;lastTrigger=now;lastEventMs=now;
    Log.i(TAG,"MOTION seq="+events+" pct="+changedPct+" coherent="+best+" personShape="+personShape);
    // Geometric fallback only; neural model drives recordings when healthy.
    if(!personMlHealthy)maybeCapture(now,personShape,best);
   }
   active=true;
  }
  if(!candidate&&now-lastEventMs>3000)active=false;
  for(int i=0;i<N;i++){
   float rate=illumination?0.35f:(mask[i]?0.002f:0.035f);
   bg[i]=bg[i]*(1-rate)+cur[i]*rate;prev[i]=cur[i];
  }
 }


 // S9-to-S9 person inference bridge. No camera images/video leave the phone:
 // only fresh person-event metadata is consumed via phone-local loopback.
 private void personMlLoop(){
  while(run){
   try{
    long now=SystemClock.elapsedRealtime();
    HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8799/status").openConnection();
    c.setConnectTimeout(850);c.setReadTimeout(1100);
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    try(InputStream stream=c.getInputStream()){
     byte[] buf=new byte[2048];int n;
     while((n=stream.read(buf))>=0){
      if(n>0)bytes.write(buf,0,n);
      if(bytes.size()>16000)throw new IOException("ml_status_oversized");
     }
    }finally{c.disconnect();}
    JSONObject state=new JSONObject(bytes.toString("UTF-8"));
    long age=state.optLong("frame_age_ms",-1);
    boolean valid=state.optBoolean("ok",false)&&state.optBoolean("model_ready",false)
     &&age>=0&&age<2500&&state.optLong("model_errors",0)==0
     &&state.optLong("inferences",0)>=3;
    if(!valid){
     personMlStatus="model_not_healthy";personMlHealthy=false;
    }else{
     personMlFrameAgeMs=age;
     personMlBackend=state.optString("backend","unknown");
     personMlLastSeen=now;
     personMlHealthy=true;personMlStatus="healthy";
     long seq=state.optLong("person_events",0);
     personMlEventSeq=seq;
     personMlCurrentCount=Math.max(0,state.optInt("visible_people",0));
     if(personMlPreviousSeq<0||seq<personMlPreviousSeq){
      personMlPreviousSeq=seq;
     }else if(seq>personMlPreviousSeq){
      personMlPreviousSeq=seq;
      double confidence=state.optDouble("person_event_confidence",0);
      long evtAge=state.optLong("person_event_age_ms",-1);
      personMlLastConfidence=confidence;
      JSONArray detected=state.optJSONArray("person_box_milli");
      if(detected!=null&&detected.length()==4){
       lastMlPersonBox=detected.toString();
      }
      // Event comes from the ML app, not from a geometric motion event.
      if(evtAge>=0&&evtAge<5500&&confidence>=0.60){
       personMlEventsAccepted++;
       eventFromMl=true;
       maybeCapture(SystemClock.elapsedRealtime(),true,18);
       Log.i(TAG,"PERSON_ML_EVENT seq="+seq+" confidence="+confidence+" backend="+personMlBackend);
      }
     }
    }
   }catch(Exception e){
    if(SystemClock.elapsedRealtime()-personMlLastSeen>4500){
     personMlHealthy=false;
     personMlStatus="model_unreachable:"+e.getClass().getSimpleName();
    }
   }
   try{Thread.sleep(950);}catch(InterruptedException ignored){}
  }
 }

 // A bounded phone-only recording pilot. No deletion, no hub encoding.
 // Feature flag is OFF until an explicit local ADB command enables it.
 // Stored only in memory, so app/phone restart fails closed by default.
 private synchronized void maybeCapture(long now,boolean personShape,int coherentCells){
  if(!captureEnabled||captureBusy)return;
  if(!personShape&&coherentCells<16)return;
  if(!sdReady||temperatureDeciC>=405){
   captureStatus="blocked_sd_or_temperature";return;
  }
  long wall=System.currentTimeMillis();
  long lastWall=prefs.getLong("last_start_wall",0);
  if(lastWall>0 && wall>=lastWall && wall-lastWall<105000L){
   captureStatus="post_reboot_cooldown";return;
  }
  String history=prefs.getString("hour_history","");
  StringBuilder keep=new StringBuilder();
  int count=0;
  for(String item:history.split(",")){
   try{
    long t=Long.parseLong(item);
    if(t>0&&t<=wall&&wall-t<3600000L){
     count++;
     if(keep.length()>0)keep.append(",");
     keep.append(t);
    }
   }catch(Exception ignored){}
  }
  if(count>=8){captureStatus="persistent_hourly_rate_guard";return;}
  if(keep.length()>0)keep.append(",");
  keep.append(wall);
  prefs.edit().putString("hour_history",keep.toString())
    .putLong("last_start_wall",wall).commit();
  if(lastCaptureMs>0&&now-lastCaptureMs<105000)return;
  while(!captureTimes.isEmpty()&&now-captureTimes.peekFirst()>3600000)
   captureTimes.removeFirst();
  if(captureTimes.size()>=8){captureStatus="hourly_rate_guard";return;}
  captureBusy=true;
  lastCaptureMs=now;
  captureTimes.addLast(now);
  Thread t=new Thread(new Runnable(){public void run(){captureShortClip();}},"s9-record");
  t.start();
 }
 private JSONObject jsonFrom(String path,int timeout) throws Exception {
  HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8080"+path).openConnection();
  c.setConnectTimeout(2000);c.setReadTimeout(timeout);
  ByteArrayOutputStream out=new ByteArrayOutputStream();
  try(InputStream in=c.getInputStream()){
   byte[] b=new byte[2048];int n;
   while((n=in.read(b))>=0){
    if(n>0)out.write(b,0,n);
    if(out.size()>200000)throw new IOException("api_response_too_large");
   }
  }finally{c.disconnect();}
  return new JSONObject(out.toString("UTF-8"));
 }
 private boolean captureBudgetOk() {
  try{
   StatFs internal=new StatFs(getFilesDir().getAbsolutePath());
   if(internal.getAvailableBytes()<1250L*1024*1024)return false;
   if(!sdReady||temperatureDeciC>=405)return false;
   File sd=new File(sdDirectory);
   if(new StatFs(sd.getAbsolutePath()).getAvailableBytes()<15L*1024*1024*1024)return false;
   HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8080/list_videos").openConnection();
   c.setConnectTimeout(2000);c.setReadTimeout(3500);
   ByteArrayOutputStream out=new ByteArrayOutputStream();
   try(InputStream input=c.getInputStream()){
    byte[] b=new byte[4096];int n;
    while((n=input.read(b))>=0){if(n>0)out.write(b,0,n);
     if(out.size()>200000)throw new IOException("record_list_too_large");}
   }finally{c.disconnect();}
   JSONArray files=new JSONArray(out.toString("UTF-8"));
   long bytes=0;
   for(int i=0;i<files.length();i++)bytes+=Math.max(0,files.getJSONObject(i).optLong("size",0));
   return bytes<300L*1024*1024;
  }catch(Exception e){
   captureStatus="budget_check_error";Log.w(TAG,"capture budget",e);return false;
  }
 }
 private void captureShortClip(){
  boolean owned=false;
  String filename="";
  try{
   if(!captureBudgetOk()){captureStatus="source_storage_budget_blocked";return;}
   JSONObject before=jsonFrom("/status.json",5000);
   JSONObject vs=before.optJSONObject("video_status");
   if(vs!=null&&vs.optBoolean("enabled",false)){
    captureStatus="existing_recording_left_alone";return;
   }
   // Start on the phone; allow IP Webcam hardware encoder to do its work.
   JSONObject started=jsonFrom("/startvideo",9000);
   if(!"started".equals(started.optString("result"))) {
    captureStatus="native_recorder_busy_or_failed";return;
   }
   owned=true;
   filename=started.optString("fname");
   if(personMlHealthy&&eventFromMl){
    prefs.edit().putInt("clip_people_"+filename,Math.max(1,personMlCurrentCount))
      .putFloat("clip_ai_score_"+filename,(float)personMlLastConfidence).apply();
   }
   if(personMlHealthy&&lastMlPersonBox.length()>3)
    prefs.edit().putString("clipbox_"+filename,lastMlPersonBox)
      .putFloat("clip_person_score_"+filename,(float)personMlLastConfidence).apply();
   prefs.edit().putString("pending_filename",filename)
     .putLong("pending_start_wall",System.currentTimeMillis()).commit();
   if(!filename.matches("rec_[A-Za-z0-9._-]{5,100}\\.mp4")){
    captureStatus="invalid_native_filename";return;
   }
   captureStatus="recording";
   long until=SystemClock.elapsedRealtime()+18000L;
   while(run&&SystemClock.elapsedRealtime()<until){
    Thread.sleep(500);
    if(batteryTemperature()>=430){captureStatus="thermal_stop";break;}
   }
  }catch(Exception e){
   captureFailures++;captureStatus=e.getClass().getSimpleName()+":"+e.getMessage();
   Log.e(TAG,"recording",e);
  }finally{
   if(owned){
    try{
     JSONObject stopped=jsonFrom("/stopvideo",9000);
     if("stopped".equals(stopped.optString("result"))){
      captureCount++;
      prefs.edit().remove("pending_filename").remove("pending_start_wall")
        .putLong("complete_total",captureCount).commit();
      captureStatus="finalized_awaiting_sd_archive";
     }else{captureFailures++;captureStatus="stop_failed";}
    }catch(Exception e){captureFailures++;captureStatus="stop_exception";}
   }
   captureBusy=false;
  }
 }

 private JSONObject state(){
  JSONObject o=new JSONObject();
  try{
   long now=SystemClock.elapsedRealtime();
   o.put("ok",(personMlHealthy&&personMlLastSeen>0&&now-personMlLastSeen<5500)
     ||(ready&&lastFrameMs>0&&now-lastFrameMs<4000));
   o.put("algorithm","s9-ml-linked-v8");
   o.put("thumbnail_pipeline","person-context-focus-v2");
   o.put("person_ml_healthy",personMlHealthy);
   o.put("person_ml_backend",personMlBackend);
   o.put("person_ml_status",personMlStatus);
   o.put("person_ml_events_seen",personMlEventSeq);
   o.put("person_ml_events_accepted",personMlEventsAccepted);
   o.put("person_ml_visible_people",personMlCurrentCount);
   o.put("person_ml_last_confidence",Math.round(personMlLastConfidence*1000.0)/1000.0);
   o.put("person_ml_frame_age_ms",personMlFrameAgeMs);
   o.put("geometry_fallback_active",!personMlHealthy);
   o.put("ml_capture_link_enabled",true);
   o.put("frames",frames);o.put("errors",failedFrames);
   o.put("frame_age_ms",personMlHealthy?personMlFrameAgeMs:(lastFrameMs==0?-1:now-lastFrameMs));
   o.put("active",active);o.put("candidate",candidate);o.put("person_shape_candidate",personCandidate);
   o.put("changed_percent",Math.round(changedPct*100.0)/100.0);
   o.put("coherent_cells",coherent);o.put("box_w",componentWidth);o.put("box_h",componentHeight);
   o.put("box_aspect",Math.round(componentRatio*100.0)/100.0);
   o.put("mean_light",Math.round(light*10.0)/10.0);
   o.put("event_seq",events);o.put("last_event_age_ms",lastEventMs==0?-1:now-lastEventMs);
   o.put("temperature_c",temperatureDeciC/10.0);o.put("sd_ready",sdReady);
   o.put("sd_dir",sdDirectory);
   o.put("recording_enabled",captureEnabled);
   o.put("recording_in_progress",captureBusy);
   o.put("recording_count",captureCount);
   o.put("recording_failures",captureFailures);
   o.put("recording_status",captureStatus);
   o.put("recording_armed_persistent",prefs!=null&&prefs.getBoolean("record_pilot",false));
   o.put("recording_orphan_present",prefs!=null&&!prefs.getString("pending_filename","").isEmpty());
   o.put("source_storage_limit_mb",300);
   o.put("internal_min_free_mb",1250);
   o.put("sd_min_free_gb",15);
   o.put("last_capture_age_ms",lastCaptureMs==0?-1:now-lastCaptureMs);
   o.put("auto_sd_archive_enabled",true);
   o.put("auto_sd_archive_count",archivedClips);
   o.put("auto_sd_archive_errors",archiveErrors);
   o.put("last_archive_result",lastArchiveResult);
   o.put("last_archive_age_ms",lastArchiveMs==0?-1:now-lastArchiveMs);
   o.put("error",error);
  }catch(Exception e){Log.e(TAG,"JSON",e);}
  return o;
 }



 private float focusScore(Bitmap image){
  int w=image.getWidth(),h=image.getHeight();float sum=0;int n=0;
  for(int y=8;y<h-8;y+=10)for(int x=8;x<w-8;x+=10){
   int v=grey(image.getPixel(x,y));
   sum+=Math.abs(v-grey(image.getPixel(x+3,y)))+
        Math.abs(v-grey(image.getPixel(x,y+3)));
   n++;
  }
  return n==0?0:sum/n;
 }
 private float scoreFrame(Bitmap b,JSONArray personBox){
  float base=focusScore(b);
  int w=b.getWidth(),h=b.getHeight(),sum=0,n=0,low=0,high=0;
  for(int y=10;y<h;y+=24)for(int x=10;x<w;x+=24){
   int v=grey(b.getPixel(x,y));
   sum+=v;n++;
   if(v<20)low++;if(v>245)high++;
  }
  float mean=n>0?sum/(float)n:100f;
  float clipped=n>0?((low+high)/(float)n):0;
  float illumination=mean<32?0.62f:mean>215?0.78f:1.0f;
  float score=base*illumination*(1f-Math.min(0.55f,clipped*0.5f));
  if(personBox!=null&&personBox.length()==4){
   try{
    int x0=Math.max(0,personBox.optInt(1)*w/1000);
    int x1=Math.min(w,personBox.optInt(3)*w/1000);
    int y0=Math.max(0,personBox.optInt(0)*h/1000);
    int y1=Math.min(h,personBox.optInt(2)*h/1000);
    if(x1-x0>35&&y1-y0>40){
     // Score detail around the detected person rather than prioritizing foliage.
     int margin=Math.min(45,Math.max(5,(x1-x0)/6));
     int sx=Math.max(0,x0-margin),sy=Math.max(0,y0-margin);
     int sw=Math.min(w-sx,x1+margin-sx),sh=Math.min(h-sy,y1+margin-sy);
     Bitmap person=Bitmap.createBitmap(b,sx,sy,sw,sh);
     score=score*0.43f+focusScore(person)*0.57f;
     if(person!=b)person.recycle();
    }
   }catch(Exception ignored){}
  }
  return score;
 }
 private Bitmap frameForThumbnail(Bitmap b,JSONArray personBox){
  if(personBox==null||personBox.length()!=4)return b;
  int w=b.getWidth(),h=b.getHeight();
  try{
   double left=Math.max(0,personBox.optInt(1))/1000.0;
   double right=Math.min(1000,personBox.optInt(3))/1000.0;
   double top=Math.max(0,personBox.optInt(0))/1000.0;
   double bottom=Math.min(1000,personBox.optInt(2))/1000.0;
   if(right<=left||bottom<=top)return b;
   // Only a modest crop; preserve context around the incident as evidence.
   double targetW=Math.max(0.72,Math.min(1.0,(right-left)*2.7));
   if(targetW>=0.99)return b;
   int cutW=(int)(w*targetW);
   int cutH=(int)(h*targetW);
   int centerX=(int)(w*(left+right)/2),centerY=(int)(h*(top+bottom)/2);
   int sx=Math.max(0,Math.min(w-cutW,centerX-cutW/2));
   int sy=Math.max(0,Math.min(h-cutH,centerY-cutH/2));
   return Bitmap.createBitmap(b,sx,sy,cutW,cutH);
  }catch(Exception e){return b;}
 }
 private boolean ensureThumbnail(File completed){
  File output=new File(completed.getAbsolutePath()+".thumb.jpg");
  File marker=new File(output.getAbsolutePath()+".v2");
  if(output.isFile()&&output.length()>4000&&marker.isFile())return true;
  if(temperatureDeciC>=415)return false;
  MediaMetadataRetriever retriever=new MediaMetadataRetriever();
  Bitmap selected=null;
  float selectedScore=-1;
  try{
   JSONArray personBox=null;
   String box=prefs.getString("clipbox_"+completed.getName(),"");
   if(box.startsWith("[")){try{personBox=new JSONArray(box);}catch(Exception ignored){}}
   retriever.setDataSource(completed.getAbsolutePath());
   long duration=0;
   try{duration=Long.parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));}
   catch(Exception ignored){}
   if(duration<500)duration=5000;
   for(double frac:new double[]{0.08,0.19,0.30,0.42,0.54,0.66,0.78,0.90}){
    if(batteryTemperature()>=415)break;
    long us=(long)(duration*1000*frac);
    Bitmap frame=null;
    try{frame=retriever.getFrameAtTime(us,MediaMetadataRetriever.OPTION_CLOSEST_SYNC);}catch(Exception ignored){}
    if(frame==null)continue;
    int width=Math.min(960,frame.getWidth());
    int height=Math.max(1,(int)Math.round(frame.getHeight()*width/(double)Math.max(1,frame.getWidth())));
    Bitmap small=Bitmap.createScaledBitmap(frame,width,height,true);
    if(small!=frame)frame.recycle();
    float score=scoreFrame(small,personBox);
    if(score>selectedScore){
     if(selected!=null)selected.recycle();
     selected=small;selectedScore=score;
    }else small.recycle();
   }
   if(selected==null)return output.isFile()&&output.length()>4000;
   Bitmap best=frameForThumbnail(selected,personBox);
   File tmp=new File(output.getAbsolutePath()+".partial");
   try(FileOutputStream o=new FileOutputStream(tmp)){
    if(!best.compress(Bitmap.CompressFormat.JPEG,91,o))throw new IOException("jpeg_encoding_failed");
    o.getFD().sync();
   }
   if(best!=selected)best.recycle();
   if(tmp.length()<4000){tmp.delete();throw new IOException("thumbnail_too_small");}
   if(!tmp.renameTo(output))throw new IOException("thumbnail_rename_failed");
   try(FileOutputStream version=new FileOutputStream(marker)){
    version.write("s9-person-context-focus-v2".getBytes("UTF-8"));version.getFD().sync();
   }
   return true;
  }catch(Exception e){
   Log.w(TAG,"thumbnail generation",e);
   // Retain any existing thumbnail if processing or thermal guard fails.
   return output.isFile()&&output.length()>4000;
  }finally{
   if(selected!=null)selected.recycle();
   try{retriever.release();}catch(Exception ignored){}
  }
 }

 // Only copies explicitly named, completed IP Webcam videos to removable SD.
 // Never deletes or modifies the source; every copy is byte-counted, hashed,
 // and fsynced before being exposed as complete.

 // Copy finalized recordings automatically ON THE S9+, never through the hub.
 // Originals are preserved so the recording pipeline cannot silently discard evidence.
 private void archiveLoop(){
  while(run){
   try{
    temperatureDeciC=batteryTemperature();
    checkSd();
    if(sdReady&&temperatureDeciC<430){
     HttpURLConnection conn=(HttpURLConnection)new URL("http://127.0.0.1:8080/list_videos").openConnection();
     conn.setConnectTimeout(1800);conn.setReadTimeout(4000);
     ByteArrayOutputStream out=new ByteArrayOutputStream();
     try(InputStream input=conn.getInputStream()){
      byte[] buf=new byte[4096];int n;
      while((n=input.read(buf))>=0){if(n>0)out.write(buf,0,n);if(out.size()>100000)throw new IOException("video_index_too_large");}
     }finally{conn.disconnect();}
     JSONArray files=new JSONArray(out.toString("UTF-8"));
     int inspected=0;
     for(int i=0;i<files.length()&&inspected<8&&run;i++){
      JSONObject clip=files.getJSONObject(i);
      String name=clip.optString("name"),sizeText=clip.optString("size");
      long size=0;
      try{size=Long.parseLong(sizeText);}catch(Exception ignored){}
      long epoch=0;
      try{epoch=Long.parseLong(clip.optString("mtime"));}catch(Exception ignored){}
      if(!name.matches("rec_[A-Za-z0-9._-]{5,100}\\.mp4")||name.contains("..")
         ||size<10000||size>256L*1024*1024)continue;
      if(epoch>0&&System.currentTimeMillis()/1000-epoch<45)continue;
      inspected++;
      File sd=new File(new File(sdDirectory,"SecurityClips"),name);
      if(sd.isFile()&&sd.length()==size&&new File(sd.getAbsolutePath()+".verified.json").isFile())continue;
      JSONObject result=archiveNamed(name);
      lastArchiveMs=SystemClock.elapsedRealtime();
      if(result.optBoolean("ok")){archivedClips++;lastArchiveResult="verified";}
      else{archiveErrors++;lastArchiveResult=result.optString("error","archive_failed");break;}
     }
    }
   }catch(Exception e){archiveErrors++;lastArchiveResult=e.getClass().getSimpleName()+":"+e.getMessage();}
   try{Thread.sleep(60000);}catch(InterruptedException ignored){}
  }
 }

 private JSONObject archiveNamed(String filename) {
  JSONObject reply=new JSONObject();
  try {
   if(filename==null||!filename.matches("rec_[A-Za-z0-9._-]{5,100}\\.mp4")
        ||filename.contains(".."))throw new IOException("invalid_file_name");
   File targetBase=null;
   File[] candidates=getExternalFilesDirs(null);
   if(candidates!=null)for(File candidate:candidates){
    if(candidate!=null&&candidate.getAbsolutePath().startsWith("/storage/9C33-6BBD/")){
     targetBase=candidate;break;
    }
   }
   if(targetBase==null)throw new IOException("removable_sd_missing");
   File directory=new File(targetBase,"SecurityClips");
   if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("sd_directory_unavailable");
   StatFs free=new StatFs(directory.getAbsolutePath());
   if(free.getAvailableBytes()<10L*1024*1024*1024)throw new IOException("sd_free_floor");
   long expected=-1;
   HttpURLConnection list=(HttpURLConnection)new URL("http://127.0.0.1:8080/list_videos").openConnection();
   list.setConnectTimeout(2000);list.setReadTimeout(4000);
   ByteArrayOutputStream bout=new ByteArrayOutputStream();
   try(InputStream input=list.getInputStream()){
    byte[] b=new byte[4096];int n;
    while((n=input.read(b))>=0){bout.write(b,0,n);if(bout.size()>100000)throw new IOException("index_too_large");}
   }finally{list.disconnect();}
   JSONArray rows=new JSONArray(bout.toString("UTF-8"));
   for(int i=0;i<rows.length();i++){
    JSONObject j=rows.getJSONObject(i);
    if(filename.equals(j.optString("name"))){expected=j.optLong("size",-1);break;}
   }
   if(expected<10000||expected>256L*1024*1024)throw new IOException("source_not_indexed_or_oversize");
   File completed=new File(directory,filename);
   File partial=new File(directory,filename+".partial");
   if(completed.isFile()&&completed.length()==expected){
    boolean hasThumb=ensureThumbnail(completed);
    reply.put("thumbnail_ready",hasThumb);
    reply.put("ok",true);reply.put("already_archived",true);reply.put("bytes",expected);reply.put("path",completed.getAbsolutePath());return reply;
   }
   if(completed.exists())throw new IOException("archive_conflict");
   HttpURLConnection video=(HttpURLConnection)new URL("http://127.0.0.1:8080/v/"+filename).openConnection();
   video.setConnectTimeout(2000);video.setReadTimeout(7000);
   long transferred=0;String digest="";
   try {
    if(video.getResponseCode()!=200||video.getContentLengthLong()!=expected)throw new IOException("source_length_mismatch");
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream in=video.getInputStream();FileOutputStream out=new FileOutputStream(partial)){
     byte[] buf=new byte[65536];int count;
     while((count=in.read(buf))>=0){
      if(count==0)continue;
      transferred+=count;
      if(transferred>expected)throw new IOException("source_grew_during_copy");
      out.write(buf,0,count);md.update(buf,0,count);
     }
     out.getFD().sync();
    }
    if(transferred!=expected||partial.length()!=expected)throw new IOException("short_copy");
    byte[] signature=md.digest();
    StringBuilder hex=new StringBuilder();
    for(byte part:signature)hex.append(String.format(Locale.US,"%02x",part&255));
    digest=hex.toString();
    // Read-back check ensures SD file bytes match those received over localhost.
    MessageDigest verify=MessageDigest.getInstance("SHA-256");
    try(FileInputStream check=new FileInputStream(partial)){
     byte[] b=new byte[65536];int count;
     while((count=check.read(b))>=0){if(count>0)verify.update(b,0,count);}
    }
    if(!MessageDigest.isEqual(signature,verify.digest()))throw new IOException("sd_readback_mismatch");
    if(!partial.renameTo(completed))throw new IOException("sd_finalize_failed");
    JSONObject manifest=new JSONObject();
    manifest.put("name",filename);manifest.put("bytes",expected);
    manifest.put("sha256",digest);manifest.put("created_at_ms",System.currentTimeMillis());
    manifest.put("source","ipwebcam-local-copy");manifest.put("source_retained",true);
    String personBox=prefs.getString("clipbox_"+filename,"");
    if(personBox.startsWith("[")){
     try{manifest.put("person_box_milli",new JSONArray(personBox));}catch(Exception ignored){}
     manifest.put("person_model_confidence",prefs.getFloat("clip_person_score_"+filename,0));
    }
    manifest.put("thumbnail_pipeline","person-context-focus-v2");
    int persons=prefs.getInt("clip_people_"+filename,-1);
    if(persons>=1){
     manifest.put("ai_person_count_at_trigger",persons);
     manifest.put("ai_person_score_at_trigger",prefs.getFloat("clip_ai_score_"+filename,0));
     manifest.put("content_group",persons>=2?"multiple_people":"one_person");
     manifest.put("content_group_source","s9_gpu_detector_inferred_not_identity");
    }else{
     manifest.put("content_group","unreviewed");
    }
    boolean hasThumb=ensureThumbnail(completed);
    manifest.put("thumbnail_ready",hasThumb);
    if(hasThumb)manifest.put("thumbnail_name",filename+".thumb.jpg");
    File mf=new File(directory,filename+".verified.json");
    try(FileOutputStream output=new FileOutputStream(mf)){
     output.write(manifest.toString().getBytes("UTF-8"));output.getFD().sync();
    }
    reply.put("ok",true);reply.put("bytes",expected);
    reply.put("thumbnail_ready",hasThumb);
    reply.put("sha256",digest);reply.put("path",completed.getAbsolutePath());reply.put("source_retained",true);
   } finally {
    video.disconnect();
    if(partial.isFile()&&!completed.isFile())partial.delete();
   }
  }catch(Exception e){
   try{reply.put("ok",false);reply.put("error",e.getClass().getSimpleName()+":"+e.getMessage());}
   catch(Exception ignored){}
  }
  return reply;
 }

 private void serve(){
  try {
   server=new ServerSocket();server.setReuseAddress(true);
   server.bind(new InetSocketAddress("127.0.0.1",8798));server.setSoTimeout(1500);
   while(run){
    Socket c=null;
    try{
     c=server.accept();c.setSoTimeout(1500);
     BufferedReader r=new BufferedReader(new InputStreamReader(c.getInputStream(),"UTF-8"));
     String first=r.readLine();
     if(first!=null && first.startsWith("GET /")){
      JSONObject answer=state();
      if(first.startsWith("GET /archive?name=")){
       int sep=first.indexOf(" HTTP/");
       String n=sep>0?first.substring("GET /archive?name=".length(),sep):"";
       answer=archiveNamed(URLDecoder.decode(n,"UTF-8"));
      }
      byte[] data=answer.toString().getBytes("UTF-8");
      OutputStream out=c.getOutputStream();
      out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: "+data.length+"\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
      out.write(data);out.flush();
     }
    }catch(SocketTimeoutException ignored){}
     catch(Exception e){Log.w(TAG,"http request",e);}
     finally{try{if(c!=null)c.close();}catch(Exception ignored){}}
   }
  }catch(Exception e){error="server:"+e.getClass().getSimpleName();Log.e(TAG,"api",e);}
 }
}
