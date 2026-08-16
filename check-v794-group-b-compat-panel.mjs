#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('gejast-game-group-b-bridge.js','utf8');
assert(source.includes("const VERSION='v794'"),'group B bridge must identify the v794 frontend owner');
assert(source.includes("generic:'get_game_group_b_bundle_v661'"),'group B bridge must retain the deployed compatibility wrapper entry point');
assert(!/get_(?:pikken|paardenrace)_phase_bundle_v661/.test(source),'removed specific v661 phase RPC names must not return');
assert(!source.includes('Run de v661 SQL'),'public panel must not tell users to install the obsolete v661 payload contract');

const window={GEJAST_CONFIG:{}};
const context={window,location:{search:'',pathname:'/pikken_live.html'},URLSearchParams,console,fetch:globalThis.fetch};
vm.runInNewContext(source,context,{filename:'gejast-game-group-b-bridge.js'});
const api=window.GEJAST_GAME_GROUP_B_BRIDGE;
assert(api,'group B bridge API must initialize');
assert.equal(api.VERSION,'v794');
assert.equal(typeof api.normalizeCompatPayload,'function','compat payload normalizer must be exported for deterministic acceptance');

const pikkenPayload={
  ok:true,
  version:'v687-compat',
  game_key:'pikken',
  site_scope:'friends',
  pikken_open:{
    ok:true,
    rows:[
      {id:'g1',lobby_code:'PIK123',status:'lobby',host_name:'Ada',player_count:2,ready_count:1},
      {id:'g2',lobby_code:'PIK456',status:'waiting',host_name:'Bram',player_count:3,ready_count:2}
    ],
    items:[],
    lobbies:[]
  },
  paardenrace_open:null
};
const pikken=api.normalizeCompatPayload(pikkenPayload);
assert.equal(pikken.game,'pikken');
assert.equal(pikken.version,'v687-compat');
assert.deepEqual({...pikken.totals},{open:2,players:5,ready:3});
assert.equal(pikken.rows[0].lobby_code,'PIK123');

const pikkenBody={innerHTML:''};
api.renderPanel(pikkenPayload,{querySelector:()=>pikkenBody});
assert.match(pikkenBody.innerHTML,/open lobby’s/,'Pikken compatibility panel must label open lobbies truthfully');
assert.match(pikkenBody.innerHTML,/>5<\/b><br><span>spelers/,'Pikken compatibility panel must sum current player counts');
assert.match(pikkenBody.innerHTML,/>3<\/b><br><span>gereed/,'Pikken compatibility panel must sum ready counts');
assert.match(pikkenBody.innerHTML,/v687-compat/,'Pikken compatibility panel must expose the actual compatibility source version');
assert.match(pikkenBody.innerHTML,/PIK123/,'Pikken compatibility panel must list the current lobby code');
assert.doesNotMatch(pikkenBody.innerHTML,/Geen recente games gevonden|>v661<\/b>/,'Pikken compatibility payload must never fall through to the obsolete zero/v661 presentation');

const paardenPayload={
  ok:true,
  version:'v687-compat',
  game_key:'paardenrace',
  site_scope:'friends',
  pikken_open:null,
  paardenrace_open:[
    {id:'r1',room_code:'HORSE1',stage:'lobby',stage_label:'Lobby',host_name:'Cato',player_count:2,ready_count:2},
    {id:'r2',room_code:'HORSE2',stage:'countdown',stage_label:'Countdown',host_name:'Daan',player_count:4,ready_count:3}
  ]
};
const paarden=api.normalizeCompatPayload(paardenPayload);
assert.equal(paarden.game,'paardenrace');
assert.deepEqual({...paarden.totals},{open:2,players:6,ready:5});

const paardenBody={innerHTML:''};
api.renderPanel(paardenPayload,{querySelector:()=>paardenBody});
assert.match(paardenBody.innerHTML,/open kamers/,'Paardenrace compatibility panel must label open rooms truthfully');
assert.match(paardenBody.innerHTML,/>6<\/b><br><span>spelers/,'Paardenrace compatibility panel must sum current player counts');
assert.match(paardenBody.innerHTML,/>5<\/b><br><span>gereed/,'Paardenrace compatibility panel must sum ready counts');
assert.match(paardenBody.innerHTML,/HORSE2/,'Paardenrace compatibility panel must list current room codes');
assert.match(paardenBody.innerHTML,/Countdown/,'Paardenrace compatibility panel must retain the current stage label');
assert.match(paardenBody.innerHTML,/v687-compat/,'Paardenrace compatibility panel must expose the actual compatibility source version');
assert.doesNotMatch(paardenBody.innerHTML,/Geen recente games gevonden|>v661<\/b>/,'Paardenrace compatibility payload must never fall through to the obsolete zero/v661 presentation');

const emptyBody={innerHTML:''};
api.renderPanel({...pikkenPayload,pikken_open:{ok:true,rows:[],items:[],lobbies:[]}},{querySelector:()=>emptyBody});
assert.match(emptyBody.innerHTML,/Geen open Pikken-lobby’s gevonden/,'empty compatibility state must describe open-lobby truth, not historical games');

console.log('v794 group B compatibility panel regression PASS: deployed v687-compat payloads normalize to truthful open-room/player/ready/source UI for Pikken and Paardenrace.');
