import http from 'node:http';
import {normalizeSiteInput,makeSlug,suggestDomains,renderLanding,sitePreviewUrl,trades} from './site-builder.mjs';
import {generateSiteCopy} from './site-copy.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {config,integrationsConfigured} from './config.mjs';
import {applyMigrations} from './schema.mjs';
import {token,sha,passwordHash,passwordVerify,cookie,getCookie,trustedOrigin,isEmail,safeCustomerId,secureHeaders} from './security.mjs';
import {generatePlan,dailyBudgetInfo} from './planner.mjs';
import {suggestExclusions,performanceAlert} from './suggestions.mjs';
import {oauthUrl,exchangeCode,storeTokens,requestAds,listAccounts,searchAds,dailyMetrics,searchTerms,geoSuggestions,createCustomer,createPausedCampaign,enableCampaign,listBusinessAccounts,linkBusinessLocationAssets,inviteNewCustomerAdmin,ProviderError} from './ads.mjs';
import {checkStripeSignature,createCheckout,createPortal,applyStripeEvent} from './billing.mjs';
import {generateOptionalCopy} from './assistant.mjs';
import {findCityByCode, suggestCities, validateRadiusKm, normalizeSearchText} from './locations.mjs';
import {normalizeFrenchPhone} from './phone.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const limits=new Map();
let pool=null,dbReady=false,dbError='';
if(config.dbUrl){
  try {
    const pg=await import('pg');
    pool=new pg.default.Pool({connectionString:config.dbUrl,max:8,connectionTimeoutMillis:9000,idleTimeoutMillis:25000});
    await applyMigrations(pool);dbReady=true;
    console.info('ArtisanPilot: PostgreSQL ready');
  }catch(e){dbError=e.message;console.error('ArtisanPilot database unavailable:',dbError)}
}else dbError='DATABASE_URL not set';
const query=(sql,params=[])=>{if(!dbReady)throw new HttpError('Base de données indisponible',503);return pool.query(sql,params)};
class HttpError extends Error {constructor(message,status=400){super(message);this.status=status}}
function response(res,status,body,headers={}){res.writeHead(status,secureHeaders({'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}));res.end(JSON.stringify(body))}
const send=(res,data,status=200,headers={})=>response(res,status,data,headers);
function redirect(res,uri){res.writeHead(303,secureHeaders({'location':uri,'cache-control':'no-store'}));res.end()}
async function readBody(req,limit=18000){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new HttpError('Requête trop volumineuse',413);chunks.push(chunk)}return Buffer.concat(chunks).toString('utf8')}
async function readJson(req){let raw=await readBody(req);try{return raw?JSON.parse(raw):{}}catch{throw new HttpError('JSON invalide',400)}}
function rateGuard(req,category,max,windowMs=60000){
  const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  const key=category+':'+ip;
  const t=Date.now();const info=limits.get(key);
  const next=!info||info.reset<t?{count:1,reset:t+windowMs}:{count:info.count+1,reset:info.reset};
  limits.set(key,next);if(limits.size>10000)for(const [key,value] of limits.entries())if(value.reset<t)limits.delete(key);
  if(next.count>max)throw new HttpError('Trop de tentatives. Réessayez ultérieurement.',429);
}
async function sessionUser(req){
  const t=getCookie(req);if(!/^[0-9a-f]{64}$/.test(t))return null;
  const result=await query('SELECT u.id,u.email,u.email_verified FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1',[sha(t)]);
  return result.rows[0]||null;
}
async function issueSession(res,u){
  const t=token();await query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'7 days\')',[sha(t),u.id]);
  send(res,{user:{id:u.id,email:u.email,emailVerified:u.email_verified||false}},200,{'set-cookie':cookie(t)})
}
async function audit(userId,action,details={}){
  await query('INSERT INTO audit_log(user_id,action,details) VALUES($1,$2,$3)',[userId,action,JSON.stringify(details)]);
}
async function selectedAccount(userId){
  const result=await query('SELECT customer_id,name,currency,timezone,created_by_app FROM google_accounts WHERE user_id=$1 AND selected=true LIMIT 1',[userId]);
  return result.rows[0]||null;
}
async function requireAccount(userId,customerId){const account=await selectedAccount(userId);if(!account||account.customer_id!==customerId)throw new HttpError('Sélectionnez un compte Google Ads autorisé dans votre espace.',403);return account;}
async function getProfile(userId){const x=await query('SELECT * FROM profiles WHERE user_id=$1',[userId]);return x.rows[0]||null;}
async function view(req,res,p){
  const file=p==='/studio'?'studio.html':p==='/studio.js'?'studio.js':p==='/studio.css'?'studio.css':p==='/landing.css'?'landing.css':p==='/site-track.js'?'site-track.js':p==='/'?'index.html':p==='/privacy'||p==='/confidentialite'?'privacy.html':p==='/terms'||p==='/conditions'?'terms.html':p==='/app.js'?'app.js':p==='/coverage.js'?'coverage.js':p==='/style.css'?'style.css':null;
  if(!file)throw new HttpError('Page introuvable',404);
  const data=await fs.readFile(path.join(ROOT,'../public',file));
  res.writeHead(200,secureHeaders({'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript; charset=utf-8':'text/css; charset=utf-8','cache-control':file==='index.html'||file==='studio.html'?'no-store':'public, max-age=300'}));res.end(data);
}
async function handle(req,res){
  const url=new URL(req.url,config.baseUrl),p=url.pathname,m=req.method;
  if(m==='GET'&&['/','/studio','/studio.js','/studio.css','/landing.css','/site-track.js','/privacy','/confidentialite','/terms','/conditions','/app.js','/coverage.js','/style.css'].includes(p))return view(req,res,p);
  if(p==='/api/health')return send(res,{status:dbReady?'ok':'degraded',database:dbReady,integrations:integrationsConfigured(),writes:{accountCreation:config.allowAccountCreation,campaignCreation:config.allowCampaignWrites,activation:config.allowActivation,locationSync:config.allowLocationSync},message:dbReady?'Base active, API externes selon configuration':'La base de données doit être initialisée'},dbReady?200:503);
  if(m==='GET' && p.startsWith('/p/')){
    const slug=decodeURIComponent(p.slice(3));
    if(!/^[a-z0-9-]{5,90}$/.test(slug))throw new HttpError('Page introuvable',404);
    const data=await query("SELECT site,slug,custom_domain,domain_verified FROM artisan_sites WHERE slug=$1 AND status='published'",[slug]);
    if(!data.rows.length)throw new HttpError('Page introuvable',404);
    const html=renderLanding({...data.rows[0].site,slug},{baseUrl:config.baseUrl});
    res.writeHead(200,secureHeaders({'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=120'}));return res.end(html);
  }
  if(!p.startsWith('/api/'))throw new HttpError('Page introuvable',404);
  if(!dbReady)throw new HttpError('Base de données indisponible',503);
  if(p==='/api/stripe/webhook'&&m==='POST'){
    if(!integrationsConfigured().stripe)throw new HttpError('Stripe non configuré',503);
    const raw=await readBody(req,600000);
    if(!checkStripeSignature(raw,String(req.headers['stripe-signature']||''),config.stripeWebhook))throw new HttpError('Signature Stripe invalide',400);
    const event=JSON.parse(raw);
    const result=await applyStripeEvent(query,event);
    return send(res,{received:true,...result});
  }
  if(p==='/api/cron/daily'&&m==='POST'){
    if(!config.dailyEnabled||!config.cronToken)throw new HttpError('Rapports quotidiens désactivés',503);
    if(req.headers.authorization!=='Bearer '+config.cronToken)throw new HttpError('Non autorisé',403);
    return runDailyReports(res);
  }
  if(!['GET','HEAD','OPTIONS'].includes(m)&&!trustedOrigin(req))throw new HttpError('Origine non autorisée',403);
  if(p==='/api/site/call-click'&&m==='POST'){
    rateGuard(req,'site-call',30);
    const x=await readJson(req),slug=String(x.slug||'');
    if(!/^[a-z0-9-]{5,90}$/.test(slug))throw new HttpError('Page invalide',422);
    const found=await query("SELECT user_id FROM artisan_sites WHERE slug=$1 AND status='published'",[slug]);
    if(!found.rows.length)throw new HttpError('Page introuvable',404);
    const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0];
    await query('INSERT INTO site_call_clicks(site_user_id,visitor_hash) VALUES($1,$2)',[found.rows[0].user_id,sha(ip+':'+new Date().toISOString().slice(0,10))]);
    return send(res,{recorded:true,metric:'click_to_call',note:'Un clic ne confirme pas un appel décroché.'},202);
  }
  if(p==='/api/auth/register'&&m==='POST'){
    rateGuard(req,'register',6,60000);
    const x=await readJson(req),email=String(x.email||'').trim().toLowerCase(),pw=String(x.password||'');
    if(!isEmail(email)||pw.length<12||pw.length>160)throw new HttpError('Email invalide ou mot de passe trop court (12 caractères minimum).');
    const existing=await query('SELECT id FROM users WHERE email=$1',[email]);
    if(existing.rows.length)throw new HttpError('Cet email possède déjà un compte. Connectez-vous.',409);
    const hashpw=await passwordHash(pw);
    let result;
    try{result=await query('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,email_verified',[email,hashpw]);}catch(e){if(e.code==='23505')throw new HttpError('Cet email possède déjà un compte.',409);throw e}
    await audit(result.rows[0].id,'auth.register');return issueSession(res,result.rows[0]);
  }
  if(p==='/api/auth/login'&&m==='POST'){
    rateGuard(req,'login',10,60000);
    const x=await readJson(req),email=String(x.email||'').trim().toLowerCase(),pw=String(x.password||'');
    if(!isEmail(email)||!pw)throw new HttpError('Identifiants incorrects',401);
    const r=await query('SELECT id,email,password_hash,email_verified FROM users WHERE email=$1',[email]);
    if(!r.rows.length||!(await passwordVerify(pw,r.rows[0].password_hash)))throw new HttpError('Identifiants incorrects',401);
    await audit(r.rows[0].id,'auth.login');return issueSession(res,r.rows[0]);
  }
  if(p==='/api/me'){const a=await sessionUser(req);return send(res,{user:a?{id:a.id,email:a.email,emailVerified:a.email_verified}:null})}
  if(p==='/api/auth/logout'&&m==='POST'){
    const t=getCookie(req);if(/^[0-9a-f]{64}$/.test(t))await query('DELETE FROM sessions WHERE token_hash=$1',[sha(t)]);
    return send(res,{ok:true},200,{'set-cookie':cookie('',{expire:true})});
  }
  const a=await sessionUser(req);
  if(!a)throw new HttpError('Connectez-vous pour accéder à votre espace.',401);
  if(p==='/api/site/trades'&&m==='GET')return send(res,{trades});
  if(p==='/api/site'&&m==='GET'){
    const r=await query('SELECT slug,site,status,custom_domain,domain_verified,updated_at FROM artisan_sites WHERE user_id=$1',[a.id]);
    if(!r.rows.length)return send(res,{site:null});
    const item=r.rows[0];const stats=await query("SELECT count(*)::int AS clicks FROM site_call_clicks WHERE site_user_id=$1 AND occurred_at>now()-interval '30 days'",[a.id]);
    return send(res,{site:{...item.site,slug:item.slug,status:item.status,custom_domain:item.custom_domain,domain_verified:item.domain_verified,preview_url:sitePreviewUrl(config.baseUrl,item.slug),clicks_30d:stats.rows[0].clicks}});
  }
  if(p==='/api/site/generate'&&m==='POST'){
    rateGuard(req,'site-generate',8,60000);
    const input=normalizeSiteInput(await readJson(req));
    const prior=await query('SELECT slug FROM artisan_sites WHERE user_id=$1',[a.id]);
    const slug=prior.rows[0]?.slug||makeSlug(input);
    const generated=await generateSiteCopy(input);
    const site={...input,copy:generated.copy,copy_source:generated.source,slug};
    await query(`INSERT INTO artisan_sites(user_id,slug,site,status) VALUES($1,$2,$3,'draft')
      ON CONFLICT(user_id) DO UPDATE SET site=EXCLUDED.site,status='draft',domain_verified=false,custom_domain=NULL,updated_at=now()`,[a.id,slug,JSON.stringify(site)]);
    await audit(a.id,'site.generated',{job:input.job,slug,source:generated.source});
    return send(res,{site:{...site,status:'draft',preview_url:sitePreviewUrl(config.baseUrl,slug)},domains:suggestDomains(input),note:'Les domaines proposés ne sont pas encore vérifiés auprès d’un registrar.'},201);
  }
  if(p==='/api/site/publish'&&m==='POST'){
    const r=await query("UPDATE artisan_sites SET status='published',updated_at=now() WHERE user_id=$1 RETURNING slug,site",[a.id]);
    if(!r.rows.length)throw new HttpError('Générez votre site avant sa publication.',404);
    const item=r.rows[0],website=sitePreviewUrl(config.baseUrl,item.slug);
    const site=item.site;
    const prior=await getProfile(a.id);
    if(prior){
      await query("UPDATE profiles SET website=$1,phone=$2,business_name=$3,job=$4,updated_at=now() WHERE user_id=$5",[website,site.phone,site.business_name,site.job,a.id]);
    }
    await audit(a.id,'site.published',{slug:item.slug});
    return send(res,{published:true,url:website,tracking:{click_to_call:'active',answered_calls:'requires_google_ads_configuration'},notice:'Page publiée. Les clics sont mesurés, pas encore les appels réellement décrochés.'});
  }
  if(p==='/api/site/domains'&&m==='GET'){
    const r=await query('SELECT site FROM artisan_sites WHERE user_id=$1',[a.id]);
    if(!r.rows.length)throw new HttpError('Créez votre site pour recevoir des suggestions.',404);
    return send(res,{suggestions:suggestDomains(r.rows[0].site),purchase_available:false,notice:'La disponibilité, les prix et la commande nécessitent un compte revendeur de domaines et une intégration de paiement.'});
  }
  if(p==='/api/locations/suggest'&&m==='GET'){
    rateGuard(req,'locations',50,60000);
    const q=String(url.searchParams.get('q')||'');
    return send(res,{cities:await suggestCities(q)});
  }
  if(p==='/api/maps/config'&&m==='GET')return send(res,{googleMapsConfigured:Boolean(config.mapsBrowserKey),browserKey:config.mapsBrowserKey||null,provider:config.mapsBrowserKey?'google':'openstreetmap'});
  if(p==='/api/profile'&&m==='GET'){const profile=await getProfile(a.id);return send(res,{profile});}
  if(p==='/api/profile'&&m==='POST'){
    const x=await readJson(req);
    const job=String(x.job||'').toLowerCase(),cityInput=String(x.city||'').trim(),business=String(x.business_name||'').trim(),website=String(x.website||'').trim(),destination='site',budget=Number(x.budget_eur),adsMode=String(x.ads_mode||'new'),alert=Number(x.daily_max_alert_percent||25);
    const radius=validateRadiusKm(x.radius_km===undefined?20:x.radius_km);
    if(!/^[a-z]+$/.test(job)||job.length>50||!cityInput||cityInput.length>90||business.length>120||!['site','profile','both'].includes(destination)||!['new','existing'].includes(adsMode)||!Number.isFinite(budget)||budget<5||budget>5000||![10,25,50,100].includes(alert))throw new HttpError('Vérifiez votre métier, votre ville et votre budget.');
    if(website){try{const u=new URL(website);if(u.protocol!=='https:'||!u.hostname.includes('.')||u.username||u.password)throw Error()}catch{throw new HttpError('Le site doit être une adresse HTTPS valide.')}}
    if(!website)throw new HttpError('Créez votre site depuis le studio avant de préparer votre publicité.',422);
    let phone;
    try{phone=normalizeFrenchPhone(x.phone)}catch(e){throw new HttpError(e.message,422)}
    if(!phone)throw new HttpError('Ajoutez un numéro professionnel pour le bouton d’appel Google Ads.',422);
    const prior=await getProfile(a.id);
    const code=String(x.city_code||((prior?.city_code&&normalizeSearchText(prior.city)===normalizeSearchText(cityInput))?prior.city_code:'')).trim();
    if(!code)throw new HttpError('Choisissez votre ville dans la liste de suggestions.',422);
    let selectedCity;
    try{selectedCity=await findCityByCode(code)}catch(e){throw new HttpError('Impossible de vérifier votre commune : '+e.message,422)}
    if(normalizeSearchText(selectedCity.name)!==normalizeSearchText(cityInput))throw new HttpError('La ville a été modifiée : sélectionnez-la à nouveau dans les suggestions.',422);
    await query(`INSERT INTO profiles(user_id,business_name,job,city,city_code,city_lat,city_lng,radius_km,website,phone,destination,budget_eur,ads_mode,daily_max_alert_percent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(user_id) DO UPDATE SET business_name=EXCLUDED.business_name,job=EXCLUDED.job,city=EXCLUDED.city,city_code=EXCLUDED.city_code,city_lat=EXCLUDED.city_lat,city_lng=EXCLUDED.city_lng,radius_km=EXCLUDED.radius_km,website=EXCLUDED.website,phone=EXCLUDED.phone,destination=EXCLUDED.destination,budget_eur=EXCLUDED.budget_eur,ads_mode=EXCLUDED.ads_mode,daily_max_alert_percent=EXCLUDED.daily_max_alert_percent,geo_target_id=CASE WHEN profiles.city_code=EXCLUDED.city_code THEN profiles.geo_target_id ELSE NULL END,updated_at=now()`,
      [a.id,business,job,selectedCity.name,selectedCity.code,selectedCity.lat,selectedCity.lng,radius,website,phone,destination,budget,adsMode,alert]);
    await audit(a.id,'profile.save',{job,city:selectedCity.name,cityCode:selectedCity.code,radiusKm:radius,destination,budget,phoneConfigured:true});
    return send(res,{saved:true,phone,location:{name:selectedCity.name,code:selectedCity.code,lat:selectedCity.lat,lng:selectedCity.lng,radiusKm:radius}});
  }
  if(p==='/api/integrations'){
    const r=await query('SELECT provider FROM integrations WHERE user_id=$1',[a.id]);
    const s=await query('SELECT stripe_customer_id,status FROM subscriptions WHERE user_id=$1',[a.id]);
    const cfg=integrationsConfigured();
    return send(res,{googleAds:{configured:cfg.google,connected:r.rows.some(x=>x.provider==='ads')},googleBusiness:{configured:cfg.business,connected:r.rows.some(x=>x.provider==='business')},stripe:{configured:cfg.stripe,status:s.rows[0]?.status||'inactive'},ai:{configured:cfg.ai},limits:{accountCreation:config.allowAccountCreation,campaignWrites:config.allowCampaignWrites,activation:config.allowActivation,locationSync:config.allowLocationSync}});
  }
  if(p==='/api/google/connect'&&m==='GET'){
    if(!integrationsConfigured().google)throw new HttpError('Google Ads n’est pas encore configuré par l’administrateur.',503);
    let provider=url.searchParams.get('provider')==='business'?'business':'ads';
    if(provider==='business'&&!integrationsConfigured().business)throw new HttpError('Google Business Profile n’est pas encore activé.',503);
    const state=token();await query('INSERT INTO oauth_states(state_hash,user_id,provider,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')',[sha(state),a.id,provider]);
    return redirect(res,oauthUrl({state,provider}));
  }
  if(p==='/api/google/callback'&&m==='GET'){
    const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
    if(!/^[a-f0-9]{64}$/.test(state)||!code)throw new HttpError('Connexion Google refusée ou expirée',400);
    const check=await query('DELETE FROM oauth_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING provider',[sha(state),a.id]);
    if(!check.rows.length)throw new HttpError('Autorisation expirée. Réessayez.',400);
    const tok=await exchangeCode(code);await storeTokens(query,a.id,check.rows[0].provider,tok);
    await audit(a.id,'google.oauth', {provider:check.rows[0].provider});return redirect(res,config.baseUrl+'/?google=connected#connections');
  }
  if(p==='/api/google/accounts'&&m==='GET'){
    if(!integrationsConfigured().google)throw new HttpError('Google Ads non configuré',503);
    const accounts=await listAccounts(query,a.id);const selected=await selectedAccount(a.id);
    return send(res,{accounts,selected:selected?.customer_id||null});
  }
  if(p==='/api/google/accounts/select'&&m==='POST'){
    const x=await readJson(req);const id=safeCustomerId(x.customerId);if(!id)throw new HttpError('Compte invalide');
    const roots=await listAccounts(query,a.id);
    let account=roots.find(v=>v.id===id);
    if(!account){
      const prior=await query('SELECT customer_id,name,currency,timezone FROM google_accounts WHERE user_id=$1 AND customer_id=$2',[a.id,id]);
      if(prior.rows[0])account={id,name:prior.rows[0].name,currency:prior.rows[0].currency,timezone:prior.rows[0].timezone};
    }
    if(!account)throw new HttpError('Compte non accessible avec votre autorisation Google.',403);
    if(account.currency && account.currency!=='EUR')throw new HttpError('Cette version facture les budgets en EUR. Sélectionnez un compte Google Ads en euros.',422);
    if(!account.currency)throw new HttpError('Impossible de vérifier la devise du compte. Vérifiez les accès Google Ads avant de continuer.',422);
    const client=await pool.connect();
    try{await client.query('BEGIN');await client.query('UPDATE google_accounts SET selected=false WHERE user_id=$1',[a.id]);
      await client.query(`INSERT INTO google_accounts(user_id,customer_id,name,currency,timezone,selected) VALUES($1,$2,$3,$4,$5,true)
        ON CONFLICT(user_id,customer_id) DO UPDATE SET selected=true,name=EXCLUDED.name,currency=EXCLUDED.currency,timezone=EXCLUDED.timezone`,
        [a.id,id,account.name,account.currency||'EUR',account.timezone||'Europe/Paris']);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    await audit(a.id,'google.account.select',{id});return send(res,{selected:id});
  }
  if(p==='/api/google/account-create/check'&&m==='POST'){
    if(!integrationsConfigured().google||!config.mccId)throw new HttpError('Création de comptes non disponible sans compte MCC éligible.',503);
    const profile=await getProfile(a.id);if(!profile)throw new HttpError('Configurez d’abord votre activité.');
    const outcome=await createCustomer(query,a.id,profile.business_name||profile.job,{validateOnly:true});
    return send(res,{eligibility:'validated_by_google',result:outcome,notice:'Google doit également valider la facturation du nouveau compte.'});
  }
  if(p==='/api/google/account-create'&&m==='POST'){
    if(!config.allowAccountCreation)throw new HttpError('Création automatique de compte Google Ads désactivée par sécurité.',503);
    const x=await readJson(req);if(x.confirm!=='JE CONFIRME LA CREATION DU COMPTE')throw new HttpError('Confirmation explicite obligatoire.');
    const profile=await getProfile(a.id);if(!profile)throw new HttpError('Configurez votre entreprise.');
    if((await selectedAccount(a.id))?.created_by_app)throw new HttpError('Un compte créé par ArtisanPilot est déjà sélectionné.',409);
    const outcome=await createCustomer(query,a.id,profile.business_name||profile.job,{validateOnly:false});
    const id=safeCustomerId(outcome.resourceName?.split('/')[1]);if(!id)throw new HttpError('Google a répondu sans identifiant client. Contactez le support.',502);
    await query('UPDATE google_accounts SET selected=false WHERE user_id=$1',[a.id]);
    await query(`INSERT INTO google_accounts(user_id,customer_id,name,selected,created_by_app) VALUES($1,$2,$3,true,true)
      ON CONFLICT(user_id,customer_id) DO UPDATE SET selected=true`,[a.id,id,profile.business_name||'ArtisanPilot']);
    let invitation='pending';
    try{await inviteNewCustomerAdmin(query,a.id,id);invitation='sent'}catch(e){console.warn('Admin invitation not sent',id,String(e.message).slice(0,130))}
    await audit(a.id,'google.account.created',{id,invitation});return send(res,{created:true,customerId:id,invitation,billingNeeded:true,notice:'Compte créé. Vous devez configurer le paiement chez Google Ads et accepter l’invitation administrateur avant toute diffusion.'},201);
  }
  if(p==='/api/google/geo'&&m==='GET'){
    const profile=await getProfile(a.id);if(!profile)throw new HttpError('Complétez votre activité.');
    return send(res,{locations:await geoSuggestions(query,a.id,profile.city)});
  }
  if(p==='/api/google/geo/select'&&m==='POST'){
    const x=await readJson(req),id=String(x.id||'');if(!/^\d{3,10}$/.test(id))throw new HttpError('Ciblage invalide');
    const profile=await getProfile(a.id);if(!profile)throw new HttpError('Complétez votre activité.');
    const eligible=await geoSuggestions(query,a.id,profile.city);
    if(!eligible.some(v=>v.id===id))throw new HttpError('Cette zone ne correspond pas à votre ville.',403);
    await query('UPDATE profiles SET geo_target_id=$1,updated_at=now() WHERE user_id=$2',[id,a.id]);
    return send(res,{selected:id});
  }
  if(p==='/api/google/business/accounts'&&m==='GET'){
    if(!integrationsConfigured().business)throw new HttpError('Google Business Profile non configuré.',503);
    return send(res,{accounts:await listBusinessAccounts(query,a.id),notice:'La liaison et la diffusion locale nécessitent une vérification de l’éligibilité Google Maps.'});
  }
  if(p==='/api/google/business/link'&&m==='POST'){
    if(!config.allowLocationSync)throw new HttpError('Liaison publicitaire de la fiche Google désactivée par sécurité.',503);
    if(!integrationsConfigured().business||!integrationsConfigured().google)throw new HttpError('Connectez séparément Google Ads et Google Business Profile.',503);
    const account=await selectedAccount(a.id);if(!account)throw new HttpError('Sélectionnez votre compte Google Ads.');
    const input=await readJson(req),businessAccountId=String(input.businessAccountId||'');
    if(!/^\d{3,30}$/.test(businessAccountId)||input.confirm!=='ASSOCIER MA FICHE')throw new HttpError('Fiche ou confirmation invalide.');
    const prior=await query('SELECT asset_set FROM business_links WHERE user_id=$1 AND customer_id=$2',[a.id,account.customer_id]);
    if(prior.rows.length)throw new HttpError('Une fiche est déjà associée à ce compte.',409);
    const result=await linkBusinessLocationAssets(query,a.id,account.customer_id,businessAccountId);
    await query('INSERT INTO business_links(user_id,customer_id,business_account_id,asset_set) VALUES($1,$2,$3,$4)',[a.id,account.customer_id,businessAccountId,result.assetSet]);
    await audit(a.id,'google.business.linked',{customerId:account.customer_id,businessAccountId,assetSet:result.assetSet});
    return send(res,{linked:true,assetSet:result.assetSet,notice:result.notice});
  }
  if(p==='/api/google/metrics'&&m==='GET'){
    const account=await selectedAccount(a.id);if(!account)throw new HttpError('Sélectionnez d’abord votre compte Google Ads.');
    const metrics=await dailyMetrics(query,a.id,account.customer_id);
    const profile=await getProfile(a.id);
    const rows=metrics.map(r=>({date:r.segments?.date,spent:Number(r.metrics?.costMicros||0)/1e6,clicks:Number(r.metrics?.clicks||0),impressions:Number(r.metrics?.impressions||0),conversions:Number(r.metrics?.conversions||0),phoneCalls:Number(r.metrics?.phoneCalls||0)}));
    const latest=rows[0]||null;
    const old=rows.slice(1,8).filter(r=>r.impressions>0);
    const demand=latest?performanceAlert(latest,0,old.length?old.reduce((x,y)=>x+y.impressions,0)/old.length:NaN):{demandValidated:false};
    const notice=latest&&profile?dailyBudgetInfo(Number(profile.budget_eur),latest.spent,demand):null;
    return send(res,{customerId:account.customer_id,rows,latest,notice,disclaimer:'Conversions Google Ads et appels qualifiés ne sont pas identiques sans suivi vérifié.'});
  }
  if(p==='/api/notifications'&&m==='GET'){
    const notices=await query('SELECT id,report_date,kind,title,body,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 25',[a.id]);
    return send(res,{notifications:notices.rows});
  }
  const notificationMatch=p.match(/^\/api\/notifications\/([0-9a-f-]{36})\/read$/);
  if(notificationMatch&&m==='POST'){
    const changed=await query('UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 RETURNING id',[notificationMatch[1],a.id]);
    if(!changed.rows.length)throw new HttpError('Notification introuvable',404);
    return send(res,{read:true});
  }
  if(p==='/api/google/recommendations'&&m==='GET'){
    const account=await selectedAccount(a.id);if(!account)throw new HttpError('Sélectionnez votre compte Google Ads.');
    const rows=await searchTerms(query,a.id,account.customer_id);
    return send(res,{suggestions:suggestExclusions(rows),source:'Google Ads search_term_view',disclaimer:'Suggestions uniquement. Aucune exclusion automatique ni économie garantie.'});
  }
  if(p==='/api/campaigns/drafts'&&m==='GET'){
    const drafts=await query('SELECT id,customer_id,status,plan,google_campaign_resource,created_at FROM campaign_drafts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[a.id]);
    return send(res,{drafts:drafts.rows});
  }
  if(p==='/api/campaigns/drafts'&&m==='POST'){
    const profile=await getProfile(a.id);if(!profile)throw new HttpError('Complétez votre activité avant de préparer la publicité.');
    const plan=generatePlan(profile);const selected=await selectedAccount(a.id);
    const result=await query('INSERT INTO campaign_drafts(user_id,customer_id,plan) VALUES($1,$2,$3) RETURNING id,created_at',[a.id,selected?.customer_id||null,JSON.stringify(plan)]);
    await audit(a.id,'campaign.draft',{draftId:result.rows[0].id});
    return send(res,{draft:{id:result.rows[0].id,plan,status:'draft',createdAt:result.rows[0].created_at}},201);
  }
  const draftMatch=p.match(/^\/api\/campaigns\/drafts\/([0-9a-f-]{36})(?:\/(validate|prepare-paused|activate|suggest-copy))?$/);
  if(draftMatch){
    const id=draftMatch[1],action=draftMatch[2];const result=await query('SELECT id,user_id,customer_id,status,plan,google_campaign_resource FROM campaign_drafts WHERE id=$1 AND user_id=$2',[id,a.id]);
    const draft=result.rows[0];if(!draft)throw new HttpError('Brouillon introuvable',404);
    if(!action&&m==='GET')return send(res,{draft});
    if(m!=='POST')throw new HttpError('Méthode non autorisée',405);
    if(action==='suggest-copy'){
      if(draft.status!=='draft')throw new HttpError('Ce brouillon ne peut plus être modifié.');
      const copy=await generateOptionalCopy(draft.plan);const next={...draft.plan,headlines:copy.headlines,descriptions:copy.descriptions,copySource:copy.source};
      await query('UPDATE campaign_drafts SET plan=$1,updated_at=now() WHERE id=$2 AND user_id=$3',[JSON.stringify(next),id,a.id]);
      return send(res,{copy,notice:'Relisez chaque annonce : aucune garantie publicitaire n’est déduite automatiquement.'});
    }
    const account=await selectedAccount(a.id);if(!account||account.customer_id!==draft.customer_id)throw new HttpError('Le compte publicitaire sélectionné ne correspond plus à ce brouillon.',409);
    if(!integrationsConfigured().google)throw new HttpError('Google Ads non configuré.',503);
    if(action==='validate'){
      const response=await createPausedCampaign(query,a.id,account.customer_id,draft.plan,{validateOnly:true});
      await query('UPDATE campaign_drafts SET status=$1,updated_at=now() WHERE id=$2',['validated',id]);
      return send(res,{validated:true,google:response,notice:'Aucune campagne créée : validation sans écriture.'});
    }
    if(action==='prepare-paused'){
      if(!config.allowCampaignWrites)throw new HttpError('Écriture Google Ads désactivée. Activez-la après tests.',503);
      if(draft.status!=='validated')throw new HttpError('Validez d’abord ce brouillon auprès de Google Ads.');
      if(draft.plan.destination!=='site')throw new HttpError('Pour la fiche Google, utilisez le parcours local spécifique.');
      const input=await readJson(req);if(input.confirm!=='CREER EN PAUSE')throw new HttpError('Confirmation explicite manquante.');
      const lock=await query("UPDATE campaign_drafts SET status='publishing',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='validated' RETURNING id",[id,a.id]);
      if(!lock.rows.length)throw new HttpError('Ce brouillon est déjà en cours de traitement.',409);
      let google;
      try{google=await createPausedCampaign(query,a.id,account.customer_id,draft.plan,{validateOnly:false});}
      catch(e){await query("UPDATE campaign_drafts SET status='needs_review' WHERE id=$1",[id]);throw e}
      const name=google.mutateOperationResponses?.find(x=>x.campaignResult)?.campaignResult?.resourceName||null;
      await query("UPDATE campaign_drafts SET status='paused',google_campaign_resource=$1,updated_at=now() WHERE id=$2",[name,id]);
      await audit(a.id,'campaign.paused_created',{id,customerId:account.customer_id,campaignResource:name});
      return send(res,{created:true,status:'PAUSED',campaignResource:name,notice:'Votre campagne est créée EN PAUSE et ne peut pas dépenser tant qu’elle n’est pas activée.'});
    }
    if(action==='activate'){
      if(!config.allowActivation)throw new HttpError('Activation de campagnes désactivée par l’administrateur.',503);
      if(draft.status!=='paused'||!draft.google_campaign_resource)throw new HttpError('La campagne doit exister en pause avant activation.');
      const profile=await getProfile(a.id);
      if(!profile?.conversion_verified)throw new HttpError('Le suivi des conversions doit être vérifié par le support avant activation.',403);
      const payment=await query('SELECT status FROM subscriptions WHERE user_id=$1',[a.id]);
      if(!['active','trialing'].includes(payment.rows[0]?.status))throw new HttpError('Un abonnement actif est nécessaire avant activation.',402);
      const input=await readJson(req);if(input.confirm!=='JE VALIDE LE BUDGET ET LA DIFFUSION')throw new HttpError('Confirmez explicitement le budget et la mise en diffusion.');
      const next=await enableCampaign(query,a.id,account.customer_id,draft.google_campaign_resource);
      await query("UPDATE campaign_drafts SET status='active',updated_at=now() WHERE id=$1",[id]);
      await audit(a.id,'campaign.enabled',{id,customerId:account.customer_id});
      return send(res,{active:true,google:next});
    }
  }
  if(p==='/api/stripe/checkout'&&m==='POST'){
    if(!integrationsConfigured().stripe)throw new HttpError('Paiement non encore activé.',503);
    const session=await createCheckout({userId:a.id,email:a.email});return send(res,{url:session.url});
  }
  if(p==='/api/stripe/portal'&&m==='POST'){
    const subscription=await query('SELECT stripe_customer_id FROM subscriptions WHERE user_id=$1',[a.id]);
    if(!subscription.rows[0]?.stripe_customer_id)throw new HttpError('Aucun abonnement Stripe associé.');
    const session=await createPortal(subscription.rows[0].stripe_customer_id);return send(res,{url:session.url});
  }
  if(p==='/api/subscription'&&m==='GET'){
    const r=await query('SELECT status,updated_at FROM subscriptions WHERE user_id=$1',[a.id]);return send(res,{subscription:r.rows[0]||{status:'inactive'}});
  }
  throw new HttpError('Fonction introuvable',404);
}
async function runDailyReports(res){
  const accounts=await query('SELECT user_id,customer_id FROM google_accounts WHERE selected=true LIMIT 100');
  let ok=0,errors=0;
  for(const account of accounts.rows){
    try{
      const rows=await dailyMetrics(query,account.user_id,account.customer_id);
      for(const row of rows.slice(0,2)){
        const date=row.segments?.date;
        if(!/^\d{4}-\d\d-\d\d$/.test(String(date||'')))continue;
        const met=row.metrics||{};
        await query(`INSERT INTO performance_snapshots(user_id,customer_id,report_date,impressions,clicks,spend_micros,conversions,phone_calls) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(user_id,customer_id,report_date) DO UPDATE SET impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,spend_micros=EXCLUDED.spend_micros,conversions=EXCLUDED.conversions,phone_calls=EXCLUDED.phone_calls`,
          [account.user_id,account.customer_id,date,Number(met.impressions||0),Number(met.clicks||0),Number(met.costMicros||0),Number(met.conversions||0),Number(met.phoneCalls||0)]);
      }
      const profile=await getProfile(account.user_id),history=rows.map(r=>({date:r.segments?.date,spent:Number(r.metrics?.costMicros||0)/1e6,impressions:Number(r.metrics?.impressions||0)}));
      if(profile){
        const previous=history.slice(1,8).filter(x=>x.impressions>0);
        for(const rec of history.slice(0,2)){
          if(!/^\d{4}-\d\d-\d\d$/.test(rec.date||''))continue;
          const threshold=Number(profile.budget_eur)*(1+Number(profile.daily_max_alert_percent||25)/100);
          if(rec.spent<=threshold)continue;
          const usual=previous.length?previous.reduce((x,y)=>x+y.impressions,0)/previous.length:NaN;
          const demand=performanceAlert(rec,null,usual);
          const detail=dailyBudgetInfo(Number(profile.budget_eur),rec.spent,demand);
          await query('INSERT INTO notifications(user_id,customer_id,report_date,kind,title,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,customer_id,report_date,kind) DO NOTHING',
            [account.user_id,account.customer_id,rec.date,'BUDGET_OVER_AVERAGE','Votre budget a davantage dépensé',detail.explanation]);
        }
      }
      ok++;
    }catch(e){errors++;console.error('Daily collection failed',account.customer_id,String(e.message).slice(0,100));}
  }
  return send(res,{processed:ok,errors,notes:'Lecture des métriques uniquement. Aucune modification de campagne.'});
}
http.createServer(async(req,res)=>{
  try{await handle(req,res)}
  catch(e){const status=e instanceof HttpError?e.status:e instanceof ProviderError?e.status:500;
    if(status>=500)console.error('Request error',req.method,req.url,e.message);
    else if(status===422&&e.detail)console.info('Provider validation',String(e.detail).slice(0,240));
    if(!res.headersSent)response(res,status,{error:status===500?'Erreur interne. Réessayez ou contactez le support.':e.message,detail:status===422?String(e.detail||'').slice(0,140):undefined});else res.end();
  }
}).listen(config.port,'0.0.0.0',()=>console.info('ArtisanPilot listening on',config.port));
