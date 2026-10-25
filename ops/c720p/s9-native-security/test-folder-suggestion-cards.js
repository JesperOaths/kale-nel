#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.disabled = false;
    this._text = '';
    this.attributes = {};
    this.handlers = new Map();
  }
  set textContent(v) { this._text=String(v); this.children=[]; }
  get textContent() { return this._text + this.children.map(x=>x.textContent).join(''); }
  set className(v) { this.classNameValue=v; }
  setAttribute(k,v) {this.attributes[k]=v;}
  replaceChildren(...nodes) {this.children=nodes;}
  append(...nodes) {this.children.push(...nodes);}
  addEventListener(type,fn) {this.handlers.set(type,fn);}
  async click() {if(this.disabled)return;const handler=this.handlers.get('click');if(handler)await handler();}
  querySelector(selector) {
    if(selector==='[data-review-status]' && 'data-review-status' in this.attributes)return this;
    for(const child of this.children){const found=child.querySelector(selector);if(found)return found}
    return null;
  }
  findButtons() {
    return [...(this.tagName==='button'?[this]:[]),
            ...this.children.flatMap(c=>c.findButtons())];
  }
}
const context={window:{},document:{createElement:t=>new Element(t)},
               console,Promise,setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'folder-suggestion-cards-v1.js'),'utf8'),
                   context,{filename:'folder-suggestion-cards-v1.js'});
