#!/usr/bin/env node
/* Deterministic acceptance proof for the real Beerpong form validation logic.
   Extracts validateForm from the shipped page and exercises both supported formats,
   winner/cup constraints, duplicate-player protection, and a valid match. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('beerpong.html','utf8');
function extractFunction(name){
  const start=source.indexOf(`function ${name}(`); assert.ok(start>=0,`Missing shipped function: ${name}`);
  const braceStart=source.indexOf('{',start); let depth=0,quote=null,escaped=false;
  for(let i=braceStart;i<source.length;i+=1){
    const ch=source[i],next=source[i+1];
    if(quote){ if(escaped){escaped=false;continue;} if(ch==='\\'){escaped=true;continue;} if(ch===quote)quote=null;continue; }
    if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='{' ) depth+=1;
    else if(ch==='}' && --depth===0) return source.slice(start,i+1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const declaration=extractFunction('validateForm');
const api=new Function(`let cupsTarget=10; const els={formatInput:{value:'2v2'},teamA1:{value:''},teamA2:{value:''},teamB1:{value:''},teamB2:{value:''},cupsA:{value:'0'},cupsB:{value:'0'}}; ${declaration}\nreturn {validateForm,set:(format,a1,a2,b1,b2,cupsA,cupsB,target=10)=>{cupsTarget=target;els.formatInput.value=format;els.teamA1.value=a1;els.teamA2.value=a2;els.teamB1.value=b1;els.teamB2.value=b2;els.cupsA.value=String(cupsA);els.cupsB.value=String(cupsB);}};`)();

const expect=(expected)=>assert.equal(api.validateForm(),expected ?? '');

api.set('2v2','','B','C','D',10,0); expect('Kies alle spelers.');
api.set('2v2','A','A','C','D',10,0); expect('Elke speler mag maar één keer gekozen worden.');
api.set('2v2','A','B','C','D',-1,10); assert.match(api.validateForm(),/tussen 0 en 10/);
api.set('2v2','A','B','C','D',10,10); assert.match(api.validateForm(),/Niet allebei 10/);
api.set('2v2','A','B','C','D',7,8); assert.match(api.validateForm(),/precies 10/);
api.set('2v2','A','B','C','D',10,7); expect();
console.log('Beerpong 2v2 validation matrix: ok');

api.set('1v1','A','','B','',5,0,5); expect();
api.set('1v1','A','','B','',5,5,5); assert.match(api.validateForm(),/Niet allebei 5/);
api.set('1v1','A','','B','',2,1,5); assert.match(api.validateForm(),/precies 5/);
api.set('1v1','A','','B','',6,0,5); assert.match(api.validateForm(),/tussen 0 en 5/);
console.log('Beerpong 1v1 validation matrix: ok');

console.log('RESULT=BEERPONG_GAMEPLAY_ACCEPTANCE_PASS');
