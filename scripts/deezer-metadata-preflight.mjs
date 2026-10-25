/**
 * Deezer metadata-only preflight for a music quiz integration.
 * Never download or play preview audio. No public gameplay without Deezer's approval.
 * Usage:
 *   node scripts/deezer-metadata-preflight.mjs --fixtures  (no network)
 *   node scripts/deezer-metadata-preflight.mjs --live      (metadata-only search)
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {chooseDeezerMatch} from "../music/deezer-preview.js";
const fixture={title:"Take on Me",artist:"a-ha",year:1985,genres:["pop"]};
function mock(){
 const item={id:664107,title:"Take on Me",title_short:"Take on Me",artist:{name:"a-ha"},
   readable:true,preview:"https://cdnt-preview.dzcdn.net/stream/example.mp3"};
 const match=chooseDeezerMatch(fixture,[{...item,title:"Take on Me (Karaoke)",title_version:"Karaoke"},item]);
 assert.equal(match?.id,664107);
 console.log("DEEZER_METADATA_FIXTURE_PASS",JSON.stringify({trackId:match.id,genre:match.genres[0],year:match.year}));
}
if(process.argv.includes("--fixtures")){mock();process.exit(0)}
if(!process.argv.includes("--live"))throw Error("Select --fixtures or --live");
const candidates=JSON.parse(readFileSync(new URL("../music/catalog-candidates.json",import.meta.url),"utf8")).candidates;
const priority=[fixture,...candidates.filter(x=>["Dancing Queen","Believe","Yellow","Brabant","Firestarter"].includes(x.title))].slice(0,6);
const counts={attempted:0,matched:0,availablePreview:0,errors:0};
for(const c of priority){
 const u=new URL("https://api.deezer.com/search");
 u.searchParams.set("q",c.artist+" "+c.title);u.searchParams.set("limit","12");
 try{
  const r=await fetch(u,{signal:AbortSignal.timeout(10000),headers:{"Accept":"application/json"}});
  if(!r.ok)throw Error("Deezer status "+r.status);
  const body=await r.json();
  if(body.error)throw Error("Deezer API error "+String(body.error.type||body.error.code));
  const match=chooseDeezerMatch(c,body.data||[]);
  counts.attempted++;
  if(match){counts.matched++;counts.availablePreview++;}
  console.log("DEEZER_METADATA_CANDIDATE",JSON.stringify({song:c.title,artist:c.artist,previewAvailable:Boolean(match)}));
 }catch(e){
  counts.errors++;
  console.log("DEEZER_METADATA_PROVIDER_UNAVAILABLE",JSON.stringify({song:c.title,reason:String(e.message).slice(0,100)}));
 }
}
console.log("DEEZER_METADATA_PREFLIGHT_RESULT",JSON.stringify(counts));
if(!counts.attempted)process.exitCode=1;
