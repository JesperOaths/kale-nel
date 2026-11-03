package nl.kalenel.s9offline;

import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaCodecInfo.CodecCapabilities;
import android.media.MediaCodecInfo.VideoCapabilities;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Standalone, read-only Android 10 hardware-codec probe.
 * Executed with app_process: no camera APK install/restart, no codecs created,
 * no original 4K video opened, no MediaMuxer output or identity data.
 */
public final class S9CodecCapabilityProbe {
  private static boolean size(VideoCapabilities caps,int width,int height,int fps){
    try{return caps!=null&&caps.areSizeAndRateSupported(width,height,fps);}
    catch(Exception ignored){return false;}
  }
  public static void main(String[] args){
    try{
      if(args.length!=0)throw new IllegalArgumentException("no_args_allowed");
      JSONObject report=new JSONObject();
      JSONArray codecs=new JSONArray();
      boolean decoder4k=false,encoder360=false,encoder480=false,flex360=false,flex480=false;
      for(MediaCodecInfo info:new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()){
        if(!info.isHardwareAccelerated())continue;
        for(String mime:info.getSupportedTypes()){
          if(!"video/avc".equalsIgnoreCase(mime))continue;
          CodecCapabilities caps=info.getCapabilitiesForType(mime);
          VideoCapabilities video=caps.getVideoCapabilities();
          boolean at4k=size(video,3840,2160,30);
          boolean at360=size(video,640,360,8);
          boolean at480=size(video,848,480,8);
          boolean flexible=false;
          for(int color:caps.colorFormats)
            if(color==CodecCapabilities.COLOR_FormatYUV420Flexible)flexible=true;
          if(info.isEncoder()){
            encoder360|=at360;encoder480|=at480;
            flex360|=at360&&flexible;flex480|=at480&&flexible;
          }else decoder4k|=at4k;
          codecs.put(new JSONObject()
            .put("type",info.isEncoder()?"hardware_encoder":"hardware_decoder")
            .put("name",info.getName())
            .put("avc_4k30",at4k)
            .put("avc_640x360_8",at360)
            .put("avc_848x480_8",at480)
            .put("accepts_yuv420_flexible",flexible));
        }
      }
      report.put("schema_version","s9_standalone_codec_capabilities_v1")
            .put("device_android_sdk",android.os.Build.VERSION.SDK_INT)
            .put("avc_hardware_decoder_4k30",decoder4k)
            .put("avc_hardware_encoder_360p8",encoder360)
            .put("avc_hardware_encoder_480p8",encoder480)
            .put("avc_hardware_encoder_flexible_360p8",flex360)
            .put("avc_hardware_encoder_flexible_480p8",flex480)
            .put("hardware_codec_inventory",codecs)
            .put("read_only",true).put("camera_apk_changed",false)
            .put("recordings_read",false).put("video_transcode_started",false)
            .put("simultaneous_4k_capture_safety_proven",false);
      System.out.println("S9_HARDWARE_CODEC_PROBE "+report.toString());
    }catch(Exception e){
      System.err.println("S9_HARDWARE_CODEC_PROBE_UNAVAILABLE "+e.getClass().getSimpleName());
      System.exit(2);
    }
  }
}
