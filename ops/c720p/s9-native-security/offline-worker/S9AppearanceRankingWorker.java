package nl.kalenel.s9offline;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Standalone phone-side provisional *appearance* ranking, never identity
 * probabilities, automatic assignments or camera controls. Consumes 512-D
 * OSNet descriptors and exact per-crop 32-bin HSV color histograms.
 *
 * Current evidence lacks verified aligned ArcFace crops, so the guarded
 * 0.75 visual / 0.25 histogram fallback is the only allowed comparison.
 * When vetted aligned-face structural descriptors exist, the existing
 * PhoneOfflineSimilarity scorer supplies 0.70 structural/0.30 visual.
 */
public final class S9AppearanceRankingWorker {
  static final Path ROOT=Paths.get("/data/local/tmp/s9_worker").toAbsolutePath().normalize();
  static final Path FEATURE=ROOT.resolve("features");
  static final Pattern KEY=Pattern.compile("[a-f0-9]{64}");
  static final String VISUAL_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d";
  static final String STRUCT_SHA="4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43";

  static void expect(boolean ok,String message) {
    if(!ok)throw new IllegalArgumentException(message);
  }

  static final class Observation {
    String key;
    float[] hsv,visual,structural;
    boolean faceAligned;
    String structuralSha="";
    JSONObject evidence;
  }

  static float[] vector(JSONArray values,int size) {
    if(values==null||values.length()!=size)return null;
    float[] out=new float[size];
    for(int i=0;i<size;i++) {
      double number=values.optDouble(i,Double.NaN);
      if(!Double.isFinite(number)||Math.abs(number)>1e8)return null;
      out[i]=(float)number;
    }
    return out;
  }

  static float colorAffinity(float[] a,float[] b) {
    if(a==null||b==null||a.length!=32||b.length!=32)
      return Float.NaN;
    double ab=0,aa=0,bb=0;
    for(int i=0;i<32;i++) {
      if(!Float.isFinite(a[i])||!Float.isFinite(b[i])||
         a[i]<0||b[i]<0)return Float.NaN;
      aa+=a[i];bb+=b[i];ab+=Math.sqrt((double)a[i]*b[i]);
    }
    if(aa<=1e-10||bb<=1e-10)return Float.NaN;
    return (float)Math.min(1,Math.max(0,ab/Math.sqrt(aa*bb)));
  }

  static Observation load(JSONObject entry) throws Exception {
    String key=entry.optString("key","");
    expect(KEY.matcher(key).matches(),"Unexpected source-key format");
    Observation o=new Observation();
    o.key=key;
    o.hsv=vector(entry.optJSONArray("upper_hsv32"),32);
    Path sidecar=FEATURE.resolve(key+"-visual.json").normalize();
    expect(sidecar.startsWith(FEATURE)&&Files.isRegularFile(sidecar)
        &&!Files.isSymbolicLink(sidecar),"Missing verified visual metadata");
    JSONObject v=new JSONObject(new String(Files.readAllBytes(sidecar),
                                               StandardCharsets.UTF_8));
    expect(key.equals(v.optString("source_qualified_key"))&&
           VISUAL_SHA.equals(v.optString("model_sha256")),
           "Visual feature provenance invalid");
    o.visual=vector(v.optJSONArray("visual_embedding"),512);
    expect(o.visual!=null,"Malformed 512-D OSNet visual descriptor");
    // Structural requires a separately verified aligned face *and* pinned
    // ArcFace model; never infer alignment merely from upper-body color crop.
    if(entry.optBoolean("aligned_face_verified",false)) {
      Path face=FEATURE.resolve(key+"-structural.json").normalize();
      if(Files.isRegularFile(face)&&!Files.isSymbolicLink(face)) {
        JSONObject f=new JSONObject(new String(Files.readAllBytes(face),
                                                 StandardCharsets.UTF_8));
        if(key.equals(f.optString("source_qualified_key"))&&
           STRUCT_SHA.equals(f.optString("model_sha256"))) {
          o.structural=vector(f.optJSONArray("structural_crop_embedding"),512);
          o.faceAligned=o.structural!=null;
          o.structuralSha=o.faceAligned?STRUCT_SHA:"";
        }
      }
    }
    return o;
  }

