package nl.kalenel.s9offline;
import java.util.*;
/**
 * S9+-only aligned ArcFace cosine proposal engine. Does NOT assign identity.
 * Inputs must come from the OFFLINE worker's actual 512D ONNX inference, NOT
 * colour histograms or body crops. Exports only provenance and candidate
 * scores for explicit human review; never exports biometric vectors.
 */
public final class PhoneAutomaticPersonMatcher {
  public static final int DIM=512;
  public static final float THRESHOLD=.84f;
  public static final float MARGIN=.08f;
  private PhoneAutomaticPersonMatcher() {}
  public static final class Face {
    public final String source,clip,folder,snapshotSha,modelSha;
    public final float[] vector;
    public final boolean aligned,approvedReference;
    public Face(String source,String clip,String folder,String snapshotSha,
                String modelSha,float[] vector,boolean aligned,boolean approved) {
      this.source=source;this.clip=clip;this.folder=folder;
      this.snapshotSha=snapshotSha;this.modelSha=modelSha;
      this.vector=vector==null?null:vector.clone();
      this.aligned=aligned;this.approvedReference=approved;
    }
  }
  public static final class Proposal {
    public final String clip,folder,snapshotSha,modelSha;
    public final float score,margin;
    public final int referenceCount;
    private Proposal(Face candidate,String folder,float score,float margin,int count) {
      this.clip=candidate.clip;this.folder=folder;
      this.snapshotSha=candidate.snapshotSha;this.modelSha=candidate.modelSha;
      this.score=score;this.margin=margin;this.referenceCount=count;
    }
    public final boolean humanApprovalRequired=true;
    public final boolean automaticAssignment=false;
  }
  private static boolean valid(Face face) {
    if(face==null||!face.aligned||face.vector==null||face.vector.length!=DIM
      ||face.modelSha==null||!face.modelSha.matches("[0-9a-f]{64}")
      ||face.snapshotSha==null||!face.snapshotSha.matches("[0-9a-f]{64}")
      ||face.clip==null||!face.clip.matches("motion_[0-9]{13}\\.mp4")
      ||!"sd".equals(face.source))return false;
    double norm=0;
    for(float v:face.vector){if(!Float.isFinite(v))return false;norm+=v*v;}
    return norm>1e-9;
  }
  private static float cosine(Face a,Face b) {
    double dot=0,aa=0,bb=0;
    for(int i=0;i<DIM;i++){
      dot+=(double)a.vector[i]*b.vector[i];
      aa+=(double)a.vector[i]*a.vector[i];
      bb+=(double)b.vector[i]*b.vector[i];
    }
    return (float)(dot/Math.sqrt(aa*bb));
  }
  /**
   * Need two independent human-approved reference clips in a known person
   * folder, a compatible model and positive runner-up margin. Scores are
   * cosine similarities, NOT identity probabilities.
   */
  public static List<Proposal> rank(List<Face> candidates,List<Face> refs,Set<String> alreadyFiled) {
    List<Proposal> result=new ArrayList<>();
    if(candidates==null||refs==null||alreadyFiled==null)return result;
    for(Face query:candidates){
      if(!valid(query)||query.approvedReference||alreadyFiled.contains(query.clip))continue;
      Map<String,List<Float>> byFolder=new HashMap<>();
      Map<String,Set<String>> independent=new HashMap<>();
      for(Face reference:refs){
        if(!valid(reference)||!reference.approvedReference||reference.folder==null
          ||!reference.folder.matches("[A-Za-z0-9_-]{1,100}")
          ||reference.clip.equals(query.clip)
          ||!reference.modelSha.equals(query.modelSha))continue;
        Set<String> clips=independent.computeIfAbsent(reference.folder,k->new HashSet<>());
        if(!clips.add(reference.clip))continue;
        byFolder.computeIfAbsent(reference.folder,k->new ArrayList<>()).add(cosine(query,reference));
      }
      String winner=null;float high=-2,other=-2;int support=0;
      for(Map.Entry<String,List<Float>> e:byFolder.entrySet()){
        List<Float> scores=e.getValue();
        if(scores.size()<2)continue;
        scores.sort(Collections.reverseOrder());
        // Require independent supporting matches; one outstanding image is
        // not enough to name a visitor across separate recordings.
        float value=(scores.get(0)+scores.get(1))/2f;
        if(value>high){other=high;high=value;winner=e.getKey();support=scores.size();}
        else if(value>other)other=value;
      }
      float margin=other<=-1?1f:high-other;
      if(winner!=null&&high>=THRESHOLD&&margin>=MARGIN)
        result.add(new Proposal(query,winner,high,margin,support));
    }
    result.sort((a,b)->Float.compare(b.score,a.score));
    return result;
  }
}
