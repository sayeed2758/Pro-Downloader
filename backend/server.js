import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import admin from "firebase-admin";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(helmet({crossOriginResourcePolicy:{policy:"cross-origin"}}));
app.use(express.json({limit:"64kb"}));

const allowed = (process.env.FRONTEND_ORIGIN || "").split(",").map(s=>s.trim()).filter(Boolean);
app.use(cors({origin:(origin,cb)=>{
  if(!origin || allowed.length===0 || allowed.includes(origin)) return cb(null,true);
  return cb(new Error("Origin not allowed"));
}}));

const limiter = rateLimit({
  windowMs:60_000,
  limit:Number(process.env.RATE_LIMIT_PER_MINUTE||30),
  standardHeaders:true, legacyHeaders:false
});
app.use("/api/", limiter);

const publicDir = path.join(__dirname,"..","public");
app.use(express.static(publicDir));

const timeoutMs=Number(process.env.DOWNLOADER_PROVIDER_TIMEOUT_MS||60000);

let adminDb = null;
try {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,"\n");
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    adminDb = admin.database();
    console.log("Firebase Admin initialized.");
  }
} catch (e) {
  console.warn("Firebase Admin not initialized:", e.message);
}

async function adminAuthVerified(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  if (!admin.apps.length) return null;
  try { return await admin.auth().verifyIdToken(header.slice(7)); } catch { return null; }
}

function normalizeUrl(raw){
  if(typeof raw!=="string") throw Object.assign(new Error("URL must be a string."),{code:"INVALID_URL"});
  const trimmed=raw.trim();
  if(!trimmed) throw Object.assign(new Error("Please paste a valid link."),{code:"INVALID_URL"});
  let u;
  try{u=new URL(trimmed)}catch{throw Object.assign(new Error("Please paste a valid link."),{code:"INVALID_URL"})}
  if(!["http:","https:"].includes(u.protocol)) throw Object.assign(new Error("Only http/https URLs are allowed."),{code:"INVALID_URL"});
  if(!u.hostname) throw Object.assign(new Error("Hostname is required."),{code:"INVALID_URL"});
  return u;
}

function isPrivateIp(ip){
  const family=net.isIP(ip);
  if(family===4){
    const [a,b,c,d]=ip.split(".").map(Number);
    return a===10 || a===127 || (a===169&&b===254) || a===0 ||
      (a===172&&b>=16&&b<=31) || (a===192&&b===168) ||
      (a===100&&b>=64&&b<=127);
  }
  if(family===6){
    const low=ip.toLowerCase();
    return low==="::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb");
  }
  return false;
}

async function assertSafeRemote(u){
  const hostname=u.hostname.toLowerCase();
  if(["localhost","localhost.localdomain"].includes(hostname)) throw Object.assign(new Error("Blocked host."),{code:"INVALID_URL"});
  const records=await dns.lookup(hostname,{all:true}).catch(()=>[]);
  for(const r of records){if(isPrivateIp(r.address)) throw Object.assign(new Error("Blocked private/internal address."),{code:"INVALID_URL"});}
}

async function fetchWithRedirectSafety(input, init={}, max=3){
  let current=new URL(input);
  for(let i=0;i<=max;i++){
    await assertSafeRemote(current);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const res=await fetch(current,{...init,redirect:"manual",signal:controller.signal});
      if([301,302,303,307,308].includes(res.status)){
        const loc=res.headers.get("location");
        if(!loc) return res;
        current=new URL(loc,current);
        continue;
      }
      return res;
    }catch(e){
      if(e.name==="AbortError") throw Object.assign(new Error("Request timed out."),{code:"TIMEOUT"});
      throw e;
    }finally{clearTimeout(timer);}
  }
  throw Object.assign(new Error("Too many redirects."),{code:"PROVIDER_ERROR"});
}

function isDirectMediaPath(u){
  return /\.(mp4|webm|mov|m4v|m3u8)(\?.*)?$/i.test(u.pathname);
}

async function getDirectMediaInfo(u){
  const res=await fetchWithRedirectSafety(u,{method:"HEAD"});
  let contentType=res.headers.get("content-type")||"";
  let size=res.headers.get("content-length")||null;
  if(!res.ok && res.status!==206){
    const fallback=await fetchWithRedirectSafety(u,{headers:{Range:"bytes=0-1023"}});
    contentType=fallback.headers.get("content-type")||contentType;
    size=fallback.headers.get("content-length")||size;
    try{fallback.body?.cancel?.()}catch{}
  }
  const looksVideo=/video\/|application\/vnd.apple.mpegurl|application\/x-mpegurl/i.test(contentType);
  if(!res.ok && !looksVideo) throw Object.assign(new Error("Media could not be inspected."),{code:"MEDIA_NOT_FOUND"});
  if(!looksVideo && !isDirectMediaPath(u)) throw Object.assign(new Error("URL is not a direct media resource."),{code:"UNSUPPORTED_PLATFORM"});
  return {
    success:true,platform:"direct",title:u.pathname.split("/").pop()||"Direct Media",thumbnail:"",
    duration:null,author:"",sourceUrl:u.toString(),
    media:[{id:"direct",quality:"Original",label:contentType||"Direct media",type:contentType.startsWith("audio/")?"audio":"video",format:(u.pathname.split(".").pop()||"mp4").toLowerCase(),size:size?Number(size):null,downloadAvailable:true,playAvailable:true,downloadUrl:u.toString()}]
  };
}

