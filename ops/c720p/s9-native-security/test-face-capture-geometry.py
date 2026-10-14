#!/usr/bin/env python3
"""Execute face-crop geometry in Java without Android, models or camera media."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'src/nl/kalenel/s9security/S9FaceGeometry.java'
HARNESS=r'''
package nl.kalenel.s9security;
import java.util.*;
public final class FaceGeometryCheck {
 static void check(boolean condition,String label){if(!condition)throw new AssertionError(label);}
 public static void main(String[] args){
  List<float[]> boxes=new ArrayList<>();
  boxes.add(new float[]{.1f,.2f,.9f,.4f});
  boxes.add(new float[]{.1f,.2f,.9f,.4f});
  boxes.add(new float[]{Float.NaN,.1f,.2f,.2f});
  boxes.add(new float[]{.7f,.8f,1.2f,1.1f});
  List<S9FaceGeometry.Region> regions=S9FaceGeometry.headRegions(3840,2160,boxes,4);
  check(regions.size()==2,"duplicate and invalid person proposals excluded");
  check(regions.get(0).proposal==0&&regions.get(1).proposal==3,"input proposal provenance retained");
  for(S9FaceGeometry.Region r:regions){
   check(r.left>=0&&r.right<=3840&&r.top>=0&&r.bottom<=2160,"person ROI is clamped");
   int[] d=S9FaceGeometry.detectorSize(r,1024,786432);
   check(d!=null&&d[0]%2==0,"FaceDetector input width is even");
   check(Math.max(d[0],d[1])<=1024&&d[0]*d[1]<=786432,"bounded detector allocation");
   check(d[0]<=r.width()&&d[1]<=r.height(),"never upscale native pixels for quality");
  }
  check(S9FaceGeometry.headRegions(3840,2160,boxes,1).size()==1,"bounded number of person scans");
  check(S9FaceGeometry.headRegions(3840,2160,Collections.<float[]>emptyList(),4).isEmpty(),"fallback accepts no person proposals");
  check(S9FaceGeometry.normalizedBox(new float[]{.5f,.4f,.4f,.6f})==null,"inverted rectangle rejected");
  check(S9FaceGeometry.normalizedBox(new float[]{0,0,Float.POSITIVE_INFINITY,1})==null,"nonfinite rectangle rejected");
  S9FaceGeometry.Region edge=S9FaceGeometry.faceCrop(3840,2160,3835,2155,30,32);
  check(edge!=null&&edge.width()==105&&edge.height()==105,"edge crop preserves original face size");
  check(edge.right==3840&&edge.bottom==2160,"edge crop shifts fully inside original frame");
  check(S9FaceGeometry.faceCrop(3840,2160,100,100,8,32)==null,"tiny detections cannot become evidence");
  check(S9FaceGeometry.faceCrop(3840,2160,Double.NaN,100,30,32)==null,"nonfinite face midpoint rejected");
  check(S9FaceGeometry.faceCrop(3840,2160,-1,100,30,32)==null,"out of frame midpoint rejected");
  S9FaceGeometry.Region a=S9FaceGeometry.faceCrop(3840,2160,400,400,30,32);
  S9FaceGeometry.Region b=S9FaceGeometry.faceCrop(3840,2160,410,402,31,32);
  S9FaceGeometry.Region other=S9FaceGeometry.faceCrop(3840,2160,550,400,30,32);
  check(S9FaceGeometry.sameFace(a,b),"ROI and scene duplicate face merged");
  check(!S9FaceGeometry.sameFace(a,other),"nearby distinct faces retained");
  check(S9FaceGeometry.recognitionGeometry(.65f,24,20,17),"recognition boundary accepted");
  check(!S9FaceGeometry.recognitionGeometry(.64f,24,0,0),"weak detector remains evidence only");
  check(!S9FaceGeometry.recognitionGeometry(.9f,23.9,0,0),"small native eyes remain evidence only");
  check(!S9FaceGeometry.recognitionGeometry(.9f,40,21,0),"yaw limits identity comparison");
  check(!S9FaceGeometry.recognitionGeometry(.9f,40,0,18),"roll limits identity comparison");
  check(!S9FaceGeometry.recognitionGeometry(.9f,40,Float.NaN,0),"unknown pose cannot pass recognition");
  List<float[]> owners=Arrays.asList(new float[]{.1f,.1f,.8f,.4f},new float[]{.1f,.6f,.8f,.9f});
  check(S9FaceGeometry.owner(200,200,1000,1000,owners)==0,"first person's face owner");
  check(S9FaceGeometry.owner(700,200,1000,1000,owners)==1,"second person's face owner");
  check(S9FaceGeometry.owner(500,200,1000,1000,owners)==-1,"no person owner is preserved");
  List<float[]> overlap=Arrays.asList(new float[]{.1f,.1f,.8f,.4f},new float[]{.1f,.15f,.8f,.45f});
  check(S9FaceGeometry.owner(200,200,1000,1000,overlap)==-1,"overlapping people never receive a guessed owner");
  float[] normalized=S9FaceGeometry.box(edge,3840,2160);
  check(normalized[2]==1&&normalized[3]==1&&normalized[0]>=0&&normalized[1]>=0,"crop provenance uses source coordinates");
  System.out.println("FACE_GEOMETRY_CHECKS_PASSED=27");
 }
}
'''

class FaceCaptureGeometryTests(unittest.TestCase):
 def test_executable_geometry(self):
  javac=shutil.which('javac');java=shutil.which('java')
  if not javac or not java:self.skipTest('Java compiler/runtime required; run on C720P build host')
  with tempfile.TemporaryDirectory(prefix='s9-face-geometry-') as temp:
   root=Path(temp);harness=root/'FaceGeometryCheck.java';harness.write_text(HARNESS)
   result=subprocess.run([javac,'-source','8','-target','8','-d',str(root),str(SOURCE),str(harness)],
      capture_output=True,text=True,timeout=30)
   self.assertEqual(result.returncode,0,result.stderr)
   result=subprocess.run([java,'-cp',str(root),'nl.kalenel.s9security.FaceGeometryCheck'],
      capture_output=True,text=True,timeout=20)
   self.assertEqual(result.returncode,0,result.stderr)
   self.assertIn('FACE_GEOMETRY_CHECKS_PASSED=27',result.stdout)

 def test_evidence_and_identity_contracts_are_separate(self):
  face=(ROOT/'src/nl/kalenel/s9security/S9FaceReview.java').read_text()
  self.assertIn('VERSION="s9_face_review_v1"',face)
  self.assertIn('void sample(Bitmap frame,long ms,List<float[]> personBoxes)',face)
  self.assertIn('MAX_PERSON_REGIONS=4',face)
  self.assertIn('MAX_DETECTOR_PIXELS=786432',face)
  self.assertIn('if(recognitionQuality){',face)
  self.assertIn('not_comparable_face_quality',face)
  self.assertIn('quality.evidence()',face)
  self.assertIn('Bitmap.createBitmap(frame,bounds.left,bounds.top,bounds.width(),bounds.height())',face)
  self.assertIn('if(owner>=0)',face)
  self.assertIn('face_index_epoch',face)
  self.assertIn('hash((sha+":"+indexEpoch).getBytes("UTF-8"))',face)
  self.assertIn('if(legacyEpoch)writeIndex()',face)
  self.assertIn('if(!file.exists()){writeIndex();return;}',face)
  self.assertNotIn('put("embedding"',face[face.index('private static final class FaceHit'):])

if __name__=='__main__':unittest.main(verbosity=2)
