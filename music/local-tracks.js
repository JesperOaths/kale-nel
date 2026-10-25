/** Local host music: no recording bytes are uploaded and no streaming service is used.
 * The host's File objects remain in this browser tab only. Supports ID3v2.2/2.3/2.4
 * and ID3v1; filename fallback for other browser-playable audio formats.
 */
export const LOCAL_GENRES=["pop","rock","hiphop","electronic","indie","dutch","disco","rnb","metal","dance"];
const genreMap=[
 ["hiphop",/\b(hip.?hop|rap|trap)\b/i],["rnb",/\b(r.?&.?b|rhythm.and.blues|soul)\b/i],
 ["metal",/\b(heavy.?metal|metal)\b/i],["disco",/\bdisco\b/i],
 ["electronic",/\b(electronic|electronica|techno|trance|house|ambient)\b/i],
 ["dance",/\b(dance|edm|house|techno|trance)\b/i],["indie",/\b(indie|alternative)\b/i],
 ["rock",/\b(rock|grunge|punk|hard.?rock)\b/i],["pop",/\bpop\b/i],
 ["dutch",/\b(dutch|nederlands|nederlandstalig)\b/i]
];
export function classifyGenres(raw){
 const str=String(raw||"").replace(/^\((\d+)\)/,"").trim();
 return [...new Set(genreMap.filter(([,re])=>re.test(str)).map(([v])=>v))];
}
function decodeFrame(payload){
 if(!payload?.length)return "";
 try{
  const enc=payload[0],b=payload.slice(1);
  if(enc===1||enc===2){
   let p=0,little=enc===1;
   if(enc===1&&b.length>=2&&b[0]===0xfe&&b[1]===0xff){little=false;p=2}
   else if(enc===1&&b.length>=2&&b[0]===0xff&&b[1]===0xfe){little=true;p=2}
   const src=b.slice(p);let bytes=src;
   if(!little){bytes=new Uint8Array(src.length);for(let i=0;i+1<src.length;i+=2){bytes[i]=src[i+1];bytes[i+1]=src[i]}}
   return new TextDecoder("utf-16le",{fatal:false}).decode(bytes).replace(/\0/g," ").trim();
  }
  return new TextDecoder(enc===3?"utf-8":"windows-1252",{fatal:false})
   .decode(b).replace(/\0/g," ").trim();
 }catch{return ""}
}
function ascii(bytes){return new TextDecoder("latin1").decode(bytes)}
const numeric=(bytes,sync)=>{let n=0;for(const b of bytes)n=n*(sync?128:256)+(sync?b&127:b);return n};
function parseID3v2(bytes){
 if(bytes.length<10||ascii(bytes.slice(0,3))!=="ID3")return {};
 const version=bytes[3],syn=version===4;
 if(![2,3,4].includes(version))return {};
 const tagSize=numeric(bytes.slice(6,10),true);
 if(tagSize<1||tagSize>10_000_000)return {};
 let pos=10,out={},limit=Math.min(10+tagSize,bytes.length),count=0;
 if(bytes[5]&0x40)return out; // extended header requires extra parsing; use safe fallback
 while(pos+(version===2?6:10)<=limit&&count++<400){
  const sz=version===2?3:4,head=version===2?6:10;
  const key=ascii(bytes.slice(pos,pos+(version===2?3:4)));
  if(!/^[A-Z0-9]{3,4}$/.test(key))break;
  const start=pos+head, size=numeric(bytes.slice(pos+(version===2?3:4),pos+(version===2?6:8)),syn);
  if(!size||start+size>limit)break;
  const canonical={TT2:"title",TIT2:"title",TP1:"artist",TPE1:"artist",TYE:"year",TYER:"year",
   TDRC:"year",TCO:"genre",TCON:"genre"}[key];
  if(canonical&&size<5000&&!out[canonical])out[canonical]=decodeFrame(bytes.slice(start,start+size));
  pos=start+size;
 }
 return out;
}
function parseID3v1(bytes){
 if(bytes.length!==128||ascii(bytes.slice(0,3))!=="TAG")return {};
 return {title:ascii(bytes.slice(3,33)).replace(/\0/g,"").trim(),
  artist:ascii(bytes.slice(33,63)).replace(/\0/g,"").trim(),
  year:ascii(bytes.slice(93,97)).replace(/\0/g,"").trim()};
}
export function parseFilename(name){
 const clean=String(name||"").replace(/\.(mp3|m4a|aac|flac|wav|ogg|opus|mp4|aiff)$/i,"")
  .replace(/^\s*\d{1,3}[\s._-]+/,"").replace(/_/g," ").trim();
 const split=clean.match(/^(.+?)\s+-\s+(.+)$/);
 return split?{artist:split[1].trim(),title:split[2].trim()}:{artist:"",title:clean};
}
export function prepareTrackMetadata(file,raw={},index=0){
 const fallback=parseFilename(file.name);
 const title=String(raw.title||fallback.title||"").slice(0,100).trim();
 const artist=String(raw.artist||fallback.artist||"").slice(0,100).trim();
 const yearText=String(raw.year||"").match(/(19[5-9]\d|20\d{2}|2100)/)?.[0]||"";
 const year=yearText?Number(yearText):null;
 return {index,file,title,artist,year,genres:classifyGenres(raw.genre||""),
  needsReview:!title||!artist||!year||!classifyGenres(raw.genre||"").length};
}
export async function inspectLocalTrack(file,index){
 if(!file||!/(\.(mp3|m4a|aac|flac|wav|ogg|opus|mp4|aiff))$/i.test(file.name)||file.size>500_000_000)return null;
 const header=new Uint8Array(await file.slice(0,Math.min(file.size,512*1024)).arrayBuffer());
 const tag2=parseID3v2(header);
 const tail=file.size>=128?new Uint8Array(await file.slice(-128).arrayBuffer()):new Uint8Array();
 const tag1=parseID3v1(tail);
 return prepareTrackMetadata(file,{...tag1,...Object.fromEntries(Object.entries(tag2).filter(([,v])=>Boolean(v)))},index);
}
export function chooseNextLocalTrack(tracks,genres,decades,played,random=Math.random){
 const accepted=new Set(genres||[]),years=new Set(decades||[]);
 const pool=tracks.filter(x=>x.title&&x.artist&&x.year&&x.genres?.length&&
  x.genres.some(g=>accepted.has(g))&&
  (!years.size||years.has(String(Math.floor(x.year/10)*10))));
 if(!pool.length)throw Error("No local tracks match these genres and decades. Review song metadata or change filters.");
 let choices=pool.filter(x=>!played.has(x.index));
 if(!choices.length){played.clear();choices=pool}
 const selected=choices[Math.min(choices.length-1,Math.floor(Math.max(0,Math.min(.99999999,random()))*choices.length))];
 return selected;
}
export function chooseFullTrackCue(durationSeconds,random=Math.random){
 if(!Number.isFinite(durationSeconds)||durationSeconds<30||durationSeconds>7200)throw Error("Song must be at least 30 seconds long.");
 const end=Math.floor(durationSeconds*1000)-21000;
 const lower=Math.min(60000,Math.max(10000,Math.floor(durationSeconds*150)));
 const low=Math.min(lower,end),span=Math.max(0,end-low);
 return low+Math.floor(Math.max(0,Math.min(.99999999,random()))*(span+1));
}
