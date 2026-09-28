import postgres from "npm:postgres@3.4.7";

const DB_URL=Deno.env.get("SUPABASE_DB_URL");
if(!DB_URL) throw new Error("DB missing");
const sql=postgres(DB_URL,{max:2,prepare:false,idle_timeout:20});
const enc=new TextEncoder();
const ALLOWED_ORIGINS=new Set(["https://kalenel.nl","https://www.kalenel.nl","https://admin.kalenel.nl"]);

function cors(origin:string|null){
  const h:Record<string,string>={
    "Cache-Control":"private, no-store, max-age=0",
    "Access-Control-Allow-Methods":"GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers":"authorization,content-type,x-kalenel-media-token,range,if-range,if-none-match,if-modified-since",
    "Access-Control-Max-Age":"600",
    "Vary":"Origin",
    "Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff",
  };
  if(origin&&ALLOWED_ORIGINS.has(origin)) h["Access-Control-Allow-Origin"]=origin;
  return h;
}
function json(data:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(data),{status,headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8"}});
}
async function sha(v:string){
  const d=await crypto.subtle.digest("SHA-256",enc.encode(v));
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function media(req:Request,u:URL){
  let raw=(req.headers.get("x-kalenel-media-token")||"").trim();
  if(!raw) raw=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!raw&&(req.method==="GET"||req.method==="HEAD")) raw=(u.searchParams.get("media_token")||u.searchParams.get("token")||u.searchParams.get("mt")||"").trim();
  if(raw.length<32||raw.length>256) return null;
  const h=await sha(raw);
  const r=await sql`select token_hash from c720p_security.sessions where token_hash=${h} and expires_at>now() limit 1`;
  if(!r.length) return null;
  await sql`update c720p_security.sessions set last_seen_at=now() where token_hash=${h}`;
  return raw;
}
function b64(b:Uint8Array){
  let s="";for(const x of b)s+=String.fromCharCode(x);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function hb(h:string){
  const o=new Uint8Array(h.length/2);for(let i=0;i<o.length;i++)o[i]=parseInt(h.slice(i*2,i*2+2),16);return o;
}
async function tunnelToken(secret:string){
  const n=Math.floor(Date.now()/1000);
  const p=b64(enc.encode(JSON.stringify({iat:n-120,exp:n+180,scope:"c720p-security-media-v1"})));
  const k=await crypto.subtle.importKey("raw",hb(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return p+"."+b64(new Uint8Array(await crypto.subtle.sign("HMAC",k,enc.encode(p))));
}
function clean(v:string,ext=""){
  let s="";try{s=decodeURIComponent(v)}catch{return""}
  if(!/^[A-Za-z0-9._-]{1,180}$/.test(s)||s.includes("..")||(ext&&!s.toLowerCase().endsWith(ext))) return "";
  return s;
}
function path(u:URL){
  const c=u.searchParams.get("camera"),k=u.searchParams.get("kind");
  if(c!=="new"&&c!=="s3") return "";
  if(k==="status") return `/${c}/api/status`;
  if(k==="events") return `/${c}/api/events`;
  if(k==="saved") return `/${c}/api/saved`;
  if(k==="controls") return `/${c}/api/controls`;
  if(k==="control") return `/${c}/api/control`;
  if(k==="live") return `/${c}/live.mjpg`;
  if(k==="snap"){const n=clean(u.searchParams.get("name")||"");return n?`/${c}/snap/${encodeURIComponent(n)}`:""}
  if(k==="clip"){const n=clean(u.searchParams.get("name")||"",".mp4");return n?`/${c}/clip/${encodeURIComponent(n)}`:""}
  if(k==="savedsnap"){const n=clean(u.searchParams.get("name")||"",".jpg");return n?`/${c}/saved/snap/${encodeURIComponent(n)}`:""}
  if(k==="savedclip"){const n=clean(u.searchParams.get("name")||"",".mp4");return n?`/${c}/saved/clip/${encodeURIComponent(n)}`:""}
  return "";
}

Deno.serve(async req=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS"){
    if(origin&&!ALLOWED_ORIGINS.has(origin)) return json({ok:false,error:"origin_denied"},403,origin);
    return new Response(null,{status:204,headers:cors(origin)});
  }
  if(!["GET","HEAD","POST"].includes(req.method)) return json({ok:false,error:"method_not_allowed"},405,origin);
  const u=new URL(req.url);
  if((u.searchParams.get("camera")||"").toLowerCase()==="s3") return json({ok:false,error:"camera_retired"},410,origin);
  if(!await media(req,u)) return json({ok:false,error:"media_session_required"},401,origin);
  const p=path(u);
  if(!p) return json({ok:false,error:"bad_media_path"},400,origin);
  if(req.method==="POST"&&!p.endsWith("/api/control")) return json({ok:false,error:"post_not_allowed"},405,origin);
  if(req.method!=="POST"&&p.endsWith("/api/control")) return json({ok:false,error:"method_not_allowed"},405,origin);

  const c=(await sql`select tunnel_url,hmac_secret from c720p_security.control where singleton=true`)[0]||{};
  const base=String(c.tunnel_url||"").replace(/\/+$/,"");
  const secret=String(c.hmac_secret||"");
  if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(base)||!/^[0-9a-f]{64}$/i.test(secret)) return json({ok:false,error:"camera_origin_offline"},503,origin);

  const target=new URL(base+p);
  const h=new Headers();
  h.set("X-C720P-Media-Token",await tunnelToken(secret));
  for(const n of ["Range","If-Range","If-None-Match","If-Modified-Since"]){const v=req.headers.get(n);if(v)h.set(n,v)}
  let body:Uint8Array|undefined=undefined;
  if(req.method==="POST"){
    const ab=await req.arrayBuffer();
    if(ab.byteLength<1||ab.byteLength>4096) return json({ok:false,error:"bad_request"},400,origin);
    body=new Uint8Array(ab);h.set("Content-Type","application/json");
  }
  const isLive=p.endsWith("/live.mjpg");
  const timeoutMs=isLive?125000:15000;
  let r:Response;
  try{
    r=await fetch(target,{method:req.method,headers:h,body,redirect:"follow",signal:AbortSignal.timeout(timeoutMs)});
  }catch(e){
    console.error("relay fetch",e);
    return json({ok:false,error:"camera_origin_unavailable"},502,origin);
  }
  const out=new Headers(cors(origin));
  for(const n of ["Content-Type","Content-Length","Content-Range","Accept-Ranges","ETag","Last-Modified","Content-Disposition"]){const v=r.headers.get(n);if(v)out.set(n,v)}
  if(isLive) out.set("X-Kalenel-Relay-Mode","live-125s");
  return new Response(req.method==="HEAD"?null:r.body,{status:r.status,statusText:r.statusText,headers:out});
});
