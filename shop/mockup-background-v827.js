(() => {
  'use strict';

  const BACKDROP = '#ded6ca';
  const TARGET = [222, 214, 202];
  const MAX_SIDE = 1600;
  const cache = new Map();
  const seen = new WeakSet();

  const isDirectMockup = raw => {
    try {
      const url = new URL(String(raw || ''), window.location.href);
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:'
        && (host === 'images.printify.com' || host.endsWith('.printify.com'))
        && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url.pathname + url.search);
    } catch {
      return false;
    }
  };

  const distSq = (r, g, b, ref) => {
    const dr = r - ref[0];
    const dg = g - ref[1];
    const db = b - ref[2];
    return dr * dr + dg * dg + db * db;
  };

  function cornerModel(data, width, height){
    const p = Math.max(8, Math.min(40, Math.floor(Math.min(width, height) * .035)));
    const boxes = [[0,0],[width-p,0],[0,height-p],[width-p,height-p]];
    const means = boxes.map(([x0,y0]) => {
      let r=0,g=0,b=0,n=0;
      for(let y=y0;y<y0+p;y+=2){
        for(let x=x0;x<x0+p;x+=2){
          const i=(y*width+x)*4;
          if(data[i+3] < 16) continue;
          r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++;
        }
      }
      return n ? [r/n,g/n,b/n] : [255,255,255];
    });
    const mean=[0,1,2].map(c=>means.reduce((s,m)=>s+m[c],0)/means.length);
    const light=(mean[0]+mean[1]+mean[2])/3;
    const spread=Math.max(...means.map(m=>Math.sqrt(distSq(m[0],m[1],m[2],mean))));
    return {mean,light,spread};
  }

  function replaceBorderBackground(imageData){
    const {data,width,height}=imageData;
    const model=cornerModel(data,width,height);
    if(model.light < 165 || model.spread > 70) return false;

    const threshold = model.light > 235 ? 58 : 45;
    const thresholdSq = threshold * threshold;
    const total=width*height;
    const visited=new Uint8Array(total);
    const queue=new Int32Array(total);
    let head=0,tail=0,matched=0;

    const matches=index=>{
      const i=index*4;
      if(data[i+3] < 12) return true;
      const max=Math.max(data[i],data[i+1],data[i+2]);
      const min=Math.min(data[i],data[i+1],data[i+2]);
      if(max-min > 48) return false;
      return distSq(data[i],data[i+1],data[i+2],model.mean) <= thresholdSq;
    };
    const enqueue=index=>{
      if(index<0||index>=total||visited[index]||!matches(index)) return;
      visited[index]=1;
      queue[tail++]=index;
    };

    for(let x=0;x<width;x++){enqueue(x);enqueue((height-1)*width+x);}
    for(let y=1;y<height-1;y++){enqueue(y*width);enqueue(y*width+width-1);}

    while(head<tail){
      const index=queue[head++]; matched++;
      const x=index%width, y=(index/width)|0;
      if(x>0) enqueue(index-1);
      if(x+1<width) enqueue(index+1);
      if(y>0) enqueue(index-width);
      if(y+1<height) enqueue(index+width);
    }

    const ratio=matched/total;
    if(ratio < .025 || ratio > .985) return false;
    for(let index=0;index<total;index++){
      if(!visited[index]) continue;
      const i=index*4;
      data[i]=TARGET[0]; data[i+1]=TARGET[1]; data[i+2]=TARGET[2]; data[i+3]=255;
    }
    return true;
  }

  async function transformedUrl(raw){
    if(!isDirectMockup(raw)) return raw;
    if(cache.has(raw)) return cache.get(raw);

    const task=(async()=>{
      const response=await fetch(raw,{mode:'cors',credentials:'omit',cache:'force-cache'});
      if(!response.ok) return raw;
      const blob=await response.blob();
      const bitmap=await createImageBitmap(blob);
      try{
        const scale=Math.min(1,MAX_SIDE/Math.max(bitmap.width,bitmap.height));
        const width=Math.max(1,Math.round(bitmap.width*scale));
        const height=Math.max(1,Math.round(bitmap.height*scale));
        const canvas=document.createElement('canvas');
        canvas.width=width; canvas.height=height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        if(!ctx) return raw;
        ctx.drawImage(bitmap,0,0,width,height);
        const imageData=ctx.getImageData(0,0,width,height);
        if(!replaceBorderBackground(imageData)) return raw;
        ctx.putImageData(imageData,0,0);
        const out=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.95));
        return out ? URL.createObjectURL(out) : raw;
      } finally { bitmap.close?.(); }
    })().catch(()=>raw);

    cache.set(raw,task);
    return task;
  }

  window.BRUIS_MATCH_MOCKUP_BACKGROUND = transformedUrl;

  async function process(img){
    if(seen.has(img)) return;
    const raw=String(img.currentSrc||img.src||'');
    if(!isDirectMockup(raw)) return;
    seen.add(img);
    const next=await transformedUrl(raw);
    if(next&&next!==raw){img.src=next;img.dataset.mockupBackground='matched';}
    else img.dataset.mockupBackground='preserved';
  }

  function scan(root=document){
    root.querySelectorAll?.('.mockup img').forEach(process);
  }

  function boot(){
    document.documentElement.style.setProperty('--shop-image-backdrop',BACKDROP);
    scan();
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1) return;
      if(node.matches?.('.mockup img')) process(node);
      scan(node);
    }))).observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
