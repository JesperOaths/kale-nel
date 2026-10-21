package nl.kalenel.s9offline;

import android.graphics.Bitmap;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import java.nio.ByteBuffer;
import java.nio.file.Path;

/**
 * Android local MP4 decode that binds the actual OUTPUT presentation timestamp
 * to the bitmap. MediaMetadataRetriever.getFrameAtTime does not expose PTS and
 * therefore cannot attest an exact original frame timestamp.
 *
 * One strictly bounded 3840x2160 YUV420 decoder per invocation. The original
 * MP4 is read-only. No Camera2 objects, surfaces or disk writes.
 */
public final class S9Original4KTimedDecoderV371 {
  private S9Original4KTimedDecoderV371() {}
  static final long WINDOW_US=500_000L;
  static final int WIDTH=3840,HEIGHT=2160;
  static void need(boolean b,String reason) {
    if(!b)throw new IllegalStateException(reason);
  }
  public static final class Frame {
    public final Bitmap image;
    public final long actualPtsMs;
    public final long durationMs;
    Frame(Bitmap image,long pts,long duration) {
      this.image=image;this.actualPtsMs=pts;this.durationMs=duration;
    }
  }
  static int clip(int n){return n<0?0:Math.min(255,n);}
  static int pixel(Image.Plane p,int x,int y,Rect crop) {
    int xx=x+crop.left,yy=y+crop.top;
    int index=yy*p.getRowStride()+xx*p.getPixelStride();
    ByteBuffer buffer=p.getBuffer();
    need(index>=0&&index<buffer.limit(),"yuv_plane_bounds");
    return buffer.get(index)&255;
  }
  static Bitmap yuv(Image image) {
    need(image.getFormat()==ImageFormat.YUV_420_888,"decoder_not_yuv420");
    Rect area=image.getCropRect();
    need(area.width()==WIDTH&&area.height()==HEIGHT,
         "decoded_frame_not_original_4k");
    Image.Plane[] planes=image.getPlanes();
    need(planes!=null&&planes.length==3,"unexpected_decoder_planes");
    int[] argb=new int[WIDTH*HEIGHT];
    Rect full=new Rect(0,0,0,0);
    for(int y=0;y<HEIGHT;y++) {
      for(int x=0;x<WIDTH;x++) {
        // Plane crop origin must be accounted for before chroma subsampling.
        int xx=x+area.left,yy=y+area.top;
        int l=pixel(planes[0],xx,yy,full);
        int u=pixel(planes[1],xx/2,yy/2,full)-128;
        int v=pixel(planes[2],xx/2,yy/2,full)-128;
        int c=Math.max(0,l-16);
        int r=clip((298*c+409*v+128)>>8);
        int g=clip((298*c-100*u-208*v+128)>>8);
        int b=clip((298*c+516*u+128)>>8);
        argb[y*WIDTH+x]=0xff000000|(r<<16)|(g<<8)|b;
      }
    }
    return Bitmap.createBitmap(argb,WIDTH,HEIGHT,Bitmap.Config.ARGB_8888);
  }
  public static Frame decode(Path original,long requestedMs,long deadlineNs)
      throws Exception {
    MediaExtractor extractor=new MediaExtractor();
    MediaCodec decoder=null;
    boolean started=false;
    try {
      extractor.setDataSource(original.toString());
      int track=-1;
      for(int i=0;i<extractor.getTrackCount();i++) {
        String mime=extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
        if(mime!=null&&mime.startsWith("video/")) {
          need(track<0,"multiple_video_tracks_untrusted");
          track=i;
        }
      }
      need(track>=0,"original_video_track_missing");
      MediaFormat format=extractor.getTrackFormat(track);
      need(format.getInteger(MediaFormat.KEY_WIDTH)==WIDTH
          &&format.getInteger(MediaFormat.KEY_HEIGHT)==HEIGHT,
          "encoded_original_not_3840x2160");
      long durationUs=format.getLong(MediaFormat.KEY_DURATION);
      long requestUs=Math.multiplyExact(requestedMs,1000L);
      need(durationUs>=3_000_000L&&durationUs<=300_000_000L
           &&requestUs>=0&&requestUs<durationUs,
           "requested_offset_outside_media");
      extractor.selectTrack(track);
      extractor.seekTo(requestUs,MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
      String codecName=format.getString(MediaFormat.KEY_MIME);
      decoder=MediaCodec.createDecoderByType(codecName);
      decoder.configure(format,null,null,0);
      decoder.start();started=true;
      MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
      boolean inputEos=false;
      int outputs=0;
      while(System.nanoTime()<deadlineNs) {
        if(!inputEos) {
          int idx=decoder.dequeueInputBuffer(10000);
          if(idx>=0) {
            ByteBuffer input=decoder.getInputBuffer(idx);
            need(input!=null,"missing_decoder_input_buffer");
            input.clear();
            int len=extractor.readSampleData(input,0);
            if(len<0) {
              decoder.queueInputBuffer(idx,0,0,0,
                  MediaCodec.BUFFER_FLAG_END_OF_STREAM);
              inputEos=true;
            } else {
              long pts=extractor.getSampleTime();
              need(pts>=0,"untrusted_compressed_media_pts");
              decoder.queueInputBuffer(idx,0,len,pts,0);
              extractor.advance();
            }
          }
        }
        int idx=decoder.dequeueOutputBuffer(info,10000);
        if(idx==MediaCodec.INFO_TRY_AGAIN_LATER ||
            idx==MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED ||
            idx==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED)continue;
        need(idx>=0,"decoder_unexpected_output");
        try {
          if(info.size>0) {
            long pts=info.presentationTimeUs;
            need(pts>=0&&pts<durationUs,"decoded_timestamp_outside_media");
            outputs++;
            need(outputs<=210,"excessive_phone_decoded_frames");
            if(pts>=requestUs) {
              need(pts-requestUs<=WINDOW_US,
                   "decoded_pts_too_far_from_requested_sample");
              Image decoded=decoder.getOutputImage(idx);
              need(decoded!=null,"decoded_frame_image_missing");
              try {
                Bitmap copy=yuv(decoded);
                return new Frame(copy,pts/1000L,durationUs/1000L);
              } finally {decoded.close();}
            }
          }
          if((info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0)
            throw new IllegalStateException("media_eos_before_requested_frame");
        } finally {decoder.releaseOutputBuffer(idx,false);}
      }
      throw new IllegalStateException("phone_decode_deadline");
    } finally {
      if(decoder!=null) {
        if(started) {try{decoder.stop();}catch(IllegalStateException ignored){}}
        decoder.release();
      }
      extractor.release();
    }
  }
}
