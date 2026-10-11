/* Real Chromium checks: cancellation, Original, authenticated live fallback. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXE||undefined});
 try{
  const page=await browser.newPage();
  await page.route('http://hub.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><body></body>'}));
  await page.goto('http://hub.test/test');
  await page.setContent('<video id="a" controls></video><video id="b" controls></video><img id="live"><p id="status"></p>');
  await page.evaluate(()=>{
   window.calls=[];window.pending={};
   window.C720PSecureRelay={url:async p=>'http://hub.test'+p,
    fetch:async p=>{calls.push(p);if(p==='/new/live.mp4')return {ok:true,headers:new Headers({'Content-Type':'video/mp4'})};
     if(p.includes('motion_1.mp4'))return await new Promise(resolve=>pending.first=()=>resolve({ok:true,json:async()=>({ok:true,state:'ready',source_fps:30})}));
     return {ok:true,json:async()=>p.includes('bad.mp4')?{ok:false,state:'failed',error:'source_below_24fps'}:{ok:true,state:'ready',source_fps:30}};
    }};
  });
  const shared=fs.readFileSync(path.join(__dirname,'security-video-playback.js'),'utf8');
  await page.addScriptTag({content:shared});
  assert.equal(await page.evaluate(()=>C720PSecurityVideo.sourcePath('http://hub.test/new/saved/clip/motion_123.mp4?auth=private')),'/new/saved/clip/motion_123.mp4');
  assert.equal(await page.evaluate(()=>C720PSecurityVideo.sourcePath('/local/frontyard-security-new/clips/20261009-203934-1064.mp4')),'/new/saved/clip/20261009-203934-1064.mp4');
  await page.evaluate(()=>{a.src='http://hub.test/new/saved/clip/motion_1.mp4?auth=private';a.load()});
  assert.equal(await page.evaluate(()=>a.getAttribute('src')),null);
  await page.evaluate(()=>C720PSecurityVideo.setSource(a,'/new/saved/clip/motion_2.mp4'));
  await page.evaluate(()=>pending.first());
  await page.waitForTimeout(40);
  assert.match(await page.evaluate(()=>a.src),/motion_2[.]mp4[?]playback=hub$/);
  const before=await page.evaluate(()=>calls.length);
  await page.evaluate(()=>C720PSecurityVideo.setSource(a,'/new/saved/clip/motion_2.mp4',{mode:'original'}));
  assert.equal(await page.evaluate(()=>calls.length),before);
  assert.match(await page.evaluate(()=>a.src),/motion_2[.]mp4$/);
  await page.evaluate(()=>{a.src='/local/frontyard-security-new/clips/20261009-203934-1064.mp4'});
  await page.waitForTimeout(30);
  await page.locator('.security-video-controls').first().locator('select').selectOption('original');
  await page.waitForTimeout(30);
  assert.match(await page.evaluate(()=>a.src),/local\/frontyard-security-new\/clips\/20261009-203934-1064[.]mp4$/);
  await page.evaluate(()=>C720PSecurityVideo.setSource(a,'/new/saved/clip/bad.mp4'));
  assert.equal(await page.evaluate(()=>a.getAttribute('src')),null);
  assert.match(await page.locator('.security-video-controls').first().textContent(),/fewer than 24/);
  assert.equal(await page.locator('.security-video-controls').first().locator('button').isVisible(),false);
  assert.equal(await page.locator('.security-video-controls').first().locator('select').isVisible(),true);
  await page.evaluate(()=>C720PSecurityVideo.startLive(live,{status:document.getElementById('status')}));
  await page.waitForTimeout(30);
  assert.match(await page.locator('#status').textContent(),/Reduced frame-rate fallback/);
  assert.match(await page.evaluate(()=>live.src),/new\/live[.]mjpg/);
  await page.evaluate(()=>C720PSecurityVideo.stopLive(live));
  assert.equal(await page.evaluate(()=>live.getAttribute('src')),null);
  await page.evaluate(source=>{
   const child=document.createElement('iframe');child.id='faces';child.srcdoc='<video id="facePlayer" controls></video><script>'+source+'<\/script>';document.body.append(child);
  },shared);
  await page.waitForFunction(()=>document.getElementById('faces')?.contentWindow.C720PSecurityVideo);
  await page.evaluate(()=>{
   const w=document.getElementById('faces').contentWindow;
   return w.C720PSecurityVideo.setSource(w.document.getElementById('facePlayer'),'/new/saved/clip/motion_3.mp4');
  });
  assert.match(await page.evaluate(()=>document.getElementById('faces').contentDocument.getElementById('facePlayer').src),/motion_3[.]mp4[?]playback=hub$/);
  console.log('SECURITY_SMOOTH_VIDEO_BROWSER_PASS cancellation original failure live-fallback child-parent-relay');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
