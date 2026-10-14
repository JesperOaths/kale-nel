package nl.kalenel.s9security;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Bitmap;
import android.graphics.Color;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * S9+ microSD-only, non-biometric HSV appearance search.
 *
 * Samples clothing (excluding the head) and detected vehicles during the
 * existing serialized post-4K review. No recognition, face, gait, tracking
 * across recordings, additional camera session, or network access.
 * Database is derived data: recordings and verified manifests remain canonical.
 */
final class AppearanceSearchIndex implements AutoCloseable {
 static final String VERSION="s9_hsv_histogram_index_v1";
 private static final int H=18,S=8,V=8,SIZE=H*S*V;
 private static final int MAX_SEARCH_ROWS=4000,MAX_RESULTS=50;
 private final SQLiteDatabase db;

 static final class Observation {
  final String category,zone;
  final long offsetMs;
  final float[] hist;
  final int hBin,sBin,vBin,rBin,gBin,bBin;
  Observation(String category,String zone,long offsetMs,float[] hist,
              int hBin,int sBin,int vBin,int rBin,int gBin,int bBin){
   this.category=category;this.zone=zone;this.offsetMs=offsetMs;this.hist=hist;
   this.hBin=hBin;this.sBin=sBin;this.vBin=vBin;
   this.rBin=rBin;this.gBin=gBin;this.bBin=bBin;
  }
 }

 AppearanceSearchIndex(File archive){
  if(archive==null||!archive.isDirectory())throw new IllegalArgumentException("invalid_archive");
  db=SQLiteDatabase.openOrCreateDatabase(new File(archive,"appearance-hsv-v1.sqlite"),null);
  db.execSQL("CREATE TABLE IF NOT EXISTS clips ("+
    "clip_name TEXT PRIMARY KEY, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,"+
    "scene TEXT NOT NULL)");
  db.execSQL("CREATE TABLE IF NOT EXISTS observations ("+
    "clip_name TEXT NOT NULL, sample_no INTEGER NOT NULL, offset_ms INTEGER NOT NULL,"+
    "category TEXT NOT NULL, zone TEXT NOT NULL,"+
    "h_bin INTEGER NOT NULL, s_bin INTEGER NOT NULL, v_bin INTEGER NOT NULL,"+
    "r_bin INTEGER NOT NULL, g_bin INTEGER NOT NULL, b_bin INTEGER NOT NULL,"+
    "histogram BLOB NOT NULL, PRIMARY KEY (clip_name,sample_no))");
  db.execSQL("CREATE INDEX IF NOT EXISTS appearance_lookup ON observations(category,zone,clip_name)");
  db.execSQL("CREATE INDEX IF NOT EXISTS appearance_clip_time ON clips(start_ms,end_ms)");
 }

 private static int clamp(int n,int maximum){return Math.max(0,Math.min(maximum-1,n));}
 private static boolean categoryAllowed(String category){
  return "upper_clothing".equals(category)||"lower_clothing".equals(category)||
         "vehicle".equals(category);
 }
 private static boolean zoneAllowed(String zone){
  return "front_garden".equals(zone)||"background_street".equals(zone)||
         "unspecified".equals(zone);
 }
 private static long clipTimestamp(String name){
  if(name==null||!name.matches("motion_[0-9]{13}\\.mp4"))return -1;
  try{return Long.parseLong(name.substring(7,20));}
  catch(NumberFormatException ignored){return -1;}
 }

