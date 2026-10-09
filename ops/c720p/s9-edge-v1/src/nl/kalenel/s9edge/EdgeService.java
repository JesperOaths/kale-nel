package nl.kalenel.s9edge;

import android.app.*;
import android.content.*;
import android.graphics.*;
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
 private Thread analyzer,api;
 private ServerSocket server;

 @Override public IBinder onBind(Intent i) { return null; }
 @Override public int onStartCommand(Intent i,int flags,int id) {return START_STICKY;}
 @Override public void onCreate() {
  super.onCreate();
  run=true;startedMs=SystemClock.elapsedRealtime();
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
  Log.i(TAG,"START local_only=true sdk="+Build.VERSION.SDK_INT);
 }
 @Override public void onDestroy(){
  run=false;
  try{if(server!=null)server.close();}catch(Exception ignored){}
  if(analyzer!=null)analyzer.interrupt();
  if(api!=null)api.interrupt();
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
  boolean personShape=best>=3&&bh>=3&&bw>=1&&bh>=bw*0.72&&!vehicleShape;
  boolean generic=best>=6&&hits>=9&&!vehicleShape;
  candidate=!illumination&&(personShape||generic);
  personCandidate=!illumination&&personShape;
  streak=candidate?Math.min(10,streak+1):Math.max(0,streak-1);
  if(streak>=2&&now-lastTrigger>=2500){
   if(!active) {events++;lastTrigger=now;lastEventMs=now;
    Log.i(TAG,"MOTION seq="+events+" pct="+changedPct+" coherent="+best+" personShape="+personShape);
   }
   active=true;
  }
  if(!candidate&&now-lastEventMs>3000)active=false;
  for(int i=0;i<N;i++){
   float rate=illumination?0.35f:(mask[i]?0.002f:0.035f);
   bg[i]=bg[i]*(1-rate)+cur[i]*rate;prev[i]=cur[i];
  }
 }
 private JSONObject state(){
  JSONObject o=new JSONObject();
  try{
   long now=SystemClock.elapsedRealtime();
   o.put("ok",ready&&lastFrameMs>0&&now-lastFrameMs<4000);
   o.put("algorithm","s9-local-coherent-v2");
   o.put("frames",frames);o.put("errors",failedFrames);
   o.put("frame_age_ms",lastFrameMs==0?-1:now-lastFrameMs);
   o.put("active",active);o.put("candidate",candidate);o.put("person_shape_candidate",personCandidate);
   o.put("changed_percent",Math.round(changedPct*100.0)/100.0);
   o.put("coherent_cells",coherent);o.put("box_w",componentWidth);o.put("box_h",componentHeight);
   o.put("box_aspect",Math.round(componentRatio*100.0)/100.0);
   o.put("mean_light",Math.round(light*10.0)/10.0);
   o.put("event_seq",events);o.put("last_event_age_ms",lastEventMs==0?-1:now-lastEventMs);
   o.put("temperature_c",temperatureDeciC/10.0);o.put("sd_ready",sdReady);
   o.put("sd_dir",sdDirectory);
   o.put("recording_enabled",false);
   o.put("error",error);
  }catch(Exception e){Log.e(TAG,"JSON",e);}
  return o;
 }

 // Only copies explicitly named, completed IP Webcam videos to removable SD.
 // Never deletes or modifies the source; every copy is byte-counted, hashed,
 // and fsynced before being exposed as complete.
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
    File mf=new File(directory,filename+".verified.json");
    try(FileOutputStream output=new FileOutputStream(mf)){
     output.write(manifest.toString().getBytes("UTF-8"));output.getFD().sync();
    }
    reply.put("ok",true);reply.put("bytes",expected);
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
