import http from "node:http";
import {randomBytes,createHash,scrypt as rawScrypt,timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
import pg from "pg";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
const scrypt=promisify(rawScrypt);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:8000});
const siteRoot=join(dirname(fileURLToPath(import.meta.url)),"../public");
let ready=false;
const statements=[
"CREATE TABLE IF NOT EXISTS artisan_users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now())",
"CREATE TABLE IF NOT EXISTS artisan_sessions(token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES artisan_users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL)",
"CREATE TABLE IF NOT EXISTS artisan_profiles(user_id UUID PRIMARY KEY REFERENCES artisan_users(id) ON DELETE CASCADE,job TEXT NOT NULL,city TEXT NOT NULL,website TEXT NOT NULL DEFAULT '',destination TEXT NOT NULL,avg_budget_eur INTEGER NOT NULL,ads_mode TEXT NOT NULL,updated_at TIMESTAMPTZ DEFAULT now())",
"CREATE TABLE IF NOT EXISTS artisan_campaign_drafts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES artisan_users(id) ON DELETE CASCADE,data JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT now())"
];
try {for(const statement of statements)await pool.query(statement);ready=true;console.log("ArtisanPilot database ready")}catch(e){console.error("database startup error",e.message)}
const query=(text,values=[])=>pool.query(text,values);
const j=(res,status,data,extra={})=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...extra});res.end(JSON.stringify(data))};
const error=(res,status,message)=>j(res,status,{error:message});
const random=()=>randomBytes(32).toString("hex");
const digest=s=>createHash("sha256").update(s).digest("hex");
const cook=(value,expire=false)=>"artisan_session="+value+"; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age="+(expire?0:604800);
const getToken=req=>(req.headers.cookie||"").split(";").map(s=>s.trim()).find(x=>x.startsWith("artisan_session="))?.slice(16)||"";
async function read(req){let text="";for await(const chunk of req){text+=chunk.toString();if(text.length>12000)throw new Error("too large")}try{return text?JSON.parse(text):{}}catch{return null}}
async function user(req){const token=getToken(req);if(!/^[a-f0-9]{64}$/.test(token))return null;return (await query("SELECT u.id,u.email FROM artisan_sessions s JOIN artisan_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1",[digest(token)])).rows[0]||null}
async function issue(res,account){const t=random();await query("INSERT INTO artisan_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[digest(t),account.id]);j(res,200,{user:{email:account.email,id:account.id}},{"set-cookie":cook(t)})}
async function handler(req,res){
const uri=new URL(req.url,"https://"+(req.headers.host||"localhost")),path=uri.pathname;
if(path==="/api/health")return j(res,ready?200:503,{status:ready?"ok":"degraded",database:ready,googleAdsConnected:false,openaiConnected:false,stripeConnected:false,liveCampaigns:false});
if(path==="/"&&req.method==="GET"){res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-frame-options":"DENY","x-content-type-options":"nosniff"});return res.end(await readFile(join(siteRoot,"index.html")))}
if(!ready)return error(res,503,"La base de données ne répond pas");
if(!path.startsWith("/api/"))return error(res,404,"Page introuvable");
if(req.method==="POST"){const origin=req.headers.origin;if(origin&&origin!==uri.origin)return error(res,403,"Origine non autorisée")}
if(path==="/api/me")return j(res,200,{user:await user(req)});
if(path==="/api/auth/register"&&req.method==="POST"){
const d=await read(req);if(!d)return error(res,400,"Données invalides");
const email=String(d.email||"").trim().toLowerCase(),pwd=String(d.password||"");
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200||pwd.length<12||pwd.length>160)return error(res,400,"Email invalide ou mot de passe trop court");
if((await query("SELECT id FROM artisan_users WHERE email=$1",[email])).rowCount)return error(res,409,"Email déjà utilisé");
const salt=randomBytes(16).toString("hex"),hash=(await scrypt(pwd,Buffer.from(salt,"hex"),64)).toString("hex");
try{const result=await query("INSERT INTO artisan_users(email,password_hash) VALUES($1,$2) RETURNING id,email",[email,salt+":"+hash]);return issue(res,result.rows[0])}catch(e){if(e.code==="23505")return error(res,409,"Email déjà utilisé");throw e}
}
if(path==="/api/auth/login"&&req.method==="POST"){
const d=await read(req);if(!d)return error(res,400,"Données invalides");
const email=String(d.email||"").trim().toLowerCase(),pwd=String(d.password||"");
const found=(await query("SELECT id,email,password_hash FROM artisan_users WHERE email=$1",[email])).rows[0];
let valid=false;
if(found&&pwd){const [salt,hash]=found.password_hash.split(":");if(/^[a-f0-9]{32}$/.test(salt)&&/^[a-f0-9]{128}$/.test(hash)){const test=await scrypt(pwd,Buffer.from(salt,"hex"),64);valid=timingSafeEqual(test,Buffer.from(hash,"hex"))}}
if(!valid)return error(res,401,"Identifiants incorrects");
return issue(res,found)
}
if(path==="/api/auth/logout"&&req.method==="POST"){const t=getToken(req);if(/^[a-f0-9]{64}$/.test(t))await query("DELETE FROM artisan_sessions WHERE token_hash=$1",[digest(t)]);return j(res,200,{ok:true},{"set-cookie":cook("",true)})}
const a=await user(req);if(!a)return error(res,401,"Connectez-vous");
if(path==="/api/profile"&&req.method==="GET"){const profile=(await query("SELECT job,city,website,destination,avg_budget_eur,ads_mode FROM artisan_profiles WHERE user_id=$1",[a.id])).rows[0]||null;return j(res,200,{profile})}
if(path==="/api/profile"&&req.method==="POST"){
const d=await read(req);if(!d)return error(res,400,"Données invalides");
const job=String(d.job||"").slice(0,80),city=String(d.city||"").trim().slice(0,90),website=String(d.website||"").trim().slice(0,300),destination=String(d.destination||"site"),budget=Number(d.avg_budget_eur),mode=String(d.ads_mode||"existing");
if(!job||!city||!["site","profile","both"].includes(destination)||!["new","existing"].includes(mode)||!Number.isInteger(budget)||budget<5||budget>5000)return error(res,400,"Vérifiez votre activité et votre budget");
if(website){let url;try{url=new URL(website)}catch{return error(res,400,"Adresse du site invalide")}if(url.protocol!=="https:"||url.username||url.password)return error(res,400,"Site HTTPS requis")}
await query("INSERT INTO artisan_profiles(user_id,job,city,website,destination,avg_budget_eur,ads_mode) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET job=EXCLUDED.job,city=EXCLUDED.city,website=EXCLUDED.website,destination=EXCLUDED.destination,avg_budget_eur=EXCLUDED.avg_budget_eur,ads_mode=EXCLUDED.ads_mode,updated_at=now()",[a.id,job,city,website,destination,budget,mode]);return j(res,200,{saved:true})}
if(path==="/api/drafts"&&req.method==="POST"){
const d=(await query("SELECT job,city,website,destination,avg_budget_eur FROM artisan_profiles WHERE user_id=$1",[a.id])).rows[0];
if(!d)return error(res,400,"Complétez votre activité");
const plan={...d,notice:"Brouillon uniquement. Aucune campagne Google Ads créée.",keywords:[d.job+" "+d.city,"dépannage "+d.job+" "+d.city],status:"draft"};
const inserted=await query("INSERT INTO artisan_campaign_drafts(user_id,data) VALUES($1,$2) RETURNING id,created_at",[a.id,JSON.stringify(plan)]);return j(res,201,{draft:{id:inserted.rows[0].id,...plan}})}
if(path==="/api/drafts"&&req.method==="GET"){const rows=await query("SELECT id,data,created_at FROM artisan_campaign_drafts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",[a.id]);return j(res,200,{drafts:rows.rows})}
return error(res,404,"Cette fonction n'est pas encore activée")
}
http.createServer((req,res)=>handler(req,res).catch(e=>{console.error(e);if(!res.headersSent)error(res,500,"Erreur serveur")})).listen(Number(process.env.PORT||3000),"0.0.0.0",()=>console.log("ArtisanPilot MVP listening"));
