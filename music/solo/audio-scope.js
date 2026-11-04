"use strict";
/* Audio-game visualizer: clue progress and decorative sound bars.
   This is not a true audio waveform: cross-origin YouTube audio is
   never intercepted, extracted or processed. */
window.TuneRushScope=(()=>{
  const $=id=>document.getElementById(id);
  const MILESTONES=[0.5,1.5,3,5,8,12,20];
  let round=-1,step=-2,target=0.5,shown=-1;
  function initialize(){
    const holder=$("scope-bars");
    if(!holder||holder.childElementCount)return;
    const fragment=document.createDocumentFragment();
    for(let i=0;i<49;i++){
      const el=document.createElement("i");
      el.className="scope-bar";
      el.style.setProperty("--height",String(20+Math.round((Math.sin(i*1.17+0.6)**2)*68+(Math.sin(i*0.42)**2)*12))+"%");
      el.style.setProperty("--delay",String(-(i*0.075).toFixed(3))+"s");
      el.style.setProperty("--speed",String((0.66+(i%7)*0.065).toFixed(2))+"s");
      fragment.append(el);
    }
    holder.replaceChildren(fragment);
    const rail=$("scope-milestones");
    if(rail){
      const batch=document.createDocumentFragment();
      for(const seconds of MILESTONES){
        const marker=document.createElement("span");
        marker.className="scope-tick";
        marker.dataset.seconds=String(seconds);
        marker.textContent=seconds+"s";
        batch.append(marker);
      }
      rail.replaceChildren(batch);
    }
  }
  function duration(seconds,nextRound,nextStep){
    initialize();
    if(!Number.isFinite(seconds)||seconds<=0||seconds>20)return;
    if(nextRound!==round||nextStep!==step){
      round=nextRound;step=nextStep;shown=-1;
      progress(0,seconds,false);
    }
    target=seconds;
    const total=$("scope-target");
    if(total)total.textContent=seconds+"s";
    for(const el of $("scope-milestones")?.children||[]){
      const n=Number(el.dataset.seconds);
      el.classList.toggle("scope-tick-current",n===seconds);
      el.classList.toggle("scope-tick-earlier",n<seconds);
    }
  }
  function progress(seconds,durationSeconds,playing){
    const next=Number.isFinite(durationSeconds)&&durationSeconds>0?durationSeconds:target;
    const elapsed=Math.max(0,Math.min(next,Number(seconds)||0));
    const root=$("audio-scope");
    if(!root)return;
    target=next;
    root.classList.toggle("scope-playing",!!playing);
    root.classList.toggle("scope-finished",!playing&&elapsed>=next-0.05);
    const tenths=Math.floor(elapsed*10+0.0001)/10;
    if(tenths!==shown){
      shown=tenths;
      const val=$("scope-elapsed");
      if(val)val.textContent=tenths.toFixed(1)+"s";
    }
    const fill=$("scope-fill");
    if(fill)fill.style.transform="scaleX("+(elapsed/next).toFixed(5)+")";
    const text=$("scope-activity");
    if(text)text.textContent=playing?"PLAYING":elapsed>=next-0.05?"CLUE COMPLETE":"READY";
  }
  function pause(){
    const root=$("audio-scope");
    if(root)root.classList.remove("scope-playing");
  }
  initialize();
  return {duration,progress,pause};
})();