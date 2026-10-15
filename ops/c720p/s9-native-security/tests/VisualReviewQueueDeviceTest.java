package nl.kalenel.s9security;
import java.io.*;
import org.json.*;
public final class VisualReviewQueueDeviceTest {
 private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 private static void write(File file,JSONObject value)throws Exception{try(FileOutputStream out=new FileOutputStream(file)){out.write(value.toString().getBytes("UTF-8"));}}
 public static void main(String[] args)throws Exception{
  File directory=new File("/data/local/tmp/s9-review-queue-test-"+System.currentTimeMillis());
  if(!directory.mkdir())throw new IOException("isolated_test_directory_unavailable");
  try{
   File clip=new File(directory,"motion_1791980201225.mp4"),queue=new File(directory,"visual-review-queue-v37.json");
   try(FileOutputStream out=new FileOutputStream(clip)){out.write(new byte[256]);}
   check(!VisualReviewQueue.permits(clip),"missing queue fails closed");
   JSONObject item=new JSONObject().put("name",clip.getName()).put("bytes",256).put("human_verified",true);
   JSONObject data=new JSONObject().put("version",VisualReviewQueue.VERSION).put("issued_ms",System.currentTimeMillis()).put("clips",new JSONArray().put(item));
   write(queue,data);check(VisualReviewQueue.permits(clip),"current verified file permitted");
   check(VisualReviewQueue.clips(directory).length==1,"one permitted clip");
   item.put("bytes",257);write(queue,data);check(!VisualReviewQueue.permits(clip),"changed file size denied");
   item.put("bytes",256).put("human_verified",false);write(queue,data);check(!VisualReviewQueue.permits(clip),"unconfirmed file denied");
   item.put("human_verified",true);data.put("issued_ms",System.currentTimeMillis()-601000);write(queue,data);check(!VisualReviewQueue.permits(clip),"stale authorization denied");
   data.put("issued_ms",System.currentTimeMillis()+120000);write(queue,data);check(!VisualReviewQueue.permits(clip),"future authorization denied");
   data.put("issued_ms",System.currentTimeMillis());item.put("name","../"+clip.getName());write(queue,data);check(VisualReviewQueue.clips(directory).length==0,"path traversal denied");
   item.put("name",clip.getName());data.put("clips",new JSONArray().put(item).put(item));write(queue,data);check(VisualReviewQueue.clips(directory).length==1,"duplicate queue references deduplicated");
   File sidecar=new File(directory,clip.getName()+".visual-v36.json");
   write(sidecar,new JSONObject().put("bytes",256).put("sampling_version","old"));check(!VisualReviewQueue.completed(clip),"old analysis requires new review");
   write(sidecar,new JSONObject().put("bytes",256).put("sampling_version",ClipReviewSchedule.VERSION));check(VisualReviewQueue.completed(clip),"current analysis retained");
   System.out.println("VISUAL_QUEUE_V37_DEVICE_10_CHECKS_PASS");
  }finally{
   for(File file:directory.listFiles())if(file.isFile()&&file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()))file.delete();
   directory.delete();
  }
 }
}
