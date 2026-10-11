package nl.kalenel.s9security;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.os.SystemClock;
import android.view.Surface;
import org.json.JSONObject;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/** Phone hardware AVC preview. Network consumers can never block the codec drain.
 *  Holds no files, audio, images, model state, or references to the SD archive.
 */
final class LiveVideoEncoder {
 static final int WIDTH=1280,HEIGHT=720,BITRATE=2500000;
 private static final int MAX_CLIENTS=4,QUEUE_FRAMES=60;
 private final int targetFps;
 private final Runnable onFailure;
 private final List<Client> clients=new ArrayList<>();
 private MediaCodec codec;
 private Surface surface;
 private Thread drainThread;
 private volatile boolean running=false;
 private volatile byte[] configuration=new byte[0];
 private volatile long frames=0,lastFrameAt=0,slowClients=0;
 private volatile float measuredFps=0f;
 private volatile String codecName="",error="";

 LiveVideoEncoder(int fps,Runnable failure){targetFps=fps;onFailure=failure;}
 Surface start()throws Exception{
  MediaCodecInfo selected=null;
  for(MediaCodecInfo info:new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()){
   if(!info.isEncoder())continue;
   String name=info.getName().toLowerCase(java.util.Locale.ROOT);
   // Android 8/9 lack isHardwareAccelerated(); exclude platform software codecs.
   if(name.startsWith("omx.google.")||name.startsWith("c2.android.")||name.contains(".sw."))continue;
   for(String type:info.getSupportedTypes())if(MediaFormat.MIMETYPE_VIDEO_AVC.equalsIgnoreCase(type)){
    MediaCodecInfo.CodecCapabilities caps=info.getCapabilitiesForType(type);
    boolean inputSurface=false;
    for(int format:caps.colorFormats)if(format==MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)inputSurface=true;
    if(inputSurface&&caps.getVideoCapabilities().areSizeAndRateSupported(WIDTH,HEIGHT,targetFps))selected=info;
   }
   if(selected!=null)break;
  }
  if(selected==null)throw new IOException("720p_hardware_AVC_encoder_unavailable");
  try{
   codecName=selected.getName();codec=MediaCodec.createByCodecName(codecName);
   MediaFormat format=MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC,WIDTH,HEIGHT);
   format.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
   format.setInteger(MediaFormat.KEY_BIT_RATE,BITRATE);
   format.setInteger(MediaFormat.KEY_FRAME_RATE,targetFps);
   format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);
   // Baseline excludes B-frames and is hardware-decodable by the C720P kiosk.
   format.setInteger(MediaFormat.KEY_PROFILE,MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline);
   format.setInteger(MediaFormat.KEY_LEVEL,MediaCodecInfo.CodecProfileLevel.AVCLevel31);
   codec.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
   surface=codec.createInputSurface();codec.start();running=true;
   drainThread=new Thread(new Runnable(){public void run(){drain();}},"s9-hardware-live-avc-drain");
   drainThread.setDaemon(true);drainThread.start();return surface;
  }catch(Exception failed){close();throw failed;}
 }
 Surface surface(){return surface;}
 private static byte[] copy(ByteBuffer source){
  if(source==null)return new byte[0];
  ByteBuffer data=source.duplicate();byte[] bytes=new byte[data.remaining()];data.get(bytes);return bytes;
 }
 private void drain(){
  MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();long previousPts=-1;
  try{
   while(running){
    int index=codec.dequeueOutputBuffer(info,10000);
    if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
     MediaFormat f=codec.getOutputFormat();
     configuration=H264AnnexB.join(H264AnnexB.normalize(copy(f.getByteBuffer("csd-0"))),
       H264AnnexB.normalize(copy(f.getByteBuffer("csd-1"))));
    }else if(index>=0){
     try{
      if(info.size>0){
       ByteBuffer buffer=codec.getOutputBuffer(index);
       if(buffer==null)throw new IOException("AVC_output_buffer_unavailable");
       buffer.position(info.offset);buffer.limit(info.offset+info.size);
       byte[] data=H264AnnexB.normalize(copy(buffer));
       if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)!=0)configuration=data;
       else{
        frames++;lastFrameAt=SystemClock.elapsedRealtime();
        if(previousPts>=0&&info.presentationTimeUs>previousPts){
         float fps=1000000f/(info.presentationTimeUs-previousPts);
         measuredFps=measuredFps>0?0.85f*measuredFps+0.15f*fps:fps;
        }
        previousPts=info.presentationTimeUs;
        publish(data,(info.flags&MediaCodec.BUFFER_FLAG_KEY_FRAME)!=0);
       }
      }
     }finally{codec.releaseOutputBuffer(index,false);}
    }
   }
  }catch(Throwable failed){
   if(running){error="live_encoder_"+failed.getClass().getSimpleName();running=false;onFailure.run();}
  }finally{synchronized(clients){for(Client c:clients)c.disconnect();}}
 }
 private void publish(byte[] data,boolean keyframe){
  synchronized(clients){
   for(Client client:clients){
    if(!client.active)continue;
    if(!client.started){
     if(!keyframe||configuration.length==0)continue;
     client.started=true;
     if(!client.queue.offer(H264AnnexB.join(configuration,data))){client.disconnect();slowClients++;}
    }else if(!client.queue.offer(data)){
     // Losing a referenced frame corrupts following pictures. Disconnect and
     // let the relay reconnect at the next IDR instead of presenting stale video.
     client.disconnect();slowClients++;
    }
   }
  }
 }
 boolean stream(Socket socket)throws Exception{
  final Client client=new Client(socket);
  final OutputStream output=socket.getOutputStream();
  synchronized(clients){
   if(!running||clients.size()>=MAX_CLIENTS)return false;
   clients.add(client);
  }
  try{
   output.write(("HTTP/1.1 200 OK\r\nContent-Type: video/h264\r\n"+
    "Cache-Control: no-store\r\nX-Video-Frame-Rate: "+targetFps+"\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));
   while(running&&client.active){
    byte[] packet=client.queue.poll(5,TimeUnit.SECONDS);
    if(packet==null)break;
    output.write(packet);output.flush();
   }
   return true;
  }finally{synchronized(clients){client.active=false;clients.remove(client);}}
 }
 JSONObject status()throws Exception{
  JSONObject value=new JSONObject();long age=lastFrameAt==0?-1:SystemClock.elapsedRealtime()-lastFrameAt;
  value.put("enabled",running);value.put("codec",codecName);value.put("width",WIDTH);value.put("height",HEIGHT);
  value.put("target_fps",targetFps);value.put("encoded_frames",frames);
  value.put("encoded_fps",age>=0&&age<5000?Math.round(measuredFps*100f)/100f:JSONObject.NULL);
  value.put("last_frame_age_ms",age<0?JSONObject.NULL:age);
  value.put("minimum_fps",CaptureCadence.MIN_FPS);value.put("cadence_ok",running&&age>=0&&age<2000&&measuredFps>=24f);
  synchronized(clients){value.put("clients",clients.size());}
  value.put("slow_client_disconnects",slowClients);value.put("error",error);return value;
 }
 void close(){
  running=false;
  synchronized(clients){for(Client c:clients)c.disconnect();}
  if(drainThread!=null&&drainThread!=Thread.currentThread()){
   try{drainThread.join(1500);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}
  }
  if(codec!=null){try{codec.stop();}catch(Exception ignored){}try{codec.release();}catch(Exception ignored){}codec=null;}
  if(surface!=null){surface.release();surface=null;}
 }
 private static final class Client {
  final Socket socket;
  final ArrayBlockingQueue<byte[]> queue=new ArrayBlockingQueue<>(QUEUE_FRAMES);
  volatile boolean active=true;
  boolean started=false;
  Client(Socket peer){socket=peer;}
  void disconnect(){active=false;try{socket.close();}catch(IOException ignored){}}
 }
}
