(() => {
  'use strict';
  // Separate, read-only offline neural manual-triage lane. Never posts review
  // decisions or interprets local crop verification as original-media proof.
  const pane = document.getElementById('suggestions');
  const original = document.getElementById('liveFolderSuggestionCards');
  if (!pane || !original || document.getElementById('localNeuralS9Triage')) return;
  const PREFIX = '/new/api/local-neural-manual-triage';
  const FINGERPRINT = /^[a-f0-9]{64}$/;
  const CLIP = /^motion_[0-9]{13}[.]mp4$/;
  const FOLDER = /^[A-Za-z0-9_-]{1,100}$/;
  const node = (tag, content, cls) => {
    const el = document.createElement(tag);
    if (content !== undefined) el.textContent = String(content);
    if (cls) el.className = cls;
    return el;
  };
  const section = node('section', undefined, 'local-neural-triage');
  section.id = 'localNeuralS9Triage';
  section.hidden = true;
  const heading = node('h3', 'Local ONNX neural triage · 49 pending S9 recordings');
  const notice = node('p', 'Uncertain visual comparison — manual review required. ' +
    'These head-region crops are geometric approximations and may be from different keyframes. ' +
    'This queue does not attest original-video review or save decisions.');
  const stats = node('p', 'Checking local verified data…', 'local-neural-stats');
  const grid = node('div', undefined, 'local-neural-list');
  section.append(heading, notice, stats, grid);
  original.insertAdjacentElement('afterend', section);

  const css = node('style');
  css.textContent = [
    '#localNeuralS9Triage{margin-top:22px;border-top:1px solid #496275;padding-top:18px}',
    '#localNeuralS9Triage .local-neural-stats{margin:8px 0 13px;color:#a7d6d5}',
    '#localNeuralS9Triage .local-neural-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,370px),1fr));gap:12px}',
    '#localNeuralS9Triage .local-neural-card{min-width:0;background:#172833;border:1px solid #456276;border-radius:12px;padding:12px}',
    '#localNeuralS9Triage .local-neural-card h4{font-size:12px;overflow-wrap:anywhere;margin:0 0 8px}',
    '#localNeuralS9Triage .local-neural-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
    '#localNeuralS9Triage figure{margin:0;min-width:0;background:#0e1c24;border:1px solid #385565;border-radius:8px;overflow:hidden}',
    '#localNeuralS9Triage img{width:100%;height:195px;object-fit:contain;background:#0b141e;display:block}',
    '#localNeuralS9Triage figcaption{padding:7px 8px;font-size:11px;min-height:38px}',
    '#localNeuralS9Triage .local-neural-card p{font-size:12px;line-height:1.5;margin:7px 0;color:#b2cbd2}',
    '#localNeuralS9Triage label{display:block;font-size:12px;margin:9px 0 4px}',
    '#localNeuralS9Triage select{max-width:100%;width:100%}',
    '#localNeuralS9Triage .local-neural-card.is-low{border-color:#675d49}',
    '#localNeuralS9Triage .local-neural-card.is-low .triage-band{color:#f2cf9a}',
    '#localNeuralS9Triage .local-neural-card .triage-band{color:#9ce4d1}',
    '#localNeuralS9Triage .assigned-roi-note{margin-top:12px;color:#b3d7de}'
  ].join('\n');
  document.head.append(css);
  function relay(){
    let current=window;
    for(let i=0;i<5;i++){
      try{
        if(current.C720PSecureRelay?.fetch && current.C720PSecureRelay?.url)
          return current.C720PSecureRelay;
        if(current===current.parent)break;
        current=current.parent;
      }catch(_){break}
    }
    throw Error('Authenticated Security Hub relay required');
  }
  function image(figure, path, caption, alt) {
    const img=node('img');
    img.loading='lazy'; img.decoding='async'; img.alt=alt;
    const note=node('figcaption',caption);
    figure.append(img,note);
    Promise.resolve(relay().url(path))
      .then(uri => {if(img.isConnected)img.src=uri})
      .catch(() => {img.remove();note.textContent=caption+' · unavailable'});
    img.addEventListener('error',() => {img.remove();note.textContent=caption+' · unavailable'}, {once:true});
    return figure;
  }
  function folderLabels() {
    const names=new Map();
    document.querySelectorAll('#savedList [data-folder-id]').forEach(el=>{
      const id=el.dataset.folderId;
      const title=el.querySelector('strong')?.textContent;
      if(FOLDER.test(String(id)) && title)names.set(id,title);
    });
    document.querySelectorAll('#liveFolderSuggestionCards select option').forEach(el=>{
      if(FOLDER.test(String(el.value)) && el.textContent)names.set(el.value,el.textContent);
    });
    return names;
  }
  function verify(doc) {
    if(!doc||doc.ok!==true||doc.schema!=='local-neural-manual-triage-v1'||
       doc.identity_matching!==false||doc.original_attestation!==false||
       doc.review_writes_enabled!==false||doc.automatic_assignments!==0||
       doc.threshold_filter_applied!==false||doc.count!==49||
       !Array.isArray(doc.items)||doc.items.length!==49||
       !Array.isArray(doc.folder_ids)||doc.folder_ids.length!==8||
       !Array.isArray(doc.assigned_s9_crops)||doc.assigned_s9_crops.length!==3)
      throw Error('Incomplete local neural triage source');
    const folders=new Set(doc.folder_ids);
    if(folders.size!==8||![...folders].every(f=>FOLDER.test(f)))
      throw Error('Invalid People A–Z reference folders');
    const seen=new Set();
    for(const item of doc.items) {
      if(item.source!=='sd'||!CLIP.test(String(item.clip_id))||
         !FINGERPRINT.test(String(item.image_id))||
         !FINGERPRINT.test(String(item.image_sha256))||
         item.identity_verified!==false||item.face_detected!==false||
         item.same_keyframe_verified!==false||
         item.automatic_identity_matching!==false||
         item.review_ticket_issued!==false||
         item.review_status!=='manual_triage_only'||
         !folders.has(item.folder_id)||!Number.isFinite(item.score)||
         item.score < -1 || item.score > 1 ||seen.has(item.clip_id))
        throw Error('Invalid source-bound S9 crop or pending recording');
      seen.add(item.clip_id);
    }
    for(const r of doc.assigned_s9_crops){
      if(r.source!=='sd'||!CLIP.test(String(r.clip_id))||
         !folders.has(r.folder_id)||!FINGERPRINT.test(String(r.image_id)))
        throw Error('Invalid assigned S9 reference');
    }
    return folders;
  }
  function card(row, choices, names, threshold) {
    const article=node('article',undefined,'local-neural-card'+(row.score<threshold?' is-low':''));
    article.append(node('h4',row.clip_id));
    const side=node('div',undefined,'local-neural-pair');
    side.append(image(node('figure'),
      '/new/saved/snap/'+encodeURIComponent(row.clip_id+'.thumb.jpg'),
      'Locally cached recording preview',
      'Cached S9 recording image for manual comparison'));
    side.append(image(node('figure'),PREFIX+'/image/'+row.image_id,
      'Geometric upper-25% region · not a face ID',
      'SHA-256-verified geometric upper-region crop from this S9 recording'));
    article.append(side);
    const band=row.score>=threshold?'Similarity above exploratory threshold':'Below threshold · still needs manual sorting';
    article.append(node('p',band+' · neural cosine '+row.score.toFixed(3),'triage-band'));
    const label=node('label','Editable suggested People A–Z folder');
    const dropdown=node('select');
    dropdown.setAttribute('aria-label','Manual-triage folder for '+row.clip_id);
    for(const id of choices){
      const opt=node('option',names.get(id)||('Folder '+id));
      opt.value=id;dropdown.append(opt);
    }
    dropdown.value=row.folder_id;
    label.append(dropdown);article.append(label);
    const status=node('p','Default is highest neural cosine, not an identity judgment. No decision has been saved.');
    dropdown.addEventListener('change',()=>{
      status.textContent='Local selection changed to '+(names.get(dropdown.value)||dropdown.value)+
        '. Not saved; use the existing original-recording review workflow to file the recording.';
    });
    article.append(status);
    return article;
  }
  function appendAssignedReferences(doc) {
    // Never replace selected human portrait. Add strictly contextual crops to
    // the corresponding People A–Z folder card when that card is present.
    const grouped=new Map();
    for(const item of doc.assigned_s9_crops){
      if(!grouped.has(item.folder_id))grouped.set(item.folder_id,[]);
      grouped.get(item.folder_id).push(item);
    }
    for(const [id,items] of grouped){
      const profile=[...document.querySelectorAll('#savedList [data-folder-id]')]
        .find(el=>el.dataset.folderId===id);
      if(!profile || profile.querySelector('.local-s9-assigned-crops'))continue;
      const wrap=node('span',undefined,'local-s9-assigned-crops');
      wrap.style.display='flex';wrap.style.gap='4px';wrap.style.marginTop='7px';
      for(const item of items){
        const thumb=node('img');
        thumb.alt='Assigned S9 geometric head-region reference; identity unverified';
        thumb.loading='lazy';thumb.style.width='45px';thumb.style.height='45px';
        thumb.style.objectFit='contain';thumb.style.borderRadius='5px';
        Promise.resolve(relay().url(PREFIX+'/image/'+item.image_id))
          .then(uri=>{if(thumb.isConnected)thumb.src=uri}).catch(()=>thumb.remove());
        wrap.append(thumb);
      }
      const desc=node('span','3 S9 geometric crops · identity unverified');
      desc.style.fontSize='10px';desc.style.color='#b6cbd2';
      wrap.append(desc);
      profile.append(wrap);
    }
  }
  let active=false;
  let lastData=null;
  async function load() {
    if(pane.hidden||active)return;
    active=true;section.hidden=false;
    stats.textContent='Verifying 52 local crop hashes and 49 pending neural comparisons…';
    try{
      const response=await relay().fetch(PREFIX,{cache:'no-store'});
      if(!response.ok)throw Error('Authenticated local triage API unavailable ('+response.status+')');
      const doc=await response.json();
      const folders=verify(doc);
      lastData=doc;
      const names=folderLabels();
      const q=.723596; // explicit exploratory LOO p25, never used to hide clips
      const above=doc.items.filter(r=>r.score>=q).length;
      stats.textContent=doc.count+' pending S9 recordings · '+above+' above exploratory '+q.toFixed(3)+
        ' cosine · '+(doc.count-above)+' below · all visible for manual sorting';
      grid.replaceChildren();
      for(const row of doc.items)grid.append(card(row,[...folders].sort(),names,q));
      appendAssignedReferences(doc);
    }catch(e){
      stats.textContent='Local neural triage unavailable: '+e.message+
        '. Existing reviewed Suggestions and original-video approval are unaffected.';
      grid.replaceChildren();
    }finally{active=false}
  }
  window.addEventListener('people-folder-suggestions-open',load);
  document.getElementById('refreshSuggestions')?.addEventListener('click',load);
  window.addEventListener('people-folder-refreshed',()=>{
    if(lastData)appendAssignedReferences(lastData);
  });
})();