async function providerResolve(url,{audioOnly=false}={}){
  const provider=process.env.DOWNLOADER_PROVIDER_URL;
  if(!provider) throw Object.assign(new Error("No resolver provider is configured for this platform."),{code:"UNSUPPORTED_PLATFORM"});
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const headers={"Content-Type":"application/json"};
    if(process.env.DOWNLOADER_PROVIDER_API_KEY) headers.Authorization=`Bearer ${process.env.DOWNLOADER_PROVIDER_API_KEY}`;
    const res=await fetch(provider,{method:"POST",headers,body:JSON.stringify({url,audioOnly}),signal:controller.signal});
    let data={}; try{data=await res.json()}catch{}
    if(!res.ok) throw Object.assign(new Error(data.message||"Resolver provider error."),{code:"PROVIDER_ERROR"});
    if(data.success===false) throw Object.assign(new Error(data.message||"Resolver provider error."),{code:data.code||"PROVIDER_ERROR"});
    return normalizeProviderResponse(data,url);
  }catch(e){
    if(e.name==="AbortError") throw Object.assign(new Error("Resolver provider timed out."),{code:"TIMEOUT"});
    throw e;
  }finally{clearTimeout(timer);}
}

function normalizeProviderResponse(data, sourceUrl){
  const media=Array.isArray(data.media)?data.media.map((m,i)=>({
    id:String(m.id??i),quality:m.quality??m.label??"Original",label:m.label??m.quality??"Media",
    type:m.type??"video",format:m.format??"",size:m.size??null,
    downloadAvailable:m.downloadAvailable ?? !!m.downloadUrl,
    playAvailable:m.playAvailable ?? !!m.downloadUrl,
    downloadUrl:m.downloadUrl??null
  })).filter(Boolean):[];
  return {success:true,platform:data.platform||"unknown",title:data.title||"Untitled media",thumbnail:data.thumbnail||"",duration:data.duration??null,author:data.author||"",sourceUrl,media};
}

async function resolve(url,opts={}){
  const u=normalizeUrl(url);
  await assertSafeRemote(u);
  if(isDirectMediaPath(u)) return getDirectMediaInfo(u);
  const host=u.hostname.replace(/^www\./,"").toLowerCase();
  let supportedHosts=(process.env.SUPPORTED_DOMAINS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  if (adminDb) {
    try {
      const snap=await adminDb.ref("supportedSites").once("value");
      const values=Object.values(snap.val()||{});
      supportedHosts=values.filter(x=>x?.enabled && x?.domain).map(x=>String(x.domain).replace(/^www\\./,"").toLowerCase());
    } catch {}
  }
  if(!supportedHosts.some(d=>host===d||host.endsWith("."+d))) throw Object.assign(new Error("This website is currently not supported."),{code:"UNSUPPORTED_PLATFORM"});
  return providerResolve(u.toString(),opts);
}

const tasks=new Map();

app.get("/api/health",(req,res)=>res.json({success:true,service:"pro-downloader-backend",time:Date.now()}));

app.post("/api/resolve",async(req,res)=>{
  try{
    const data=await resolve(req.body?.url,{audioOnly:!!req.body?.audioOnly});
    res.json(data);
  }catch(e){res.status(400).json({success:false,code:e.code||"PROVIDER_ERROR",message:e.message||"Could not process this link."});}
});

app.post("/api/task",async(req,res)=>{
  const {sourceUrl,title,platform,format}=req.body||{};
  if(!format || typeof format!=="object" || !format.downloadUrl) return res.status(400).json({success:false,code:"DOWNLOAD_UNAVAILABLE",message:"Download link unavailable."});
  let downloadUrl;
  try {
    const u=normalizeUrl(format.downloadUrl);
    await assertSafeRemote(u);
    downloadUrl=u.toString();
  } catch {
    return res.status(400).json({success:false,code:"DOWNLOAD_UNAVAILABLE",message:"Download link unavailable."});
  }
  const taskId=crypto.randomUUID();
  const task={id:taskId,title:title||"Media",platform:platform||"unknown",format:format.format||"",quality:format.quality||format.label||"",status:"completed",progress:100,downloadUrl,sourceUrl:sourceUrl||null,completedAt:Date.now()};
  tasks.set(taskId,task);
  res.json({success:true,taskId,task});
});

app.get("/api/task/:id",(req,res)=>{
  const task=tasks.get(req.params.id);
  if(!task) return res.status(404).json({success:false,code:"MEDIA_NOT_FOUND",message:"Task not found."});
  res.json({success:true,task});
});

app.post("/api/link-check",async(req,res)=>{
  try{
    const u=normalizeUrl(req.body?.url); const safe=await assertSafeRemote(u); void safe;
    const r=await fetchWithRedirectSafety(u,{method:"HEAD"});
    const supported=!["google.com","example.com"].includes(u.hostname.replace(/^www\./,"")) || true;
    res.json({success:true,valid:true,domain:u.hostname,protocol:u.protocol.replace(":",""),reachable:r.ok||r.status<500,status:r.status,supported});
  }catch(e){res.status(400).json({success:false,code:e.code||"INVALID_URL",message:e.message||"Could not check link."});}
});

app.get("/api/speed-test",async(req,res)=>{
  const bytes=Math.min(Math.max(Number(req.query.bytes||2000000),100_000),5_000_000);
  res.set("Content-Type","application/octet-stream").set("Cache-Control","no-store").send(Buffer.alloc(bytes,7));
});

app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({success:false,message:"Not found."});
  res.sendFile(path.join(publicDir,"index.html"));
});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({success:false,code:"SERVER_ERROR",message:"Internal server error."})});

const port=Number(process.env.PORT||8080);
app.listen(port,()=>console.log(`Pro Downloader running on http://localhost:${port}`));
