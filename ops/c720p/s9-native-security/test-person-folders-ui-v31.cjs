const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/security-face-folders-v22.html','utf8');
let script=html.match(/<script id="security-face-folders-v22">([\s\S]*?)<\/script>/)[1];
class Element{
 constructor(){this.children=[];this.events={};this.isConnected=true;this.value='';this.attrs={}}
 append(...x){this.children.push(...x)}replaceChildren(...x){this.children=x}add(x){this.children.push(x)}
 setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}addEventListener(k,v){this.events[k]=v}
 scrollIntoView(){}showModal(){this.open=true}close(){this.open=false}pause(){}load(){}
}
const dom=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
const track={id:'Person 1',temporary_track_id:1,first_sample_ms:1000,last_sample_ms:5000,sample_count:4,peak_detection_score:.95,upper_clothing_colour:'blue',pose_metrics:{posture_availability:'available',posture:'projected_upright',apparent_speed_body_heights_per_second:.4,gait_availability:'available_projected_ankle_cycle',cadence_steps_per_minute:120}};
const names=['motion_1791600000000.mp4','motion_1791600040000.mp4'];
const events=names.map(clip_no=>({clip_no,person_count:1,duration_ms:10000,anonymous_id_scope:'clip_only_never_across_recordings',anonymous_tracks:[track],face_candidates:[]}));
events.push({clip_no:'rec_2026-10-09_22-40.mp4',person_count:1,anonymous_tracks:[]});
const obs=names.map(clip_no=>({observation_key:clip_no+':track:1',clip_no,track_id:1,track_label:'Person 1',face_evidence:[],association_status:'unreviewed'}));
obs[0]={...obs[0],profile_id:'PER-0001',association_status:'human_confirmed'};
const persons={ok:true,version:'s9_person_folders_v31',profiles:[{profile_id:'PER-0001',name:'Reviewed visitor',confirmed_appearance_count:1,observations:[obs[0]]}],candidates:[{candidate_id:'CAND-test',face_alias:'unknown_00001',recording_count:1,observations:[obs[1]]}],unassigned:[obs[1]],suggestions:[]};
let writes=[];
const relay={fetch:async(path,options)=>{
 if(options?.method==='POST'){writes.push({path,options});return{ok:true,json:async()=>({ok:true})}}
 return{ok:true,json:async()=>path.endsWith('person-folders')?persons:{archive_mode:'S9-microSD-only',events}};
},url:async p=>p};
const context=vm.createContext({console,Date,Intl,Set,Map,Object,Array,Number,String,Promise,Math,Error,encodeURIComponent,
 Option:function(text,value){this.textContent=text;this.value=value},
 window:{C720PSecureRelay:relay,location:{origin:'http://localhost'}},
 document:{getElementById:id=>dom.get(id),createElement:()=>new Element(),addEventListener(){}}});
script=script.replace(/(?=\}\)\(\);\s*$)/,'globalThis.testAPI={state,buildFolders,renderRecords,reviewPerson,trackText};');
vm.runInContext(script,context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 await tick();await tick();const api=context.testAPI;
 assert.equal(api.state.grouping,'profiles');assert.equal(writes.length,0);
 assert.equal(api.state.folders.length,3,'Reviewed person, candidate and legacy recording all remain visible');
 assert.equal(api.state.folders.filter(g=>g.kind==='profile')[0].title,'Reviewed visitor');
 assert.equal(api.state.folders.flatMap(g=>g.entries).length,3,'Candidate also in unassigned must not duplicate');
 assert.match(api.trackText(track),/upright posture/);assert.match(api.trackText(track),/120 steps\/min/);
 api.reviewPerson(obs[1]);assert.equal(dom.get('personReview').open,true);
 dom.get('personChoice').value='PER-0001';dom.get('personConfirmed').checked=false;
 await dom.get('personForm').onsubmit({preventDefault(){}});assert.equal(writes.length,0);
 dom.get('personConfirmed').checked=true;await dom.get('personForm').onsubmit({preventDefault(){}});
 assert.equal(writes.length,1);const sent=writes[0];assert.equal(sent.path,'/new/api/person-folders/review');
 assert.equal(sent.options.headers['X-S9-Person-Folder-Intent'],'explicit-review-v31');
 assert.deepEqual(JSON.parse(sent.options.body),{action:'link',observation_key:names[1]+':track:1',profile_id:'PER-0001',name:null,human_confirmed:true});
 assert.equal(dom.get('personReview').open,false);
 console.log('PERSON_FOLDERS_UI_V31_PASS: named and tentative folders, legacy evidence, metrics, no duplicates, explicit reviewed assignment');
})().catch(e=>{console.error(e);process.exitCode=1});
