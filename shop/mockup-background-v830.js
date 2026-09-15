(() => {
  'use strict';

  const BACKDROP = '#ded6ca';
  const TARGET = [222, 214, 202];
  const MAX_SIDE = 1600;
  const processed = new Map();
  const seen = new WeakSet();
  const DETAIL_RE = /(?:collar|close[ -]?up|neck|tag|label|detail|inside|inner)/i;

  const isRasterMockup = url => /^https?:/i.test(url) && /\.(?:jpe?g)(?:[?#]|$)/i.test(url);
  const shouldPreserve = (url, label = '') => DETAIL_RE.test(`${label} ${url}`);

  function distanceSq(data, offset, mean){
    const dr = data[offset] - mean[0];
    const dg = data[offset + 1] - mean[1];
    const db = data[offset + 2] - mean[2];
    return dr * dr + dg * dg + db * db;
  }

  function cornerStats(data, width, height){
    const patch = Math.max(8, Math.min(28, Math.floor(Math.min(width, height) * .022)));
    const corners = [[0,0],[width-patch,0],[0,height-patch],[width-patch,height-patch]];
    const samples = [];
    for(const [x0,y0] of corners){
      for(let y=y0; y<y0+patch; y+=2){
        for(let x=x0; x<x0+patch; x+=2){
          const i=(y*width+x)*4;
          samples.push([data[i],data[i+1],data[i+2]]);
        }
      }
    }
    if(!samples.length) return null;
    const mean=[0,1,2].map(c=>samples.reduce((s,v)=>s+v[c],0)/samples.length);
    let variance=0;
    for(const v of samples){
      variance += ((v[0]-mean[0])**2 + (v[1]-mean[1])**2 + (v[2]-mean[2])**2)/3;
    }
    return { mean, lightness:(mean[0]+mean[1]+mean[2])/3, sigma:Math.sqrt(variance/samples.length) };
  }

  function floodBackdrop(imageData){
    const {data,width,height}=imageData;
    const stats=cornerStats(data,width,height);
    if(!stats || stats.lightness < 188 || stats.sigma > 11) return false;

    const threshold=Math.max(6,Math.min(14,stats.sigma*2.2+4));
    const thresholdSq=threshold*threshold;
    const total=width*height;
    const visited=new Uint8Array(total);
    const queue=new Int32Array(total);
    let head=0,tail=0,matched=0;

    const matches=index=>distanceSq(data,index*4,stats.mean)<=thresholdSq;
    const enqueue=index=>{
      if(index<0 || index>=total || visited[index] || !matches(index)) return;
      visited[index]=1;
      queue[tail++]=index;
    };

    for(let x=0;x<width;x++){ enqueue(x); enqueue((height-1)*width+x); }
    for(let y=1;y<height-1;y++){ enqueue(y*width); enqueue(y*width+width-1); }

    while(head<tail){
      const index=queue[head++];
      matched++;
      const x=index%width;
      const y=(index/width)|0;
      if(x>0) enqueue(index-1);
      if(x+1<width) enqueue(index+1);
      if(y>0) enqueue(index-width);
      if(y+1<height) enqueue(index+width);
    }

    const ratio=matched/total;
    if(ratio < .08 || ratio > .78) return false;

    // A white garment can be nearly identical to a white studio background. If
    // edge flood-fill leaks into the central garment area, reject the entire
    // transformation instead of recolouring the shirt as background.
    const probeXs=[.34,.50,.66];
    const probeYs=[.34,.50,.66];
    let centralHits=0;
    for(const px of probeXs){
      for(const py of probeYs){
        const x=Math.min(width-1,Math.max(0,Math.round((width-1)*px)));
        const y=Math.min(height-1,Math.max(0,Math.round((height-1)*py)));
        if(visited[y*width+x]) centralHits++;
      }
    }
    if(centralHits >= 4) return false;

    for(let index=0;index<total;index++){
      if(!visited[index]) continue;
      const i=index*4;
      data[i]=TARGET[0]; data[i+1]=TARGET[1]; data[i+2]=TARGET[2];
    }
    return true;
  }

  async function transformedUrl(url, label=''){
    if(!isRasterMockup(url) || shouldPreserve(url,label)) return url;
    const key=`${url}\n${label}`;
    if(processed.has(key)) return processed.get(key);
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
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context) return url;
        context.drawImage(bitmap,0,0,width,height);
        const imageData=context.getImageData(0,0,width,height);
        if(!floodBackdrop(imageData)) return url;
        context.putImageData(imageData,0,0);
        const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        return output ? URL.createObjectURL(output) : url;
      } finally { bitmap.close?.(); }
    })().catch(()=>url);
    processed.set(key,task);
    return task;
  }

  window.BRUIS_MATCH_MOCKUP_BACKGROUND=(url,meta={})=>transformedUrl(url,String(meta?.label||''));

  async function matchImage(img){
    if(seen.has(img)) return;
    const raw=img.currentSrc||img.src||'';
    const label=img.closest('.mockup')?.querySelector('figcaption')?.textContent?.trim()||'';
    if(!isRasterMockup(raw)) return;
    seen.add(img);
    if(shouldPreserve(raw,label)){
      img.dataset.mockupBackground='preserved-detail';
      return;
    }
    img.dataset.mockupBackground='processing';
    const next=await transformedUrl(raw,label);
    if(next!==raw){
      img.src=next;
      img.dataset.mockupBackground='matched-safe';
    } else {
      img.dataset.mockupBackground='preserved';
    }
  }

  const intersection='IntersectionObserver' in window
    ? new IntersectionObserver(entries=>entries.forEach(entry=>{
        if(!entry.isIntersecting) return;
        intersection.unobserve(entry.target);
        matchImage(entry.target);
      }),{rootMargin:'600px 0px'})
    : null;

  function observe(root=document){
    root.querySelectorAll?.('.mockup img').forEach(img=>{
      if(seen.has(img)) return;
      if(intersection) intersection.observe(img); else matchImage(img);
    });
  }

  const boot=()=>{
    document.documentElement.style.setProperty('--shop-image-backdrop',BACKDROP);
    observe(document);
    const mutation=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1) return;
      if(node.matches?.('.mockup img')) observe(node.parentElement||node); else observe(node);
    })));
    mutation.observe(document.body,{childList:true,subtree:true});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
