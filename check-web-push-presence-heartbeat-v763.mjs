import { readFileSync } from 'node:fs';

const runtime = readFileSync('gejast-push-runtime.js', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(runtime.includes('function startPresenceHeartbeat'), 'push runtime must expose bounded presence heartbeat start');
assert(runtime.includes('function stopPresenceHeartbeat'), 'push runtime must expose bounded presence heartbeat stop');
assert(runtime.includes("notificationPermission()!=='granted'"), 'heartbeat must require granted notification permission');
assert(runtime.includes("!getToken()"), 'heartbeat must require a player session');
assert(runtime.includes("document.visibilityState&&document.visibilityState==='hidden'"), 'heartbeat must not refresh while hidden');
assert(runtime.includes('Math.min(Number(options.maxRuntimeMs||1800000),3600000)'), 'heartbeat runtime must be bounded');
assert(runtime.includes('requestLocation:false'), 'heartbeat must not repeatedly request geolocation permission');
assert(runtime.includes('startPresenceHeartbeat(options);'), 'permission sync should start heartbeat after successful setup');
assert(runtime.includes('setTimeout(()=>{ try{ startPresenceHeartbeat(); }catch(_){} },1500);'), 'runtime should quietly restart heartbeat on eligible page loads');
assert(runtime.includes('startPresenceHeartbeat,stopPresenceHeartbeat'), 'public runtime API must include heartbeat controls');

console.log('web push presence heartbeat regression ok');