  static JSONArray suggestions(Observation a,ArrayList<Observation> all)
      throws Exception {
    ArrayList<JSONObject> scores=new ArrayList<>();
    for(Observation b:all) {
      if(a==b)continue;
      float color=colorAffinity(a.hsv,b.hsv);
      Float colorScore=Float.isFinite(color)?color:null;
      PhoneOfflineSimilarity.Evidence av=new PhoneOfflineSimilarity.Evidence(
        a.visual,a.structural,VISUAL_SHA,a.structuralSha,a.faceAligned);
      PhoneOfflineSimilarity.Evidence bv=new PhoneOfflineSimilarity.Evidence(
        b.visual,b.structural,VISUAL_SHA,b.structuralSha,b.faceAligned);
      PhoneOfflineSimilarity.Result s=PhoneOfflineSimilarity.compare(av,bv,colorScore);
      if(s==null)continue;
      JSONObject row=new JSONObject();
      row.put("candidate_key",b.key);
      row.put("appearance_similarity_percent",Math.round(s.displayPercent*100)/100.0);
      row.put("raw_cosine_weighted",s.cosineScore);
      row.put("method",s.method);
      row.put("human_review_required",true);
      row.put("verified_same_person",false);
      scores.add(row);
    }
    Collections.sort(scores,new Comparator<JSONObject>() {
      public int compare(JSONObject x,JSONObject y) {
        int c=Double.compare(y.optDouble("raw_cosine_weighted"),
                             x.optDouble("raw_cosine_weighted"));
        return c!=0?c:x.optString("candidate_key")
                        .compareTo(y.optString("candidate_key"));
      }
    });
    JSONArray result=new JSONArray();
    for(int i=0;i<Math.min(5,scores.size());i++)result.put(scores.get(i));
    return result;
  }

  static void run(Path input,Path output) throws Exception {
    expect(input.toAbsolutePath().normalize().equals(ROOT.resolve("rank-input-v1.jsonl")),
           "Only prepared private ranking input is accepted");
    expect(output.toAbsolutePath().normalize().equals(ROOT.resolve("rankings-v1.json")),
           "Only private versioned rankings output is accepted");
    expect(!Files.exists(output),"Never overwrite existing ranked evidence");
    expect(Files.isRegularFile(input)&&!Files.isSymbolicLink(input)&&
           Files.size(input)<400_000,"Unsafe ranking-input size");
    ArrayList<Observation> rows=new ArrayList<>();
    Set<String> seen=new HashSet<>();
    for(String line:Files.readAllLines(input,StandardCharsets.UTF_8)) {
      if(line.trim().isEmpty())continue;
      Observation o=load(new JSONObject(line));
      expect(seen.add(o.key),"Duplicate source-qualified crop entry");
      rows.add(o);
    }
    expect(rows.size()>=2&&rows.size()<=200,"Unsupported ranking corpus size");
    JSONObject doc=new JSONObject();
    doc.put("schema","s9_appearance_rankings_v1");
    doc.put("count",rows.size());
    doc.put("method","conditional_70structural_30visual_else_75visual_25hsv");
    doc.put("identity_probabilities",false);
    doc.put("automatically_assigned_people",0);
    JSONArray rankings=new JSONArray();
    int total=0;
    for(Observation a:rows) {
      JSONObject row=new JSONObject();
      row.put("reference_key",a.key);
      JSONArray matches=suggestions(a,rows);
      row.put("similar_appearance_only",matches);
      total+=matches.length();
      rankings.put(row);
    }
    doc.put("rankings",rankings);
    Path pending=Files.createTempFile(ROOT,".rankings-",".json");
    try {
      Files.write(pending,doc.toString().getBytes(StandardCharsets.UTF_8));
      Files.move(pending,output,StandardCopyOption.ATOMIC_MOVE);
    }finally {
      Files.deleteIfExists(pending);
    }
    System.out.println("S9_APPEARANCE_RANKINGS_ON_PHONE_VERIFIED "+
                       "references="+rows.size()+" candidate_links="+total+
                       " human_review=true identity_probability=false");
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }

  public static void main(String[] args) throws Exception {
    expect(args.length==2,"Expected private input/output files");
    run(Paths.get(args[0]),Paths.get(args[1]));
  }
}