 /** Explicitly bounded pixel samples; no face, shape, gait, or identity features. */
 static Observation sample(Bitmap image,float[] box,long offsetMs,
                           String category,String zone){
  if(image==null||box==null||box.length!=4||!categoryAllowed(category)||
     !zoneAllowed(zone)||offsetMs<0)return null;
  for(float n:box)if(!Float.isFinite(n)||n<0f||n>1f)return null;
  final float top=box[0],left=box[1],bottom=box[2],right=box[3];
  if(bottom-top<.06f||right-left<.05f)return null;
  float xa=.08f,xb=.92f,ya=.12f,yb=.88f;
  if("upper_clothing".equals(category)){xa=.23f;xb=.77f;ya=.23f;yb=.49f;}
  if("lower_clothing".equals(category)){xa=.23f;xb=.77f;ya=.62f;yb=.87f;}
  int x0=(int)((left+(right-left)*xa)*image.getWidth());
  int x1=(int)((left+(right-left)*xb)*image.getWidth());
  int y0=(int)((top+(bottom-top)*ya)*image.getHeight());
  int y1=(int)((top+(bottom-top)*yb)*image.getHeight());
  return extract(image,x0,y0,x1,y1,category,zone,offsetMs);
 }

 /** Reference crop is already a selected region; sample its entire interior. */
 static Observation reference(Bitmap crop,String category){
  if(crop==null||!categoryAllowed(category))return null;
  return extract(crop,0,0,crop.getWidth(),crop.getHeight(),
                 category,"unspecified",0);
 }

 private static Observation extract(Bitmap image,int x0,int y0,int x1,int y1,
                                    String category,String zone,long offsetMs){
  int w=image.getWidth(),h=image.getHeight();
  x0=clamp(x0,w);x1=Math.max(x0+1,Math.min(w,x1));
  y0=clamp(y0,h);y1=Math.max(y0+1,Math.min(h,y1));
  if(x1-x0<8||y1-y0<8)return null;
  float[] hist=new float[SIZE],hsv=new float[3];
  int[] reds=new int[8],greens=new int[8],blues=new int[8];
  final int nx=24,ny=24;
  double sumV=0;
  for(int j=0;j<ny;j++)for(int i=0;i<nx;i++){
   int x=clamp(x0+(int)((i+.5)*(x1-x0)/nx),w);
   int y=clamp(y0+(int)((j+.5)*(y1-y0)/ny),h);
   int rgb=image.getPixel(x,y);
   int r=Color.red(rgb),g=Color.green(rgb),b=Color.blue(rgb);
   reds[r>>5]++;greens[g>>5]++;blues[b>>5]++;
   Color.RGBToHSV(r,g,b,hsv);
   int hh=Math.min(H-1,(int)(hsv[0]*H/360f));
   int ss=Math.min(S-1,(int)(hsv[1]*S));
   int vv=Math.min(V-1,(int)(hsv[2]*V));
   hist[(hh*S+ss)*V+vv]++;
   sumV+=hsv[2];
  }
  // Keep underexposed or saturated-out crops out of colour search.
  double brightness=sumV/(nx*ny);
  if(brightness<.065||brightness>.985)return null;
  int dominant=0;
  for(int i=1;i<SIZE;i++)if(hist[i]>hist[dominant])dominant=i;
  for(int i=0;i<SIZE;i++)hist[i]/=(nx*ny);
  return new Observation(category,zone,offsetMs,hist,
    dominant/(S*V),(dominant/V)%S,dominant%V,
    maxBin(reds),maxBin(greens),maxBin(blues));
 }
 private static int maxBin(int[] bins){
  int best=0;
  for(int i=1;i<bins.length;i++)if(bins[i]>bins[best])best=i;
  return best;
 }
 private static byte[] pack(float[] hist){
  ByteBuffer out=ByteBuffer.allocate(SIZE*4).order(ByteOrder.LITTLE_ENDIAN);
  for(float value:hist)out.putFloat(value);
  return out.array();
 }
 private static float[] unpack(byte[] bytes){
  if(bytes==null||bytes.length!=SIZE*4)return null;
  float[] result=new float[SIZE];
  ByteBuffer input=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
  double total=0;
  for(int i=0;i<SIZE;i++){
   result[i]=input.getFloat();
   if(!Float.isFinite(result[i])||result[i]<0f)return null;
   total+=result[i];
  }
  return Math.abs(total-1.0)<.01?result:null;
 }

