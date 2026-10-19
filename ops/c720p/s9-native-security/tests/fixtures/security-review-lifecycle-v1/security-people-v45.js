/* Offline function fixture: reviewed static assignment and appearance logic.
   Synthetic state and relay responses are supplied only by the test harness. */
function assignmentKey(item){return (item.source==='drive'?'drive':'sd')+':'+String(item.name||item.clip||'')}
function assignedFolders(item){
 const key=assignmentKey(item),explicit=state.extraLinks?.items?.[key];
 if(explicit&&(Object.prototype.hasOwnProperty.call(explicit,'folders')||
    Object.prototype.hasOwnProperty.call(explicit,'folder'))){
  return Array.isArray(explicit.folders)?explicit.folders.filter(x=>typeof x==='string'&&x):
    explicit.folder?[explicit.folder]:[];
 }
 const old=state.legacyAssigned.get(key);
 return old?[old]:[];
}
function assignedFolder(item){return assignedFolders(item)[0]||null}
function reviewDecision(item){
 const explicit=state.extraLinks?.items?.[assignmentKey(item)];
 if(explicit)return explicit.review_status|| (explicit.folder?'assigned':'inbox');
 return state.legacySkipped.get(assignmentKey(item))?.decision||'inbox';
}
function unassignedArchiveRows(){return state.archiveEntries.filter(item=>
 !assignedFolder(item)&&!['skipped','rejected'].includes(reviewDecision(item)))}
function reviewQueueRows(){
 const archived=['skipped','rejected'].includes(state.tab);
 const rows=state.tab==='all'||archived?state.archiveEntries:[
  ...(state.doc?.items||[]).map(item=>({...item,source:'sd',name:item.clip})),
  ...state.archiveEntries.filter(item=>item.source==='drive'||
   (state.extraLinks?.items?.[assignmentKey(item)]&&!assignedFolder(item)&&reviewDecision(item)==='inbox'))];
 return [...new Map(rows.map(item=>[assignmentKey(item),item])).values()].filter(item=>!assignedFolder(item)&&
  (archived?reviewDecision(item)===state.tab:
   !['skipped','rejected'].includes(reviewDecision(item)))&&
  (state.reviewSource==='all'||item.source===state.reviewSource)).sort((a,b)=>
  num(b.recorded_ms)-num(a.recorded_ms)||assignmentKey(a).localeCompare(assignmentKey(b)));
}

 // S9_REVIEWED_OSNET_HSV_SUGGESTIONS_V1. Suggestion evidence, not an ID.
 async function addReviewedOsnetMatches(ref,person,matches){
  if(!clipName.test(String(ref?.clip||'')))return 0;
  let response;
  try{
   const res=await relay().fetch('/new/api/appearance-multivector?'+
    new URLSearchParams({clip:ref.clip}).toString(),{cache:'no-store'});
   if(!res.ok)return 0;
   response=await res.json();
  }catch(_){return 0}
  if(response?.ok!==true||response?.appearance_only!==true||
    response?.verified_same_person!==false||
    response?.identity_probability!==false||
    response?.human_review_required!==true||
    response?.automatic_person_assignments!==0||
    response?.reference_source!=='s9_sd'||
    response?.reference_clip!==ref.clip||
    response?.model_sha256!=='ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d'||
    !Array.isArray(response.results)||response.results.length>5)return 0;
  let accepted=0;
  for(const hit of response.results){
   const clip=String(hit?.clip_name||'');
   if(!clipName.test(clip)||clip===ref.clip||
     hit.source!=='s9_sd'||hit.appearance_only!==true||
     hit.verified_same_person!==false||hit.auto_assignment!==false||
     hit.human_review_required!==true||
     !['visual_75_color_25','structural_70_visual_30'].includes(hit.method)||
     typeof hit.similarity_percent!=='number'||
     !Number.isFinite(hit.similarity_percent)||
     hit.similarity_percent<80||hit.similarity_percent>100||
     typeof hit.similarity!=='number'||!Number.isFinite(hit.similarity)||
     Math.abs(hit.similarity*100-hit.similarity_percent)>.02)continue;
   const recorded_ms=Number(clip.slice(7,20));
   if(!Number.isFinite(recorded_ms)||
     Math.abs(recorded_ms-ref.recorded_ms)>72*60*60*1000)continue;
   if(assignedFolder({source:'sd',name:clip,clip}))continue;
   const evidence=state.clipEvidence.get(clip);
   if(!evidence||num(evidence.person_count)!==1||
     num(evidence.frames_with_distinct_multiple_person_boxes)>0)continue;
   const score=hit.similarity;
   // Do not merge HSV-only scores with model-backed scores or count one
   // reference twice. Each method remains clearly labelled.
   const key=person.id+':'+clip+':model';
   const prior=matches.get(key);
   if(prior){
    if(prior.references.includes(ref.clip))continue;
    prior.references.push(ref.clip);
    prior.bestScore=Math.max(prior.bestScore,score);
    prior.sumScore+=score;
    if(score>prior.score){prior.score=score;prior.reference=ref.clip}
   }else{
    matches.set(key,{clip,person,reference:ref.clip,references:[ref.clip],
      score,bestScore:score,sumScore:score,scoreSource:'osnet_hsv',
      recorded_ms,source:'sd',name:clip,
      video_path:'/new/saved/clip/'+encodeURIComponent(clip)});
   }
   accepted++;
  }
  return accepted;
 }

