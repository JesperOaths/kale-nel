"use strict";
/* Peaks are measured from the decoded MP3 clue; no decorative/random bars. */
function tuneRushEnvelope(channels,start,end,count=128){
 const length=channels[0]?.length||0;
 start=Math.max(0,Math.min(length,Math.floor(start)));end=Math.max(start,Math.min(length,Math.ceil(end)));
 const peaks=new Float32Array(count);
 for(let bin=0;bin<count;bin++){
  const lo=start+Math.floor((end-start)*bin/count),hi=start+Math.floor((end-start)*(bin+1)/count);
  let peak=0;for(const samples of channels)for(let i=lo;i<hi;i++)peak=Math.max(peak,Math.abs(samples[i]||0));
  peaks[bin]=peak;
 }return peaks;
}
if(typeof module!=="undefined")module.exports={tuneRushEnvelope};
if(typeof window!=="undefined")window.TuneRushScope=(()=>{
 const $=id=>document.getElementById(id),canvas=$("waveform"),root=$("audio-scope");
 let context=null,peaks=null,target=.5,elapsed=0,identity="",source="",generation=0,loading=false;
 function unlock(){try{context ||= new (window.AudioContext||window.webkitAudioContext)();if(context.state==="suspended")void context.resume().catch(()=>{});}catch{}}
 function message(text){$("waveform-message").textContent=text;$("waveform-message").hidden=!text;}
 function draw(){
  if(!canvas)return;const bounds=canvas.getBoundingClientRect(),ratio=Math.min(2,window.devicePixelRatio||1);
  const width=Math.max(1,Math.round(bounds.width)),height=Math.max(1,Math.round(bounds.height));
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
  const ctx=canvas.getContext("2d");ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
  const area=Math.max(12,height-32),middle=area/2;
  if(!peaks){ctx.strokeStyle="#2e3b25";ctx.beginPath();ctx.moveTo(0,middle);ctx.lineTo(width,middle);ctx.stroke();return;}
  const max=Math.max(...peaks,.005),gap=width/peaks.length,bar=Math.max(1,gap*.49);
  for(let i=0;i<peaks.length;i++){
   const amplitude=peaks[i]/max*Math.max(3,middle-7),played=(i+.5)/peaks.length<=elapsed/target;
   ctx.fillStyle=played?"#c6f56b":"#5d744b";ctx.fillRect(i*gap+(gap-bar)/2,middle-Math.max(.6,amplitude),bar,Math.max(1.2,amplitude*2));
  }
  if(elapsed>0){ctx.fillStyle="#e5ffc0";ctx.fillRect(Math.min(width-1,width*elapsed/target),4,1,area-8);}
 }
 function duration(seconds,round,step){
  const key=round+":"+step;
  if(key!==identity){identity=key;generation++;source="";peaks=null;loading=false;elapsed=0;message(step<0?"Play a fragment to see its waveform.":"Loading the audio waveform…");}
  target=seconds;$("scope-target").textContent=seconds+"s";draw();
 }
 async function load(uri,cue,seconds){
  if(uri===source&&(peaks||loading))return;const current=++generation;source=uri;peaks=null;loading=true;message("Reading this fragment's waveform…");draw();
  if(!uri.startsWith("data:audio/mpeg;base64,")){message("Waveform unavailable for this source.");return;}
  try{
   unlock();if(!context)throw Error("Audio decoding unavailable");
   const raw=Uint8Array.from(atob(uri.split(",",2)[1]),char=>char.charCodeAt(0));
   const buffer=await context.decodeAudioData(raw.buffer);if(current!==generation)return;
   const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
   peaks=tuneRushEnvelope(channels,cue*buffer.sampleRate,(cue+seconds)*buffer.sampleRate);message("");draw();
  }catch{if(current===generation){message("Waveform unavailable. Audio playback is still available.");draw();}}
  finally{if(current===generation)loading=false;}
 }
 function progress(value,seconds,playing){
  target=seconds;elapsed=Math.max(0,Math.min(seconds,value||0));$("scope-elapsed").textContent=(Math.floor(elapsed*10)/10).toFixed(1)+"s";$("scope-target").textContent=seconds+"s";
  $("scope-activity").textContent=playing?"PLAYING":elapsed>=seconds-.03?"FRAGMENT COMPLETE":"READY TO LISTEN";root.classList.toggle("scope-playing",!!playing);draw();
 }
 function pause(){root?.classList.remove("scope-playing");}
 if(typeof ResizeObserver!=="undefined")new ResizeObserver(draw).observe(canvas);window.addEventListener("resize",draw);draw();
 return {unlock,duration,load,progress,pause};
})();
