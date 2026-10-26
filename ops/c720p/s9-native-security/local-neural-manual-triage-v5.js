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
  // Deliberately no server writes: only explicitly changed local dropdown
  // choices are stored in this browser. Recomputed model defaults are not.
  const STORE='c720p.neural-manual-drafts.v2.ee5717ad7a90cf0c';
  function readDrafts(){
    try{
      const saved=JSON.parse(window.localStorage.getItem(STORE)||'{}');
      const entries=saved?.version===2&&saved.entries&&
        typeof saved.entries==='object'&&!Array.isArray(saved.entries)?saved.entries:{};
      return Object.fromEntries(Object.entries(entries).filter(([clip,id])=>
        CLIP.test(clip)&&FOLDER.test(String(id))));
    }catch(_){return {}}
  }
  const drafts=readDrafts();
  function persistDrafts(){
    try{
      window.localStorage.setItem(STORE,JSON.stringify({version:2,entries:drafts}));
      return true;
    }catch(_){return false}
  }
  const changed=row=>typeof drafts[row.clip_id]==='string'&&
    drafts[row.clip_id]!==row.folder_id;
  const node = (tag, content, cls) => {
    const el = document.createElement(tag);
    if (content !== undefined) el.textContent = String(content);
    if (cls) el.className = cls;
    return el;
  };
  const section = node('section', undefined, 'local-neural-triage');
  section.id = 'localNeuralS9Triage';
  section.hidden = true;
  const heading = node('h3', 'Local ONNX neural triage · pending S9 recordings');
  const notice = node('p', 'Uncertain visual comparison — manual review required. ' +
    'These head-region crops are geometric approximations and may be from different keyframes. ' +
    'This queue does not attest original-video review or save decisions.');
  const stats = node('p', 'Checking local verified data…', 'local-neural-stats');
  const grid = node('div', undefined, 'local-neural-list');
  const controls = node('div', undefined, 'local-neural-controls');
  const search = node('input');search.type='search';
  search.placeholder='Search recording or folder';
  search.setAttribute('aria-label','Search pending S9 recordings');
  const filter=node('select');
  filter.setAttribute('aria-label','Filter S9 comparison cards');
  for(const [value,label] of [['all','All 49 clips'],['higher','Higher similarity'],
    ['lower','Lower similarity'],['draft','My local draft changes']]){
    const option=node('option',label);option.value=value;filter.append(option);
  }
  const clear=node('button','Clear local drafts');clear.type='button';
  const exportDrafts=node('button','Copy draft CSV');exportDrafts.type='button';
  const toReview=node('button','Open Review recordings');toReview.type='button';
  const feedback=node('p','Draft selections stay in this browser only; they are not filed.');
  feedback.setAttribute('role','status');
  controls.append(search,filter,clear,exportDrafts,toReview);
  section.append(heading, notice, stats, controls, feedback, grid);
  original.insertAdjacentElement('beforebegin', section);

  const css = node('style');
  css.textContent = [
    '#localNeuralS9Triage{margin-top:22px;border-top:1px solid #496275;padding-top:18px}',
    '#localNeuralS9Triage .local-neural-stats{margin:8px 0 13px;color:#a7d6d5}',
    '#localNeuralS9Triage .local-neural-controls{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}',
    '#localNeuralS9Triage .local-neural-controls input{flex:2 1 210px;min-width:130px}',
    '#localNeuralS9Triage .local-neural-controls select{flex:1 1 170px}',
    '#localNeuralS9Triage .local-neural-controls button{font-size:12px;min-height:38px}',
    '#localNeuralS9Triage .local-neural-card .draft-choice{color:#f2cf9a;font-weight:650}',
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
       doc.threshold_filter_applied!==false||!Number.isInteger(doc.count)||doc.count<0||doc.count>52||
       !Array.isArray(doc.items)||doc.items.length!==doc.count||
       !Array.isArray(doc.folder_ids)||doc.folder_ids.length<1||doc.folder_ids.length>100||
       !Array.isArray(doc.assigned_s9_crops)||
       !Number.isInteger(doc.assigned_s9_count)||
       doc.assigned_s9_crops.length!==doc.assigned_s9_count||
       doc.indexed_crop_count!==52||doc.count+doc.assigned_s9_count!==52||
       !Number.isInteger(doc.reference_count)||doc.reference_count<1||doc.reference_count>92)
      throw Error('Incomplete local neural triage source');
    const folders=new Set(doc.folder_ids);
    if(folders.size!==doc.folder_ids.length||![...folders].every(f=>FOLDER.test(f)))
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
         !folders.has(r.folder_id)||!FINGERPRINT.test(String(r.image_id))||
         (r.folder_ids!==undefined&&(!Array.isArray(r.folder_ids)||
           r.folder_ids.length<1||r.folder_ids.length>8||
           r.folder_ids[0]!==r.folder_id||
           r.folder_ids.some(fid=>!folders.has(fid)))))
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
    dropdown.value=changed(row)?drafts[row.clip_id]:row.folder_id;
    label.append(dropdown);article.append(label);
    const status=node('p',changed(row)?
      'Browser-only draft restored. NOT reviewed or filed.':
      'Top-cosine default is not an identity judgment. Nothing filed.',
      changed(row)?'draft-choice':'');
    dropdown.addEventListener('change',()=>{
      if(dropdown.value===row.folder_id)delete drafts[row.clip_id];
      else drafts[row.clip_id]=dropdown.value;
      const stored=persistDrafts();
      status.className=changed(row)?'draft-choice':'';
      status.textContent=changed(row)?
        (stored?'Draft saved in this browser only. NOT filed.':
          'Draft changed in this view only. NOT filed.'):
        'Returned to suggestion. No decision filed.';
      updateStats();
    });
    article.append(status);
    const copyClip=node('button','Copy recording ID');copyClip.type='button';
    copyClip.addEventListener('click',async()=>{
      try{
        if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(row.clip_id);
        status.textContent='Recording ID copied. Find it in Review recordings for verified filing.';
      }catch(_){status.textContent='Recording ID: '+row.clip_id+' · copy manually for Review recordings.'}
    });
    article.append(copyClip);
    const reviewThis=node('button','▶ Review this recording');
    reviewThis.type='button';
    reviewThis.setAttribute('aria-label','Review original S9 recording '+row.clip_id);
    reviewThis.addEventListener('click',()=>{
      // A user explicitly requests original playback. Never preissue a
      // review ticket or convert a draft folder into a saved assignment.
      window.dispatchEvent(new CustomEvent('people-neural-review-target',{
        detail:{source:'sd',clip_id:row.clip_id}
      }));
      status.textContent='Opening original S9 recording in Review. Inspect the video before filing.';
    });
    article.append(reviewThis);
    return article;
  }
  function appendAssignedReferences(doc) {
    // Never replace selected human portrait. Add strictly contextual crops to
    // the corresponding People A–Z folder card when that card is present.
    const grouped=new Map();
    for(const item of doc.assigned_s9_crops){
      const ids=Array.isArray(item.folder_ids)?item.folder_ids:[item.folder_id];
      for(const fid of ids){
        if(!grouped.has(fid))grouped.set(fid,[]);
        grouped.get(fid).push(item);
      }
    }
    for(const profile of document.querySelectorAll('#savedList [data-folder-id]')){
      if(!grouped.has(profile.dataset.folderId))
        profile.querySelector('.local-s9-assigned-crops')?.remove();
    }
    for(const [id,items] of grouped){
      const profile=[...document.querySelectorAll('#savedList [data-folder-id]')]
        .find(el=>el.dataset.folderId===id);
      if(!profile)continue;
      const current=profile.querySelector('.local-s9-assigned-crops');
      const revision=items.map(item=>item.clip_id+':'+item.image_id).join('|');
      if(current?.dataset.revision===revision)continue;
      const wrap=node('span',undefined,'local-s9-assigned-crops');
      wrap.dataset.revision=revision;
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
      const desc=node('span',items.length+' S9 geometric crop'+(items.length===1?'':'s')+' · identity unverified');
      desc.style.fontSize='10px';desc.style.color='#b6cbd2';
      wrap.append(desc);
      if(current)current.replaceWith(wrap);
      else profile.append(wrap);
    }
  }
  let active=false;
  let lastData=null;
  const q=.723596; // exploratory held-out p25, never used to hide clips by default
  let availableFolders=new Set();
  function viewRows(){
    if(!lastData)return [];
    const term=search.value.trim().toLowerCase();
    const names=folderLabels();
    return lastData.items.filter(row=>{
      if(filter.value==='higher'&&row.score<q)return false;
      if(filter.value==='lower'&&row.score>=q)return false;
      if(filter.value==='draft'&&!changed(row))return false;
      const folder=changed(row)?drafts[row.clip_id]:row.folder_id;
      return !term||row.clip_id.toLowerCase().includes(term)||
        String(names.get(folder)||folder).toLowerCase().includes(term);
    });
  }
  function updateStats(){
    if(!lastData)return;
    const shown=viewRows().length;
    const above=lastData.items.filter(row=>row.score>=q).length;
    const draftCount=lastData.items.filter(changed).length;
    stats.textContent=shown+' shown / '+lastData.count+' pending S9 · '+above+
      ' higher similarity · '+(lastData.count-above)+' lower similarity · '+
      draftCount+' browser-only draft choices · none filed';
  }
  function renderFiltered(){
    if(!lastData)return;
    const names=folderLabels();
    grid.replaceChildren();
    for(const row of viewRows())grid.append(card(row,[...availableFolders].sort(),names,q));
    if(!grid.childElementCount)
      grid.append(node('p','Nothing matches this search or filter. All '+lastData.count+' pending clips remain available.'));
    updateStats();
  }
  search.addEventListener('input',renderFiltered);
  filter.addEventListener('change',renderFiltered);
  clear.addEventListener('click',()=>{
    for(const key of Object.keys(drafts))delete drafts[key];
    feedback.textContent=persistDrafts()?'Browser-only drafts cleared.':'Drafts cleared for this view.';
    renderFiltered();
  });
  exportDrafts.addEventListener('click',async()=>{
    if(!lastData){feedback.textContent='Load Suggestions before copying local drafts.';return}
    const edited=lastData.items.filter(changed);
    if(!edited.length){feedback.textContent='No manually changed draft choices to copy.';return}
    const lines=['source,clip_id,draft_folder_id,decision_saved,review_basis'];
    for(const row of edited)
      lines.push('sd,'+row.clip_id+','+drafts[row.clip_id]+',false,none');
    try{
      if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(lines.join('\n'));
      feedback.textContent=edited.length+' local draft rows copied; no decisions saved.';
    }catch(_){feedback.textContent='Clipboard unavailable; drafts remain local to this browser.'}
  });
  toReview.addEventListener('click',()=>{
    const tab=document.querySelector('[data-pane="review"]');
    if(tab)tab.click();
    else feedback.textContent='Open the Review recordings tab to inspect the original media.';
  });

  async function load() {
    if(pane.hidden||active)return;
    active=true;section.hidden=false;
    stats.textContent='Verifying 52 indexed local crops and the current pending neural queue…';
    try{
      const response=await relay().fetch(PREFIX,{cache:'no-store'});
      if(!response.ok)throw Error('Authenticated local triage API unavailable ('+response.status+')');
      const doc=await response.json();
      const folders=verify(doc);
      lastData=doc;
      availableFolders=folders;
      // Reviewed clips are no longer pending: discard their obsolete local
      // draft choices instead of reviving them if someone later unassigns.
      const live=new Set(doc.items.map(row=>row.clip_id));
      let pruned=false;
      for(const key of Object.keys(drafts)){
        if(!live.has(key)||!folders.has(drafts[key])){
          delete drafts[key];pruned=true;
        }
      }
      if(pruned)persistDrafts();
      renderFiltered();
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
  // People A–Z loads first: show the three contextual S9 crops even before
  // visiting Suggestions, without showing the 49 pending-candidate cards.
  Promise.resolve().then(async()=>{
    const response=await relay().fetch(PREFIX,{cache:'no-store'});
    if(!response.ok)return;
    const doc=await response.json();
    const folders=verify(doc);
    lastData=doc;availableFolders=folders;
    appendAssignedReferences(doc);
  }).catch(()=>{});
  const savedList=document.getElementById('savedList');
  if(savedList&&typeof MutationObserver==='function'){
    new MutationObserver(()=>{
      if(lastData)appendAssignedReferences(lastData);
    }).observe(savedList,{childList:true});
  }
})();
