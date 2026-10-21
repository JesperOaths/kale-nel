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
 automatic_assignments:0,identity_probabilities:false,journal_revision:3,
 matches:[{
  state:'pending_review',human_review_required:true,verified_same_person:false,
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
  min_within_group_similarity:.47,mean_within_group_similarity:.59,evidence_pair_count:1,
  state:'pending_review',human_review_required:true,automatically_assigned:false
 }]
};
(async()=>{
 const host=new Element('section');
 let approved=0,opened=0,saved=0;
 const first=cards.render(host,doc,{
   onOpen:async row=>{opened++;return {
     verified:true,media_sha256:row.media_sha256,media_revision:row.media_revision
   }},
   onApprove:async()=>{approved++;return{
     persisted:true,media_verified:true,status:'approved'}},
   onReject:async()=>{throw Error('unexpected reject')},
   onSaved:()=>saved++
 });
 assert.equal(first.visible,1);
 assert.equal(first.provisional_groups,1);
 assert(host.textContent.includes('Minimum within-group similarity: 0.470'),
        'Cluster pair evidence must be visible to the reviewer');
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
 const altered={...doc.matches[0],verified_same_person:true};
 assert.equal(cards.safeMatch(altered),false,'Identity claims must be rejected');
 const malformed={...doc,identity_probabilities:true};
 cards.render(host,malformed,{onOpen:async()=>{},onApprove:async()=>{},onReject:async()=>{}});
 assert.equal(host.findButtons().length,0,'Unsafe snapshot must not expose controls');
 process.stdout.write('FOLDER_SUGGESTION_UI_TEST_PASS\n');
})().catch(e=>{console.error(e);process.exitCode=1});
