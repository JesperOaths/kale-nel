#!/usr/bin/env node
'use strict';
// Execute the real page with the observed S9 catalog and a bounded DOM/relay.
// This checks filtering and media routing, not physical camera performance.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'security-review-v8.html'),'utf8');
const source=html.split('<script id="s9v8-review-script">')[1].split('</script>')[0];
new vm.Script(source);
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),catalog=fixture.saved||fixture;
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.style={};this.value='';this.textContent='';this.isConnected=true;this.readyState=0;this.events={};}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=children}
 setAttribute(k,v){this.attributes[k]=v}
 removeAttribute(k){delete this[k]}
 addEventListener(k,v){(this.events[k]??=[]).push(v)}
 querySelector(query){return this.children.find(x=>query.startsWith('.')&&x.className?.split(' ').includes(query.slice(1)))||null}
 remove(){this.isConnected=false}
 pause(){this.paused=true}
 load(){}
 play(){return Promise.resolve()}
 click(){this.onclick?.()}
}
async function setup(mode='evidence'){
 const ids=new Map(),paths=[],fetches=[];for(const match of html.matchAll(/\bid="([^"]+)"/g))ids.set(match[1],new Element());
 for(const [k,v] of Object.entries({period:'all',source:'all',type:'all',order:'new'}))ids.get(k).value=v;
 const doc={getElementById:id=>ids.get(id),createElement:t=>new Element(t),querySelectorAll:query=>query==='.clip'?ids.get('list').children:[],addEventListener(){},hidden:false};
 const window={addEventListener(){},location:{origin:'https://hub.example'},C720PSecureRelay:{url:async p=>{paths.push(p);return 'https://signed.example'+p},fetch:async(p,opts)=>{fetches.push([p,opts]);return p==='/new/api/saved'?{ok:true,json:async()=>catalog}:{ok:false}}}};window.parent=window;
 const context={document:doc,window,location:{search:'?mode='+mode},URLSearchParams,Intl,Date,Blob,URL,setTimeout,clearTimeout,setInterval(){}};
 // Only the test harness receives internal helpers; the shipped page exposes none.
 const tested=source.replace('refresh();setInterval(',"globalThis.reviewTest={state,name,isStill,category,hasCategory,stamp,dayOf,source,positives,samples,score,eventStarts,render,open,refresh,seek};refresh();setInterval(");
 vm.createContext(context);vm.runInContext(tested,context);await flush();return {api:context.reviewTest,ids,paths,fetches,window};
}
async function flush(){for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}
(async()=>{
 const r=await setup(),a=r.api,ids=r.ids;
 assert.equal(a.state.all.length,catalog.events.length+catalog.fallback_previews.length,'complete videos and stills');
 assert.equal(Number(ids.get('nclips').textContent),catalog.events.length);
 assert.equal(Number(ids.get('nstills').textContent),catalog.fallback_previews.length);
 assert.equal(Number(ids.get('nreview').textContent),catalog.events.filter(x=>Number(x.sampled_frames)>0).length);
 assert.equal(a.positives({sampled_frames:8,person_detected_frames_050:null}),null,'missing hit count is not zero');
 assert.equal(a.positives({sampled_frames:8,person_detected_frames_050:0}),0,'measured zero is retained');
 assert.equal(a.score({person_score:null}),null,'missing detector score stays missing');
 assert.equal(a.category({scene_category:'motion_other',person_count:0,person_event_category:'possible_person_below_standard_threshold',content_categories:['vehicle']}),'possible','uncertain person evidence not hidden by vehicle');
 assert.equal(a.category({scene_category:'one_person',person_count:1,person_event_category:'single_frame_person_candidate'}),'possible','one sampled hit not repeated person evidence');
 assert.equal(a.category({scene_category:'one_person',person_count:1,person_event_category:'single_person_repeated_candidate'}),'person');
 assert.equal(a.stamp({clip_no:'rec_2026-01-09_22-40.mp4'}),Date.parse('2026-01-09T21:40:00Z'),'Amsterdam winter timestamp');
 assert.equal(a.stamp({clip_no:'rec_2026-07-09_22-40.mp4'}),Date.parse('2026-07-09T20:40:00Z'),'Amsterdam summer timestamp');
 assert.equal(a.dayOf({clip_no:'native4k_1791576078307.mp4'}),'2026-10-09','native4k evidence date');
 ids.get('type').value='people';a.render();assert.equal(a.state.visible.length,catalog.events.filter(x=>['person','possible'].includes(a.category(x))).length);
 assert.ok(a.state.visible.some(x=>x.person_count===0&&x.person_event_category==='possible_person_below_standard_threshold'));
 ids.get('type').value='vehicle';a.render();assert.equal(a.state.visible.length,catalog.events.filter(x=>a.hasCategory(x,'vehicle')).length,'vehicle filter includes ancillary vehicle evidence on uncertain-person clips');
 ids.get('type').value='review';ids.get('source').value='video';a.render();assert.ok(a.state.visible.every(x=>!a.isStill(x)&&!a.samples(x)));
 ids.get('type').value='all';ids.get('source').value='still';a.render();assert.equal(a.state.visible.length,catalog.fallback_previews.length);assert.equal(ids.get('nclips').textContent,0);
 ids.get('source').value='all';ids.get('period').value='custom';ids.get('from').value='2026-10-13';ids.get('through').value='2026-10-13';a.render();assert.ok(a.state.visible.length>0);assert.ok(a.state.visible.every(x=>a.dayOf(x)==='2026-10-13'));
 ids.get('from').value='2026-10-14';a.render();assert.equal(a.state.visible.length,0);assert.ok(ids.get('filterError').textContent);
 ids.get('period').value='all';ids.get('from').value='';ids.get('through').value='';a.state.hour=6;a.render();assert.ok(a.state.visible.every(x=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'}).format(new Date(a.stamp(x)))==='06'));
 a.state.hour=null;a.render();await a.open(catalog.events.find(x=>x.clip_no.startsWith('native4k_')));assert.ok(r.paths.some(x=>x.includes('/new/saved/clip/native4k_')),'earlier native4k original is playable');
 const motion=catalog.events.find(x=>x.anonymous_tracks?.length);await a.open(motion);a.state.activeVideo.readyState=1;a.seek(a.state.activeVideo,motion.anonymous_tracks[0].first_sample_ms);assert.equal(a.state.activeVideo.currentTime,motion.anonymous_tracks[0].first_sample_ms/1000,'timed observation seeks original');
 const timeline=[{time_ms:1000,people_at_050:0,vehicles_at_050:1,animals_at_050:0,person_peak_score:.43},{time_ms:2000,people_at_050:1,vehicles_at_050:0,animals_at_050:0,person_peak_score:.67}];await a.open({...motion,person_timeline_status:'sampled_model_evidence',person_sample_timeline:timeline});const sampleDetails=ids.get('detail').children.find(x=>x.tagName==='details'&&x.children.some(t=>t.className==='samples'));assert.ok(sampleDetails,'real sampled timeline displayed');const sampleGrid=sampleDetails.children.find(x=>x.className==='samples');assert.equal(sampleGrid.children.length,2);assert.equal(sampleGrid.children[1].dataset.person,'true');a.state.activeVideo.readyState=1;sampleGrid.children[1].click();assert.equal(a.state.activeVideo.currentTime,2,'sample moment seeks its exact original timestamp');
 await a.open(catalog.fallback_previews[0]);assert.equal(a.state.activeVideo,null);assert.ok(r.paths.some(x=>x.includes('/new/saved/still/preview_motion_')),'stills use authenticated still route');
 const same={clip_no:'motion_1791862258385.mp4',capture_evidence_status:'recording_segment_verified',capture_event_id:'garden_1791862258385'};assert.equal(a.eventStarts([same,{...same,clip_no:'motion_1791862259385.mp4'}]).length,1,'verified segments do not inflate event totals');
 r.window.C720PSecureRelay.fetch=async()=>{throw Error('offline')};await a.refresh();assert.equal(a.state.all.length,catalog.events.length+catalog.fallback_previews.length);assert.ok(ids.get('sync').textContent.includes('last loaded index'),'stale retained data is labelled');
 const today=await setup('today');assert.equal(today.ids.get('totals').hidden,true);assert.equal(today.ids.get('analytics').hidden,true);assert.equal(today.ids.get('period').value,'today');assert.ok(today.api.state.visible.every(x=>today.api.dayOf(x)===new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam'}).format(new Date())));
 console.log('S9_EVIDENCE_V25_RUNTIME_PASS: complete catalog, null semantics, overlapping categories, winter/summer dates, filters, original media, track/sample seeking, stills, event grouping, stale data, focused Today');
})().catch(e=>{console.error(e);process.exitCode=1});
