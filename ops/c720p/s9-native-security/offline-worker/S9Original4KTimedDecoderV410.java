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
public final class S9Original4KTimedDecoderV410 {
  private S9Original4KTimedDecoderV410() {}
  static final long WINDOW_US=500_000L;
  static final long ROUNDING_TOLERANCE_US=1_000L;
  static final int WIDTH=3840,HEIGHT=2160;
  static void need(boolean b,String reason) {
    if(!b)throw new IllegalStateException(reason);
  }
  public static final class Frame {
    public final Bitmap image;
    // Full precision from MediaCodec.BufferInfo.presentationTimeUs.
    // Never reconstruct this value from a requested seek or rounded milliseconds.
    public final long actualPtsUs;
    public final long actualPtsMs;
    public final long durationMs;
    Frame(Bitmap image,long ptsUs,long durationUs) {
      this.image=image;
      this.actualPtsUs=ptsUs;
      this.actualPtsMs=ptsUs/1000L;
      this.durationMs=durationUs/1000L;
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
  /** Convert only the approved subject ROI from the SAME MediaCodec output image.
   * Never allocate the full 4K ARGB array/Bitmap. Pixel and chroma coordinates
   * are relative to the unmodified original 3840x2160 cropped-image origin.
   */
  static Bitmap yuvCrop(Image image,int x0,int y0,int x1,int y1) {
    need(image.getFormat()==ImageFormat.YUV_420_888,"decoder_not_yuv420");
    Rect area=image.getCropRect();
    need(area.width()==WIDTH&&area.height()==HEIGHT,
         "decoded_frame_not_original_4k");
    need(area.left>=0&&area.top>=0&&area.right<=image.getWidth()
         &&area.bottom<=image.getHeight(),
         "crop_rect_outside_decoded_image");
    need(x0>=0&&y0>=0&&x1>x0&&y1>y0
         &&x1<=WIDTH&&y1<=HEIGHT,"untrusted_original_ROI");
    int roiW=x1-x0,roiH=y1-y0;
    need(roiW>=64&&roiH>=120&&roiW/(double)roiH>=.20
         &&roiW/(double)roiH<=.85,
         "ROI_must_be_upright_pose_eligible");
    Image.Plane[] planes=image.getPlanes();
    need(planes!=null&&planes.length==3,"unexpected_decoder_planes");
    // Plane stride and buffer metadata are read once, NOT for every pixel.
    // U and V may have DIFFERENT row/pixel strides on some implementations.
    ByteBuffer yBuf=planes[0].getBuffer();
    ByteBuffer uBuf=planes[1].getBuffer();
    ByteBuffer vBuf=planes[2].getBuffer();
    int yRS=planes[0].getRowStride(),uRS=planes[1].getRowStride(),
        vRS=planes[2].getRowStride();
    int yPS=planes[0].getPixelStride(),uPS=planes[1].getPixelStride(),
        vPS=planes[2].getPixelStride();
    need(yPS==1&&yRS>=WIDTH&&uPS>=1&&uPS<=2&&vPS>=1&&vPS<=2
         &&uRS>0&&vRS>0,"unsupported_decoder_plane_strides");
    int yLimit=yBuf.limit(),uLimit=uBuf.limit(),vLimit=vBuf.limit();
    // No full-frame bitmap or ARGB array is constructed.
    int[] argb=new int[roiW*roiH];
    for(int y=0;y<roiH;y++) {
      int yy=y+y0+area.top;
      int outOff=y*roiW;
      int yOff=yy*yRS;
      int uOff=(yy>>1)*uRS;
      int vOff=(yy>>1)*vRS;
      for(int x=0;x<roiW;x++) {
        int xx=x+x0+area.left,uvX=xx>>1;
        int yIdx=yOff+xx;
        int uIdx=uOff+uvX*uPS;
        int vIdx=vOff+uvX*vPS;
        need(yIdx>=0&&yIdx<yLimit&&uIdx>=0&&uIdx<uLimit
             &&vIdx>=0&&vIdx<vLimit,"yuv_plane_bounds");
        int l=yBuf.get(yIdx)&255;
        int u=(uBuf.get(uIdx)&255)-128;
        int v=(vBuf.get(vIdx)&255)-128;
        int c=Math.max(0,l-16);
        int rr=clip((298*c+409*v+128)>>8);
        int gg=clip((298*c-100*u-208*v+128)>>8);
        int bb=clip((298*c+516*u+128)>>8);
        argb[outOff+x]=0xff000000|(rr<<16)|(gg<<8)|bb;
      }
    }
    return Bitmap.createBitmap(argb,roiW,roiH,Bitmap.Config.ARGB_8888);
  }
  public static Frame decodeCrop(Path original,long requestedMs,long deadlineNs,
                                 int x0,int y0,int x1,int y1)
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
      int rotation=format.containsKey(MediaFormat.KEY_ROTATION)
          ?format.getInteger(MediaFormat.KEY_ROTATION):0;
      need(rotation==0,"nonzero_video_rotation_unhandled");
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
            if(pts+ROUNDING_TOLERANCE_US>=requestUs) {
              need(pts-requestUs<=WINDOW_US,
                   "decoded_pts_too_far_from_requested_sample");
              Image decoded=decoder.getOutputImage(idx);
              need(decoded!=null,"decoded_frame_image_missing");
              try {
                Bitmap copy=yuvCrop(decoded,x0,y0,x1,y1);
                return new Frame(copy,pts,durationUs);
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