 /** A manifest alone is not proof of an indexed clip after SD/database loss. */
 boolean hasClip(String name){
  if(clipTimestamp(name)<0)return false;
  try(Cursor row=db.rawQuery("SELECT 1 FROM clips WHERE clip_name=? LIMIT 1",
                             new String[]{name})){
   return row.moveToFirst();
  }
 }

 /** Inserts are idempotent and transactional; only finalized MP4 names allowed. */
 void indexClip(String clipName,long durationMs,String scene,List<Observation> samples){
  long start=clipTimestamp(clipName);
  if(start<0||durationMs<0||samples==null||samples.size()>128)
   throw new IllegalArgumentException("bad_clip_or_samples");
  db.beginTransaction();
  try{
   ContentValues clip=new ContentValues();
   clip.put("clip_name",clipName);clip.put("start_ms",start);
   clip.put("end_ms",start+durationMs);clip.put("scene",scene==null?"unknown":scene);
   db.insertWithOnConflict("clips",null,clip,SQLiteDatabase.CONFLICT_REPLACE);
   db.delete("observations","clip_name=?",new String[]{clipName});
   int n=0;
   for(Observation sample:samples){
    if(sample==null)continue;
    ContentValues row=new ContentValues();
    row.put("clip_name",clipName);row.put("sample_no",n++);
    row.put("offset_ms",sample.offsetMs);row.put("category",sample.category);
    row.put("zone",sample.zone);row.put("h_bin",sample.hBin);
    row.put("s_bin",sample.sBin);row.put("v_bin",sample.vBin);
    row.put("r_bin",sample.rBin);row.put("g_bin",sample.gBin);
    row.put("b_bin",sample.bBin);row.put("histogram",pack(sample.hist));
    db.insertOrThrow("observations",null,row);
   }
   db.setTransactionSuccessful();
  }finally{db.endTransaction();}
 }

 /** OpenCV-equivalent normalized Bhattacharyya distance, expressed as similarity. */
 static double similarity(float[] first,float[] second,String method){
  if(first==null||second==null||first.length!=SIZE||second.length!=SIZE)
   return Double.NaN;
  if("bhattacharyya".equals(method)){
   double overlap=0;
   for(int i=0;i<SIZE;i++)overlap+=Math.sqrt(first[i]*second[i]);
   return 1.0-Math.sqrt(Math.max(0.0,1.0-Math.min(1.0,overlap)));
  }
  if("correlation".equals(method)){
   double x=0,y=0,xy=0,xx=0,yy=0;
   for(int i=0;i<SIZE;i++){
    x+=first[i];y+=second[i];xy+=first[i]*second[i];
    xx+=first[i]*first[i];yy+=second[i]*second[i];
   }
   double numerator=SIZE*xy-x*y;
   double denominator=Math.sqrt(Math.max(0,(SIZE*xx-x*x)*(SIZE*yy-y*y)));
   return denominator<=0?Double.NaN:
     Math.max(0,Math.min(1,(numerator/denominator+1)/2));
  }
  throw new IllegalArgumentException("unsupported_metric");
 }

 /**
  * Score *visual colour evidence only*. At most 4k latest observations are
  * considered so camera review remains bounded; use time/zone filters to narrow.
  * Query should be invoked on an idle/background worker, never Camera2 callbacks.
  */
 JSONArray search(Bitmap referenceCrop,String category,String zone,
                  Long fromMs,Long untilMs,String method,int maxResults)throws Exception{
  if(!categoryAllowed(category)|| (zone!=null&&!zoneAllowed(zone))||
     (!"bhattacharyya".equals(method)&&!"correlation".equals(method)))
   throw new IllegalArgumentException("bad_search_filter");
  Observation reference=reference(referenceCrop,category);
  if(reference==null)return new JSONArray();
  return searchHistogram(reference.hist,category,zone,fromMs,untilMs,method,maxResults);
 }

