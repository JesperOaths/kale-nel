(() => {
  'use strict';

  const MAX_SIDE=1800;
  const cache=new Map();
  const seen=new WeakSet();
  const isRaster=url=>/^https?:/i.test(url)&&/\.(?:jpe?g)(?:[?#]|$)/i.test(url);

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

    // Bridge sparse rows from nearby visible garment/artwork rows. This protects
    // white fabric even when some parts are almost the same RGB as the backdrop.
    for(let y=0;y<height;y++){
      if(right[y]>=left[y]) continue;
      let best=-1;
      for(let d=1;d<=Math.max(18,Math.floor(height*.035));d++){
        const a=y-d,b=y+d;
        if(a>=0&&right[a]>=left[a]){best=a;break;}
        if(b<height&&right[b]>=left[b]){best=b;break;}
      }
      if(best>=0){left[y]=left[best];right[y]=right[best];}
    }
    return {left,right};
  }

  function applyTransparency(imageData){
    const {data,width,height}=imageData;
    const stats=cornerStats(data,width,height);
    if(!stats||stats.lightness<185||stats.sigma>16) return false;

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
    return removed>width*height*.025;
  }

  async function transparentUrl(url){
    if(!isRaster(url)) return url;
    if(cache.has(url)) return cache.get(url);
    const task=(async()=>{
      const response=await fetch(url,{mode:'cors',credentials:'omit',cache:'force-cache'});
      if(!response.ok) return url;
      const blob=await response.blob();
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
        if(!applyTransparency(imageData)) return url;
        ctx.clearRect(0,0,width,height);
        ctx.putImageData(imageData,0,0);
        const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
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

  const intersection='IntersectionObserver' in window
    ? new IntersectionObserver(entries=>entries.forEach(entry=>{
        if(!entry.isIntersecting)return;
        intersection.unobserve(entry.target); processImage(entry.target);
      }),{rootMargin:'800px 0px'})
    : null;

  function scan(root=document){
    root.querySelectorAll?.('.mockup img').forEach(img=>{
      if(seen.has(img))return;
      if(intersection)intersection.observe(img);else processImage(img);
    });
  }

  const boot=()=>{
    scan(document);
    const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1)return;
      if(node.matches?.('.mockup img'))processImage(node);else scan(node);
    })));
    observer.observe(document.body,{childList:true,subtree:true});
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.BRUIS_TRANSPARENCY_V832=Object.freeze({allProductMockups:true,preservesWhiteGarments:true,tagViewIncluded:true});
})();
