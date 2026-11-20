package nl.kalenel.s9offline;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * R752: ON-PHONE ONLY research-vector integrity / metadata projection.
 *
 * Restrict input to existing research JSON sidecars. The 512 float embedding
 * components are checked for finite values and unit length ON THE S9+;
 * neither raw vectors nor any floats from them are ever emitted. No photos,
 * videos, People labels, identity mapping, or production model files are read.
 * Output is an anonymous manifest metadata projection consumed by the R749
 * host-side source/crop integrity audit; no service or schedule is installed.
 */
public final class S9ResearchVectorMetadataV752 {
  static final Path ROOT=Paths.get(
      "/data/local/tmp/s9-osnet-qualcomm-reid-shadow/vectors").toAbsolutePath();
  static final Pattern BASENAME=Pattern.compile("[a-f0-9]{64}[.]json");
  static final int VECTOR_SIZE=512;
  static final int MAX_FILES=1000;
  static final long MAX_BYTES=100_000L;
  private S9ResearchVectorMetadataV752() {}
  static void need(boolean ok,String reason){
    if(!ok)throw new IllegalArgumentException(reason);
  }
  static String hexHash(String input)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    byte[] sum=md.digest(input.getBytes(StandardCharsets.UTF_8));
    StringBuilder b=new StringBuilder(64);
    for(byte x:sum)b.append(String.format(Locale.US,"%02x",x&255));
    return b.toString();
  }
  static JSONObject project(Path path)throws Exception {
    need(path.toAbsolutePath().normalize().getParent().equals(ROOT),
         "source_outside_research_sidecar_directory");
    need(Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS),
         "sidecar_not_regular_file");
    long size=Files.size(path);
    need(size>=100 && size<=MAX_BYTES,"sidecar_size_unexpected");
    JSONObject source=new JSONObject(new String(Files.readAllBytes(path),
                                               StandardCharsets.UTF_8));
    need("S9_REAL_OSNET_MARKET1501_SHA_EXACT_PERSON_CROP_RESEARCH_ONLY_V1"
         .equals(source.getString("schema")),"source_schema_mismatch");
    JSONArray vector=source.getJSONArray("L2_normalized_embedding_phone_private");
    boolean valid=vector.length()==VECTOR_SIZE;
    double sum=0;
    if(valid){
      for(int i=0;i<VECTOR_SIZE;i++){
        double value=vector.getDouble(i);
        if(!Double.isFinite(value)){valid=false;break;}
        sum+=value*value;
      }
    }
    double norm=Math.sqrt(sum);
    valid=valid&&Double.isFinite(norm)&&Math.abs(norm-1.0)<=0.03;
    JSONObject result=new JSONObject();
    for(String key:new String[]{
        "schema","model_sha256","source_original_sha256",
        "source_crop_sha256","source_crop_bytes","source_version",
        "model_output_dimensions",
        "original_source_frame_PTS_independently_verified",
        "no_manual_label_used_during_embedding",
        "automatic_identity_folder_assignments",
        "embedding_inference_latency_ms"}) {
      need(source.has(key),"sidecar_missing_required_metadata");
      result.put(key,source.get(key));
    }
    String name=source.getString("crop_name");
    need(name.length()>0&&name.length()<256,"crop_name_length_invalid");
    result.put("crop_name_sha256",hexHash(name));
    result.put("vector_l2_norm_valid_on_s9",valid);
    result.put("vector_component_count_on_s9",vector.length());
    return result;
  }
  static JSONObject run()throws Exception {
    need(Files.isDirectory(ROOT,LinkOption.NOFOLLOW_LINKS),
         "research_vector_dir_missing");
    ArrayList<String> names=new ArrayList<>();
    try(DirectoryStream<Path> stream=Files.newDirectoryStream(ROOT)){
      for(Path entry:stream){
        String base=entry.getFileName().toString();
        need(BASENAME.matcher(base).matches(),"unexpected_research_sidecar_filename");
        need(names.size()<MAX_FILES,"too_many_sidecars");
        names.add(base);
      }
    }
    need(names.size()>0,"no_research_sidecars");
    Collections.sort(names);
    JSONArray projections=new JSONArray();
    int badNorm=0;
    for(String base:names){
      JSONObject item=project(ROOT.resolve(base));
      if(!item.getBoolean("vector_l2_norm_valid_on_s9"))badNorm++;
      projections.put(item);
    }
    return new JSONObject()
        .put("schema","s9_reid_private_vector_metadata_projection_v752")
        .put("result","PHONE_ONLY_VECTOR_INTEGRITY_INSPECTED")
        .put("sidecar_count",names.size())
        .put("sidecars_with_bad_norm_or_dimension",badNorm)
        .put("projected_sidecars",projections)
        .put("raw_vector_elements_returned",0)
        .put("images_read",0)
        .put("videos_decoded",0)
        .put("identity_labels_read",false)
        .put("automatic_people_assignments",0)
        .put("camera_configuration_changed",false);
  }
  public static void main(String[] args)throws Exception {
    need(args.length==1&&"--project-research-metadata".equals(args[0]),
         "fixed_research_directory_only");
    JSONObject receipt=run();
    System.out.println("S9_REID_R752_METADATA_PROJECTION "+receipt.toString());
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
}
