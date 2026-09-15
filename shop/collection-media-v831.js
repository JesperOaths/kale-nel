(() => {
  'use strict';

  const TARGET = [222, 214, 202, 255];
  const SELECTOR = '.collection-image img, .compact-shape-card img';
  const MATCH_ASSET = /\/assets\/collection-(?:normal|boxy|merch-despinoza)\.(?:png|webp)(?:[?#]|$)/i;
  const cache = new Map();
  const seen = new WeakSet();

  const colorDistanceSq = (data, offset, mean) => {
    const dr = data[offset] - mean[0];
    const dg = data[offset + 1] - mean[1];
    const db = data[offset + 2] - mean[2];
    return dr * dr + dg * dg + db * db;
  };

  function edgeMean(data, width, height){
    const patch = Math.max(6, Math.min(24, Math.floor(Math.min(width, height) * .025)));
    const samples = [];
    const corners = [[0,0],[width-patch,0],[0,height-patch],[width-patch,height-patch]];
    for(const [x0,y0] of corners){
      for(let y=y0; y<y0+patch; y+=2){
        for(let x=x0; x<x0+patch; x+=2){
          const i=(y*width+x)*4;
          if(data[i+3] < 16) continue;
          samples.push([data[i],data[i+1],data[i+2]]);
        }
      }
    }
    if(!samples.length) return [255,255,255];
    return [0,1,2].map(c => samples.reduce((sum,v) => sum + v[c], 0) / samples.length);
  }

  function floodOuterBackground(imageData){
    const {data,width,height}=imageData;
    const mean=edgeMean(data,width,height);
    const lightness=(mean[0]+mean[1]+mean[2])/3;
    if(lightness < 220) return null;

    const threshold=34;
    const thresholdSq=threshold*threshold;
    const total=width*height;
    const visited=new Uint8Array(total);
    const queue=new Int32Array(total);
    let head=0,tail=0;

    const matches=index=>{
      const i=index*4;
      return data[i+3] < 16 || colorDistanceSq(data,i,mean) <= thresholdSq;
    };
    const enqueue=index=>{
      if(index<0 || index>=total || visited[index] || !matches(index)) return;
      visited[index]=1;
      queue[tail++]=index;
    };

    for(let x=0;x<width;x++){ enqueue(x); enqueue((height-1)*width+x); }
    for(let y=1;y<height-1;y++){ enqueue(y*width); enqueue(y*width+width-1); }

    while(head<tail){
      const index=queue[head++];
      const x=index%width;
      if(x>0) enqueue(index-1);
      if(x+1<width) enqueue(index+1);
      if(index>=width) enqueue(index-width);
      if(index+width<total) enqueue(index+width);
    }

    const ratio=tail/total;
    if(ratio < .08 || ratio > .965) return null;
    return visited;
  }

  function largestForegroundBox(mask,width,height){
    const total=width*height;
    const checked=new Uint8Array(total);
    const queue=new Int32Array(total);
    let best=null;

    for(let start=0; start<total; start++){
      if(mask[start] || checked[start]) continue;
      let head=0,tail=0,count=0;
      let minX=width,minY=height,maxX=-1,maxY=-1;
      checked[start]=1;
      queue[tail++]=start;
      while(head<tail){
        const index=queue[head++];
        count++;
        const x=index%width;
        const y=(index/width)|0;
        if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
        const visit=next=>{
          if(next<0 || next>=total || checked[next] || mask[next]) return;
          checked[next]=1; queue[tail++]=next;
        };
        if(x>0)visit(index-1);
        if(x+1<width)visit(index+1);
        if(y>0)visit(index-width);
        if(y+1<height)visit(index+width);
      }
      if(!best || count>best.count) best={count,minX,minY,maxX,maxY};
    }
    return best;
  }

  async function transform(raw){
    if(cache.has(raw)) return cache.get(raw);
    const task=(async()=>{
      const response=await fetch(raw,{cache:'force-cache'});
      if(!response.ok) return raw;
      const blob=await response.blob();
      const bitmap=await createImageBitmap(blob);
      try{
        const maxSide=1400;
        const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
        const sw=Math.max(1,Math.round(bitmap.width*scale));
        const sh=Math.max(1,Math.round(bitmap.height*scale));
        const source=document.createElement('canvas');
        source.width=sw; source.height=sh;
        const sctx=source.getContext('2d',{willReadFrequently:true});
        if(!sctx) return raw;
        sctx.drawImage(bitmap,0,0,sw,sh);
        const imageData=sctx.getImageData(0,0,sw,sh);
        const background=floodOuterBackground(imageData);
        if(!background) return raw;

        const box=largestForegroundBox(background,sw,sh);
        if(!box || box.count < sw*sh*.01) return raw;

        for(let index=0;index<background.length;index++){
          if(!background[index]) continue;
          const i=index*4;
          imageData.data[i]=TARGET[0];
          imageData.data[i+1]=TARGET[1];
          imageData.data[i+2]=TARGET[2];
          imageData.data[i+3]=255;
        }
        sctx.putImageData(imageData,0,0);

        const bw=box.maxX-box.minX+1;
        const bh=box.maxY-box.minY+1;
        const pad=Math.round(Math.max(bw,bh)*.09);
        const sx=Math.max(0,box.minX-pad);
        const sy=Math.max(0,box.minY-pad);
        const ex=Math.min(sw,box.maxX+1+pad);
        const ey=Math.min(sh,box.maxY+1+pad);
        const cw=ex-sx, ch=ey-sy;

        const out=document.createElement('canvas');
        out.width=800; out.height=700;
        const ctx=out.getContext('2d');
        if(!ctx) return raw;
        ctx.fillStyle='#ded6ca';
        ctx.fillRect(0,0,out.width,out.height);
        const fit=Math.min((out.width*.86)/cw,(out.height*.86)/ch);
        const dw=cw*fit, dh=ch*fit;
        const dx=(out.width-dw)/2, dy=(out.height-dh)/2;
        ctx.drawImage(source,sx,sy,cw,ch,dx,dy,dw,dh);
        const output=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
        return output ? URL.createObjectURL(output) : raw;
      } finally { bitmap.close?.(); }
    })().catch(()=>raw);
    cache.set(raw,task);
    return task;
  }

  async function processImage(img){
    if(seen.has(img)) return;
    const raw=img.getAttribute('src') || '';
    if(!MATCH_ASSET.test(raw)) return;
    seen.add(img);
    img.dataset.collectionMedia='processing-v831';
    const next=await transform(new URL(raw,location.href).href);
    if(next && next!==raw){
      img.src=next;
      img.dataset.collectionMedia='matched-v831';
    } else {
      img.dataset.collectionMedia='preserved-v831';
    }
  }

  function scan(root=document){
    root.querySelectorAll?.(SELECTOR).forEach(processImage);
  }

  const boot=()=>{
    scan(document);
    const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1) return;
      if(node.matches?.(SELECTOR)) processImage(node); else scan(node);
    })));
    observer.observe(document.body,{childList:true,subtree:true});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
  window.BRUIS_COLLECTION_MEDIA_V831=Object.freeze({backdrop:'#ded6ca',preservesWhiteGarment:true,cropsToLargestGarment:true});
})();