const cards=context.window.FolderSuggestionCards;
assert(cards && typeof cards.connect==='function');
const doc={
 schema:'folder_suggestions_v1',status:'human_review_only',
 automatic_assignments:0,identity_probabilities:false,probabilities:false,
 historic_review_index_verified:true,journal_revision:3,
 matches:[{
  state:'pending_review',human_review_required:true,verified_same_group:false,verified_same_person:false,
  confidence_is_probability:false,
  automatically_assigned:false,confidence_is_identity_probability:false,
  folder_id:'F1',source:'sd',clip_id:'clip.mp4',
  source_qualified_clip_id:'sd:clip.mp4',
  media_sha256:'a'.repeat(64),media_revision:'r1',
  suggestion_confidence:87.6,score:.615,
  centroid_score:.6,exemplar_score:.625,negative_penalty:0,
  upper_crop_score:.67,visual_score:.49,color_score:null
 }],
 provisional_clusters:[{
  id:'awaiting-review-0123456789abcdef',member_count:2,
  source_qualified_clips:['sd:clip2.mp4','sd:clip3.mp4'],
  members:['clip2.mp4','clip3.mp4'].map(name=>({
    source:'sd',clip_id:name,source_qualified_clip_id:'sd:'+name,
    media_sha256:'a'.repeat(64),media_revision:'r1',
    state:'pending_review',human_review_required:true
  })),
  state:'pending_review',human_review_required:true,automatically_assigned:false
 }],
 folder_options:[{id:'F1',label:'Person one'},{id:'F2',label:'Person two'}]
};
(async()=>{
 const host=new Element('section');
 let approved=0,opened=0,saved=0;
 const first=cards.render(host,doc,{
   onOpen:async row=>{opened++;return {
     verified:true,media_sha256:row.media_sha256,media_revision:row.media_revision,
     opened_ticket:'signed-original-open-ticket-123'
   }},
   onApprove:async()=>{approved++;return{
     persisted:true,media_verified:true,status:'approved'}},
   onReject:async()=>{throw Error('unexpected reject')},
   onSaved:()=>saved++
 });
 assert.equal(first.visible,1);
 assert.equal(first.provisional_groups,1);
 const card=host.children.find(c=>c.tagName==='article');
 const buttons=card.findButtons();
 assert.equal(buttons.length,3);
 assert.equal(buttons[1].disabled,true);
 await buttons[1].click();
 assert.equal(approved,0,'Cannot approve before opening original');
 await buttons[0].click();
 assert.equal(opened,1);
 assert.equal(buttons[1].disabled,false);
 await buttons[1].click();
 assert.equal(approved,1);
 assert.equal(saved,1);
 assert.equal(buttons[1].disabled,true);
 assert.equal(buttons[2].disabled,true);
 await buttons[0].click();
 assert.equal(buttons[1].disabled,true,'Saved approval stays locked after replay');
 assert.equal(buttons[2].disabled,true,'Saved rejection stays locked after replay');
 const unboundHost=new Element('section');
 cards.render(unboundHost,doc,{
   onOpen: async row=>({verified:true,media_sha256:row.media_sha256,
     media_revision:row.media_revision}),
   onApprove: async()=>{throw Error('must not approve without ticket')},
   onReject: async()=>{throw Error('must not reject without ticket')}
 });
 const unboundButtons=unboundHost.children.find(c=>c.tagName==='article').findButtons();
 await unboundButtons[0].click();
 assert.equal(unboundButtons[1].disabled,true,'Missing ticket must keep approval locked');
 assert.equal(unboundButtons[2].disabled,true,'Missing ticket must keep rejection locked');
 const provisional=host.children.find(c=>c.tagName==='section');
 assert(provisional,'Provisional group must be visible');
 const seedCard=provisional.children.find(c=>c.tagName==='article');
 assert(seedCard,'Each provisional original must offer an individual review');
 const seedButtons=seedCard.findButtons();
 assert.equal(seedButtons.length,3);
 // Provisional seed must remain locked until the actual original is attested.
 assert.equal(seedButtons[1].disabled,true);
 await seedButtons[1].click();
 assert.equal(approved,1,'No unverified automatic folder seed');
 await seedButtons[0].click();
 assert.equal(seedButtons[1].disabled,false,'Signed playback unlocks manual approval');
 await seedButtons[1].click();
 assert.equal(approved,2,'Explicit human approval seeds the selected folder');
 assert.equal(saved,2);
 assert.equal(seedButtons[1].disabled,true);
 const wrongProofHost=new Element('section');
 cards.render(wrongProofHost,doc,{
   onOpen: async row=>({verified:true,media_sha256:'f'.repeat(64),
     media_revision:row.media_revision,opened_ticket:'signed-original-open-ticket-123'}),
   onApprove: async()=>{throw Error('unexpected unverified seed')},
   onReject: async()=>{throw Error('unexpected unverified rejection')}
 });
 const wrongCard=wrongProofHost.children.find(c=>c.tagName==='section').children.find(c=>c.tagName==='article');
 const wrongButtons=wrongCard.findButtons();
 await wrongButtons[0].click();
 assert.equal(wrongButtons[1].disabled,true,'Wrong original digest must block seed');

 const overrideHost=new Element('section');
 let overriddenTo=null, openedTarget=null;
 cards.render(overrideHost,doc,{
   onOpen:async row=>{openedTarget=row.folder_id;return{
     verified:true,media_sha256:row.media_sha256,media_revision:row.media_revision,
     opened_ticket:'signed-original-open-ticket-456'}},
   onApprove:async row=>{overriddenTo=row.folder_id;return{
     persisted:true,media_verified:true,status:'approved'}},
   onReject:async()=>{throw Error('unexpected reject')}
 });
 const overrideCard=overrideHost.children.find(c=>c.tagName==='article');
 const overrideSelector=overrideCard.children.find(c=>c.tagName==='select');
 const overrideButtons=overrideCard.findButtons();
 assert(overrideSelector,'ranked match must offer folder override');
 overrideSelector.value='F2';
 overrideSelector.handlers.get('change')();
 assert.equal(overrideButtons[1].disabled,true,'changing folder invalidates proof');
 await overrideButtons[1].click();
 assert.equal(overriddenTo,null,'changing folder never auto-confirms');
 await overrideButtons[0].click();
 assert.equal(openedTarget,'F2');
 await overrideButtons[1].click();
 assert.equal(overriddenTo,'F2','human approval carries selected folder');

 const altered={...doc.matches[0],verified_same_person:true};
 assert.equal(cards.safeMatch(altered),false,'Identity claims must be rejected');
 const noLegacy={...doc,historic_review_index_verified:false};
 cards.render(host,noLegacy,{onOpen:async()=>{},onApprove:async()=>{},onReject:async()=>{}});
 assert.equal(host.findButtons().length,0,
   'Unsafe legacy-review-index snapshot must never expose controls');
 const malformed={...doc,identity_probabilities:true};
 cards.render(host,malformed,{onOpen:async()=>{},onApprove:async()=>{},onReject:async()=>{}});
 assert.equal(host.findButtons().length,0,'Unsafe snapshot must not expose controls');
 process.stdout.write('FOLDER_SUGGESTION_UI_TEST_PASS\n');
})().catch(e=>{console.error(e);process.exitCode=1});
