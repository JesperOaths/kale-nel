(() => {
  'use strict';

  const MAX_SIDE=1400;
  const MAX_CONCURRENT=4;
  const cache=new Map();
  const seen=new WeakSet();
  const queued=new WeakSet();
  const pending=[];
  let active=0;
  const isRaster=url=>/^https?:/i.test(url);

  function distanceSq(data,offset,mean){
    const dr=data[offset]-mean[0], dg=data[offset+1]-mean[1], db=data[offset+2]-mean[2];
    return dr*dr+dg*dg+db*db;
  }

  function cornerStats(data,width,height){
    const patch=Math.max(8,Math.min(30,Math.floor(Math.min(width,height)*.025)));
    const samples=[];
    for(const [x0,y0] of [[0,0],[width-patch,0],[0,height-patch],[width-patch,height-patch]]){
      for(let y=y0;y<y0+patch;y+=2){
        for(let x=x0;x<x0+patch;x+=2){
          const i=(y*width+x)*4;
          if(data[i+3]<16) continue;
          samples.push([data[i],data[i+1],data[i+2]]);
        }
      }
    }
    if(!samples.length) return null;
    const mean=[0,1,2].map(c=>samples.reduce((s,v)=>s+v[c],0)/samples.length);
    let variance=0;
    for(const v of samples) variance+=((v[0]-mean[0])**2+(v[1]-mean[1])**2+(v[2]-mean[2])**2)/3;
    return {mean,lightness:(mean[0]+mean[1]+mean[2])/3,sigma:Math.sqrt(variance/samples.length)};
  }

  function floodMask(imageData,stats,threshold){
    const {data,width,height}=imageData;
    const total=width*height;
    const visited=new Uint8Array(total);
    const queue=new Int32Array(total);
    const limit=threshold*threshold;
    let head=0,tail=0;
    const matches=index=>{
      const i=index*4;
      return data[i+3]<16||distanceSq(data,i,stats.mean)<=limit;
    };
    const add=index=>{
      if(index<0||index>=total||visited[index]||!matches(index)) return;
      visited[index]=1; queue[tail++]=index;
    };
    for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
    for(let y=1;y<height-1;y++){add(y*width);add(y*width+width-1);}
    while(head<tail){
      const index=queue[head++], x=index%width, y=(index/width)|0;
      if(x>0)add(index-1); if(x+1<width)add(index+1);
      if(y>0)add(index-width); if(y+1<height)add(index+width);
    }
    return {mask:visited,ratio:tail/total};
  }

  function centralHits(mask,width,height){
    let hits=0;
    for(const px of [.32,.5,.68]) for(const py of [.30,.48,.66]){
      const x=Math.round((width-1)*px), y=Math.round((height-1)*py);
      if(mask[y*width+x]) hits++;
    }
    return hits;
  }

  function subjectSpans(imageData,stats){
    const {data,width,height}=imageData;
    const strong=Math.max(18,stats.sigma*3+12);
    const strongSq=strong*strong;
    const left=new Int32Array(height); left.fill(width);
    const right=new Int32Array(height); right.fill(-1);

    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const i=(y*width+x)*4;
        if(data[i+3]<16) continue;
        if(distanceSq(data,i,stats.mean)>strongSq){
          if(x<left[y])left[y]=x;
          if(x>right[y])right[y]=x;
        }
      }
    }

    // Bridge sparse rows only when there is real subject signal both above and
    // below the row. The previous one-sided copy extended the protected garment
    // span beyond the shirt and preserved vertical bars / rectangular garbage.
    const sourceLeft=new Int32Array(left);
    const sourceRight=new Int32Array(right);
    for(let y=0;y<height;y++){
      if(right[y]>=left[y]) continue;
      let above=-1, below=-1;
      for(let d=1;d<=Math.max(18,Math.floor(height*.035));d++){
        if(above<0&&y-d>=0&&sourceRight[y-d]>=sourceLeft[y-d]) above=y-d;
        if(below<0&&y+d<height&&sourceRight[y+d]>=sourceLeft[y+d]) below=y+d;
        if(above>=0&&below>=0) break;
      }
      if(above>=0&&below>=0){
        left[y]=Math.min(sourceLeft[above],sourceLeft[below]);
        right[y]=Math.max(sourceRight[above],sourceRight[below]);
      }
    }
    return {left,right};
  }

  function alphaBounds(imageData){
    const {data,width,height}=imageData;
    let opaque=0,minX=width,minY=height,maxX=-1,maxY=-1,edgeOpaque=0,bottomOpaque=0;
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const alpha=data[(y*width+x)*4+3];
        if(alpha<=16) continue;
        opaque++;
        if(x<minX) minX=x; if(x>maxX) maxX=x;
        if(y<minY) minY=y; if(y>maxY) maxY=y;
        if(x<4||y<4||x>width-5||y>height-5) edgeOpaque++;
        if(y>height*.82) bottomOpaque++;
      }
    }
    return {opaque,minX,minY,maxX,maxY,edgeOpaque,bottomOpaque,ratio:opaque/(width*height)};
  }

  function cropBounds(imageData){
    const {width,height}=imageData;
    const b=alphaBounds(imageData);
    if(!b.opaque||b.maxX<b.minX||b.maxY<b.minY) return null;
    const pad=Math.max(6,Math.round(Math.max(width,height)*.025));
    const x=Math.max(0,b.minX-pad);
    const y=Math.max(0,b.minY-pad);
    const right=Math.min(width-1,b.maxX+pad);
    const bottom=Math.min(height-1,b.maxY+pad);
    return {x,y,width:right-x+1,height:bottom-y+1};
  }

  function hasUsefulTransparency(imageData){
    const b=alphaBounds(imageData);
    return b.opaque>0 && b.ratio<.985 && b.edgeOpaque===0;
  }

  function outputLooksSafe(imageData){
    const {width,height}=imageData;
    const b=alphaBounds(imageData);
    if(b.ratio<.08||b.ratio>.82) return false;
    if(b.edgeOpaque>0) return false;
    if(b.maxY>=height-4) return false;
    if(b.bottomOpaque/(width*height)>.035) return false;
    return true;
  }

  function applyTransparency(imageData){
    const {data,width,height}=imageData;
    const stats=cornerStats(data,width,height);
    if(!stats||stats.sigma>18) return false;

    const initial=Math.max(5,Math.min(14,stats.sigma*2+5));
    const attempts=[initial,10,7,5,3].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>b-a);
    let chosen=null;
    for(const threshold of attempts){
      const candidate=floodMask(imageData,stats,threshold);
      if(candidate.ratio<.04||candidate.ratio>.96) continue;
      const hits=centralHits(candidate.mask,width,height);
      if(!chosen||hits<chosen.hits||(hits===chosen.hits&&candidate.ratio>chosen.ratio)) chosen={...candidate,hits};
      if(hits<=2) break;
    }
    if(!chosen) return false;

    const spans=subjectSpans(imageData,stats);
    const margin=Math.max(3,Math.round(width*.008));
    let removed=0;
    for(let index=0;index<chosen.mask.length;index++){
      if(!chosen.mask[index]) continue;
      const x=index%width, y=(index/width)|0;
      const l=spans.left[y], r=spans.right[y];
      const protectedRow=r>=l && x>=Math.max(0,l-margin) && x<=Math.min(width-1,r+margin);
      if(protectedRow) continue;
      data[index*4+3]=0;
      removed++;
    }
    return removed>width*height*.025&&outputLooksSafe(imageData);
  }

  async function transparentUrl(url){
    if(!isRaster(url)) return url;
    if(cache.has(url)) return cache.get(url);
    const task=(async()=>{
      const response=await fetch(url,{mode:'cors',credentials:'omit',cache:'force-cache'});
      if(!response.ok) return url;
      const blob=await response.blob();
      // Catalog URLs are image sources even when Printify/S3 omits a filename
      // extension or a useful Content-Type. createImageBitmap is the authority.
      const bitmap=await createImageBitmap(blob);
      try{
        const scale=Math.min(1,MAX_SIDE/Math.max(bitmap.width,bitmap.height));
        const width=Math.max(1,Math.round(bitmap.width*scale));
        const height=Math.max(1,Math.round(bitmap.height*scale));
        const canvas=document.createElement('canvas');
        canvas.width=width; canvas.height=height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        if(!ctx) return url;
        ctx.drawImage(bitmap,0,0,width,height);
        const imageData=ctx.getImageData(0,0,width,height);
        const alreadyTransparent=hasUsefulTransparency(imageData);
        const changed=alreadyTransparent ? false : applyTransparency(imageData);
        if(!changed&&!alreadyTransparent) return url;

        ctx.clearRect(0,0,width,height);
        ctx.putImageData(imageData,0,0);

        const bounds=cropBounds(imageData);
        let outputCanvas=canvas;
        if(bounds && (bounds.width<width*.97 || bounds.height<height*.97)){
          const cropped=document.createElement('canvas');
          cropped.width=bounds.width;
          cropped.height=bounds.height;
          const cropCtx=cropped.getContext('2d');
          if(cropCtx){
            cropCtx.clearRect(0,0,cropped.width,cropped.height);
            cropCtx.drawImage(canvas,bounds.x,bounds.y,bounds.width,bounds.height,0,0,bounds.width,bounds.height);
            outputCanvas=cropped;
          }
        }

        const output=await new Promise(resolve=>outputCanvas.toBlob(resolve,'image/png'));
        return output?URL.createObjectURL(output):url;
      } finally { bitmap.close?.(); }
    })().catch(()=>url);
    cache.set(url,task);
    return task;
  }

  window.BRUIS_MAKE_MOCKUP_TRANSPARENT_V832=url=>transparentUrl(String(url||''));

  async function processImage(img){
    if(seen.has(img)) return;
    const raw=img.currentSrc||img.src||'';
    if(!isRaster(raw)) return;
    seen.add(img);
    img.dataset.mockupTransparency='processing-v832';
    const next=await transparentUrl(raw);
    if(next!==raw){
      img.src=next;
      img.dataset.mockupTransparency='transparent-v832';
    }else{
      img.dataset.mockupTransparency='preserved-safe-v832';
    }
  }

  function pump(){
    while(active<MAX_CONCURRENT&&pending.length){
      const img=pending.shift();
      if(!img||seen.has(img)) continue;
      active++;
      processImage(img).finally(()=>{
        active--;
        pump();
      });
    }
  }

  function enqueue(img){
    if(!img||seen.has(img)||queued.has(img)) return;
    queued.add(img);
    img.dataset.mockupTransparency='queued-v869';
    pending.push(img);
    pump();
  }

  function scan(root=document){
    root.querySelectorAll?.('.mockup img').forEach(enqueue);
  }

  const boot=()=>{
    // v869 deliberately starts every currently rendered product image immediately.
    scan(document);
    const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1)return;
      if(node.matches?.('.mockup img'))enqueue(node);else scan(node);
    })));
    observer.observe(document.body,{childList:true,subtree:true});
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.BRUIS_TRANSPARENCY_V832=Object.freeze({allProductMockups:true,eager:true,maxConcurrent:MAX_CONCURRENT,cropsTransparentWhitespace:true,preservesWhiteGarments:true,tagViewIncluded:true,safeFallbackToOriginal:true,noOneSidedSpanBridge:true});
})();