async function searchClothingMatches(force=false){
 if(state.clothingBusy||!state.assignedReady||!state.extraLinks)return;
 if(state.clothingMatches&&!force)return;
 const token=++state.clothingToken;
 state.clothingBusy=true;state.clothingError='';state.clothingMatches=null;renderClothing();
 const sources=state.archiveEntries.filter(x=>x.source==='sd'&&assignedFolder(x)&&
    state.clipEvidence.has(x.clip)&&num(state.clipEvidence.get(x.clip).person_count)===1&&
    num(state.clipEvidence.get(x.clip).frames_with_distinct_multiple_person_boxes)===0);
 // Reviewed single-person clips act as labelled examples, not biometric
 // training data. Use up to three distinct time-separated references per
 // person, rather than one outfit/photo being treated as their identity.
 // Sample one independent reference per saved person before selecting
 // the second and third. Otherwise the first people in reverse chronology
 // exhaust the reference budget and hide equally valid reviewed people.
 const perPerson=new Map(savedFolders().map(person=>[person.id,{person,refs:[]}]));
 for(const ref of sources){
  const group=perPerson.get(assignedFolder(ref));
  if(!group||group.refs.length>=3)continue;
  if(group.refs.some(x=>Math.abs(x.recorded_ms-ref.recorded_ms)<15*60*1000))continue;
  group.refs.push(ref);
 }
 const references=[];
 for(let pass=0;pass<3&&references.length<18;pass++){
  for(const group of perPerson.values()){
   if(group.refs[pass])references.push({ref:group.refs[pass],person:group.person});
   if(references.length>=18)break;
  }
 }
 const matches=new Map();let failures=0,checked=0;
 for(const {ref,person} of references){
  if(token!==state.clothingToken)break;
  try{
   // Model-backed evidence exists only for verified detector crops.
   // Keep existing two-piece HSV comparison for other references.
   const modelCount=await addReviewedOsnetMatches(ref,person,matches);
   if(modelCount>0){checked++;continue}
   const make=category=>'/new/api/appearance-search?'+new URLSearchParams({
    clip:ref.clip,category,method:'bhattacharyya',limit:'50'}).toString();
   // Serial calls keep comparison work bounded on the camera phone.
   const upperResponse=await relay().fetch(make('upper_clothing'),{cache:'no-store'});
   const lowerResponse=await relay().fetch(make('lower_clothing'),{cache:'no-store'});
   const upper=await upperResponse.json(),lower=await lowerResponse.json();
   if(!upperResponse.ok||!lowerResponse.ok||upper.ok!==true||lower.ok!==true||
       upper.appearance_only!==true||lower.appearance_only!==true)
    throw Error('Phone appearance index unavailable');
   checked++;
   const lowers=new Map((lower.results||[]).map(hit=>[hit.clip_name,hit]));
   for(const hit of upper.results||[]){
    const clip=String(hit.clip_name||''),bottom=lowers.get(clip);
    if(!clipName.test(clip)||!bottom||clip===ref.clip)continue;
    // Similar clothing weeks apart is not reliable person evidence. Only
    // surface time-nearby outfit comparisons, never an identity assertion.
    const candidateTime=Number(clip.slice(7,20));
    if(!Number.isFinite(candidateTime)||
       Math.abs(candidateTime-ref.recorded_ms)>72*60*60*1000)continue;
    if(assignedFolder({source:'sd',name:clip,clip}))continue;
    const u=Number(hit.similarity),l=Number(bottom.similarity);
    if(!Number.isFinite(u)||!Number.isFinite(l)||u<.90||l<.88||u>1||l>1)continue;
    if(hit.zone&&bottom.zone&&hit.zone!==bottom.zone)continue;
    const observed=state.clipEvidence.get(clip);
    // Different detected people inside one candidate clip may each supply
    // one half of the outfit: never combine those colours into one match.
    if(!observed||num(observed.person_count)!==1||
       num(observed.frames_with_distinct_multiple_person_boxes)>0)continue;
    // A match describes the same clothing colours across two videos only.
    const score=.62*u+.38*l,key=person.id+':'+clip+':hsv',prior=matches.get(key);
    if(prior){
     // Independent confirmed reference agreements strengthen *outfit*
     // evidence but do not establish a person identity.
     if(prior.references.includes(ref.clip))continue;
     prior.references.push(ref.clip);
     prior.bestScore=Math.max(prior.bestScore,score);
     prior.sumScore+=score;
     if(score>prior.score){prior.score=score;prior.reference=ref.clip;
      prior.upper=u;prior.lower=l;}
    }else matches.set(key,{clip,person,reference:ref.clip,references:[ref.clip],
      upper:u,lower:l,score,bestScore:score,sumScore:score,scoreSource:'hsv_two_piece',
      recorded_ms:Number(clip.slice(7,20)),source:'sd',name:clip,
      video_path:'/new/saved/clip/'+encodeURIComponent(clip)});
   }
  }catch(_){failures++}
 }
 if(token===state.clothingToken){
  const allMatches=[...matches.values()].map(match=>({
   ...match,referenceSupport:match.references.length,
   meanSimilarity:match.sumScore/match.references.length
  }));
  // A common blue jacket is not unique to one reviewed person. Surface
  // conflicting outfit labels explicitly rather than ranking one as an ID.
  for(const match of allMatches){
   const competitors=allMatches.filter(other=>other.clip===match.clip&&
    other.scoreSource===match.scoreSource&&other.person.id!==match.person.id&&
    other.meanSimilarity>=match.meanSimilarity-.035&&
    other.referenceSupport>=match.referenceSupport-1);
   match.ambiguousPeople=competitors.map(other=>other.person.label).slice(0,3);
  }
  state.clothingMatches=allMatches.sort((a,b)=>
    a.ambiguousPeople.length-b.ambiguousPeople.length||
    b.referenceSupport-a.referenceSupport||
    b.meanSimilarity-a.meanSimilarity||b.bestScore-a.bestScore).slice(0,80);
  state.clothingError=failures?'Could not compare '+failures+' of '+references.length+
    ' references. Try refreshing when the S9+ is available.':'';
  if(!references.length)state.clothingError='No eligible approved single-person reference recordings yet.';
  else if(!checked)state.clothingError='S9+ outfit comparison index is unavailable. No speculative matches are shown.';
  state.clothingBusy=false;renderClothing();
 }
}
const autoId=/^[a-f0-9]{64}$/;
function renderClothing(){
 const matches=state.clothingMatches||[];
 return matches;
}