 /** Use an indexed recording as a reference without decoding new video. */
 JSONArray searchByClip(String referenceClip,String category,String zone,
                        Long fromMs,Long untilMs,String method,int maxResults)throws Exception{
  if(clipTimestamp(referenceClip)<0||!categoryAllowed(category))
   throw new IllegalArgumentException("bad_reference_clip");
  float[] reference=null;
  try(Cursor row=db.rawQuery("SELECT histogram FROM observations WHERE clip_name=? "+
    "AND category=? ORDER BY offset_ms ASC LIMIT 1",
    new String[]{referenceClip,category})){
   if(row.moveToFirst())reference=unpack(row.getBlob(0));
  }
  if(reference==null)return new JSONArray();
  return searchHistogram(reference,category,zone,fromMs,untilMs,method,maxResults);
 }

 private JSONArray searchHistogram(float[] referenceHistogram,String category,String zone,
                                   Long fromMs,Long untilMs,String method,
                                   int maxResults)throws Exception{
  if(!categoryAllowed(category)||(zone!=null&&!zoneAllowed(zone))||
     (!"bhattacharyya".equals(method)&&!"correlation".equals(method)))
   throw new IllegalArgumentException("bad_search_filter");
  if(fromMs!=null&&untilMs!=null&&fromMs>untilMs)
   throw new IllegalArgumentException("inverted_interval");
  JSONArray response=new JSONArray();
  StringBuilder sql=new StringBuilder("SELECT c.clip_name,c.start_ms,c.end_ms,"+
    "c.scene,o.offset_ms,o.zone,o.histogram FROM observations o "+
    "JOIN clips c ON c.clip_name=o.clip_name WHERE o.category=?");
  ArrayList<String> params=new ArrayList<>();
  params.add(category);
  if(zone!=null){sql.append(" AND o.zone=?");params.add(zone);}
  if(fromMs!=null){sql.append(" AND c.end_ms>=?");params.add(Long.toString(fromMs));}
  if(untilMs!=null){sql.append(" AND c.start_ms<=?");params.add(Long.toString(untilMs));}
  sql.append(" ORDER BY c.start_ms DESC LIMIT ").append(MAX_SEARCH_ROWS);
  Map<String,JSONObject> best=new HashMap<>();
  try(Cursor rows=db.rawQuery(sql.toString(),params.toArray(new String[0]))){
   while(rows.moveToNext()){
    float[] other=unpack(rows.getBlob(6));
    if(other==null)continue;
    double score=similarity(referenceHistogram,other,method);
    if(!Double.isFinite(score))continue;
    String name=rows.getString(0);
    JSONObject old=best.get(name);
    if(old!=null&&old.optDouble("similarity",0)>=score)continue;
    JSONObject match=new JSONObject();
    match.put("clip_name",name);
    match.put("start_ms",rows.getLong(1));match.put("end_ms",rows.getLong(2));
    match.put("scene",rows.getString(3));match.put("offset_ms",rows.getLong(4));
    match.put("zone",rows.getString(5));
    match.put("similarity",Math.round(score*10000)/10000.0);
    match.put("metric",method);match.put("appearance_only",true);
    match.put("verified_same_person",false);match.put("index_version",VERSION);
    best.put(name,match);
   }
  }
  ArrayList<JSONObject> ordered=new ArrayList<>(best.values());
  Collections.sort(ordered,new Comparator<JSONObject>(){
   public int compare(JSONObject a,JSONObject b){
    int value=Double.compare(b.optDouble("similarity"),a.optDouble("similarity"));
    if(value!=0)return value;
    return a.optString("clip_name").compareTo(b.optString("clip_name"));
   }
  });
  for(int i=0;i<Math.min(Math.min(MAX_RESULTS,Math.max(0,maxResults)),ordered.size());i++)
   response.put(ordered.get(i));
  return response;
 }

 @Override public void close(){db.close();}
}
