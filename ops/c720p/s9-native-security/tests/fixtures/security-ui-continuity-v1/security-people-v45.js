// Minimal deployed regression fixture; no recorded media or real person data.
function renderFolder(){
 const facePanel=$('folderFaces'),faceGrid=$('folderFaceGrid');faceGrid.replaceChildren();
 const clips=folderApprovedSDClips(state.folder);
 const faceMatches=state.faceList.filter(x=>{
  if(!clips.has(x.clip)||!faceName.test(String(x.face?.snapshot_name||''))||
     x.face?.snapshot_on_s9===false)return false;
  const digest=String(x.face.snapshot_sha256||x.face.snapshot_name);
  if(uniqueFaceCrops.has(digest))return false;
  uniqueFaceCrops.add(digest);return true;
 }).slice(0,48);
 facePanel.hidden=state.tab!=='approved'||faceMatches.length===0;
}
function facesInRecording(clip){return [];}
