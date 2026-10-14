package nl.kalenel.s9security;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Pure-Java, bounded ring for compressed NATIVE 1920x1080 AVC frames.
 * Hardware MediaCodec owns the encoder; this class only retains encoded
 * access units in RAM. It does not create files before an event.
 *
 * Immutable samples and monotonic PTS let a single MediaMuxer consume the
 * 7-second historical prefix and then continue with live packets from the
 * SAME encoder, without a resolution conversion or reconfiguration gap.
 *
 * No Android dependency: deterministic JVM tests cover boundary behavior.
 */
public final class Encoded4KRing {
 public static final int WIDTH=1920, HEIGHT=1080, FPS=30, BITRATE=8000000;
 public static final long HISTORY_US=9000000L;
 public static final long TARGET_US=7000000L;
 public static final long MIN_VALID_US=5500000L;
 public static final int MAX_BYTES=32*1024*1024;
 private static final int MAX_FRAMES=390;

 public static final class Sample {
  public final byte[] data;
  public final long ptsUs;
  public final int flags;
  public final boolean key;
  Sample(byte[] bytes,long ptsUs,int flags,boolean key) {
   this.data=Arrays.copyOf(bytes,bytes.length);
   this.ptsUs=ptsUs;
   this.flags=flags;
   this.key=key;
  }
  public int size(){return data.length;}
 }
 public static final class Frozen {
  public final List<Sample> samples;
  public final long firstPtsUs;
  public final long lastPtsUs;
  public final long durationUs;
  Frozen(List<Sample> s){
   samples=Collections.unmodifiableList(s);
   firstPtsUs=s.get(0).ptsUs;
   lastPtsUs=s.get(s.size()-1).ptsUs;
   durationUs=lastPtsUs-firstPtsUs;
  }
 }
 private final ArrayDeque<Sample> ring=new ArrayDeque<>();
 private int bytes;
 private long lastSeenUs=-1;
 private long drops;

 public synchronized boolean offer(byte[] encoded,long ptsUs,int flags,boolean key) {
  if(encoded==null||encoded.length==0||encoded.length>MAX_BYTES||
     ptsUs<0||ptsUs<=lastSeenUs){drops++;return false;}
  Sample sample=new Sample(encoded,ptsUs,flags,key);
  lastSeenUs=ptsUs;
  ring.addLast(sample);
  bytes+=sample.size();
  long earliest=ptsUs-HISTORY_US;
  while(!ring.isEmpty()&&(ring.peekFirst().ptsUs<earliest||
        bytes>MAX_BYTES||ring.size()>MAX_FRAMES)){
   bytes-=ring.removeFirst().size();
  }
  return true;
 }
 /** Must return NULL, never a misleading 1-second pre-event clip. */
 public synchronized Frozen freeze(){
  if(ring.size()<6)return null;
  List<Sample> a=new ArrayList<>(ring);
  long latest=a.get(a.size()-1).ptsUs;
  long cutoff=latest-TARGET_US;
  int chosen=-1;
  // The preceding IDR preserves the requested historical time window.
  for(int i=0;i<a.size();i++)
   if(a.get(i).key && a.get(i).ptsUs<=cutoff)chosen=i;
  if(chosen<0){
   // Cold start or pressure trim: earliest independently decodable IDR.
   for(int i=0;i<a.size();i++)
    if(a.get(i).key){chosen=i;break;}
  }
  if(chosen<0||a.size()-chosen<6)return null;
  List<Sample> selected=new ArrayList<>(a.subList(chosen,a.size()));
  long duration=selected.get(selected.size()-1).ptsUs-selected.get(0).ptsUs;
  return duration>=MIN_VALID_US?new Frozen(selected):null;
 }
 public synchronized long bufferedUs(){
  return ring.size()>1?ring.peekLast().ptsUs-ring.peekFirst().ptsUs:0;
 }
 public synchronized int frames(){return ring.size();}
 public synchronized int bytes(){return bytes;}
 public synchronized long rejectedSamples(){return drops;}
 public synchronized void clear(){ring.clear();bytes=0;lastSeenUs=-1;}
}
