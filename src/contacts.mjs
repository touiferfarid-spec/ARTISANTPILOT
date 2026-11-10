import {config} from './config.mjs';
import {normalizeFrenchPhone} from './phone.mjs';
import {sha,token} from './security.mjs';
import {AppError} from './errors.mjs';

export function lovableUrl(value) {
  let u;try{u=new URL(value)}catch{throw new AppError('Collez l’adresse publiée de votre site Lovable.',422)}
  if(u.protocol!=='https:'||u.port||u.username||u.password||!u.hostname.endsWith('.lovable.app')||u.hostname.includes('preview'))throw new AppError('Utilisez une adresse publiée https://….lovable.app.',422);
  u.search='';u.hash='';u.pathname='/';return u;
}
export function normalizeLead(x={}) {
  let phone;try{phone=normalizeFrenchPhone(x.phone)}catch(e){throw new AppError(e.message,422)}
  const name=String(x.name||'').trim().replace(/[\u0000-\u001f]/g,' ').slice(0,100);
  if(!phone||name.length<2)throw new AppError('Indiquez votre nom et un numéro de téléphone valide.',422);
  if(x.consent!==true)throw new AppError('Autorisez l’entreprise à vous recontacter au sujet de votre demande.',422);
  return {phone,name,message:String(x.message||'').trim().slice(0,1200),requestKey:/^[a-zA-Z0-9-]{16,80}$/.test(x.requestId||'')?x.requestId:null};
}
export function publicSite(record,baseUrl=config.baseUrl) {
  const s=record.site;
  const fields=['business_name','job','job_label','city','radius_km','email','phone','services','description','advantage','schedule','siret','legal_address','copy','design_style'];
  const site=Object.fromEntries(fields.map(k=>[k,s[k]]));
  const matches=Boolean(record.customer_id&&s.google_customer_id===record.customer_id);
  return {...site,slug:record.slug,url:baseUrl+'/p/'+record.slug,
    tracking:matches?{adsId:s.google_tag_id||'',label:s.google_conversion_label||''}:{adsId:'',label:''},
    leadEndpoint:baseUrl+'/api/public/sites/'+record.slug+'/leads',
    scriptUrl:baseUrl+'/site-track.js',
    legalUrl:baseUrl+'/p/'+record.slug+'/mentions-legales',privacyUrl:baseUrl+'/p/'+record.slug+'/confidentialite'};
}
export async function contactRoutes(req,res,url,ctx) {
  const {query,send,readJson,sessionUser,rateGuard,audit}=ctx,m=req.method,p=url.pathname;
  const publicMatch=p.match(/^\/api\/public\/sites\/([a-z0-9-]{5,90})(?:\/(leads|events))?$/);
  if(publicMatch){
    const [,slug,action]=publicMatch;
    const r=await query("SELECT s.user_id,s.site,s.slug,s.status,g.customer_id,e.origin AS external_origin,e.verified_at FROM artisan_sites s LEFT JOIN google_accounts g ON g.user_id=s.user_id AND g.selected=true LEFT JOIN external_sites e ON e.user_id=s.user_id WHERE s.slug=$1 AND s.status='published'",[slug]);
    if(!r.rows[0])throw new AppError('Ce site n’est pas publié.',404);
    const record=r.rows[0],origin=req.headers.origin;
    const templateOrigin=config.lovableTemplateUrl?new URL(config.lovableTemplateUrl).origin:'';
    const allowed=origin===config.baseUrl||origin===templateOrigin||(record.verified_at&&origin===record.external_origin);
    const cors=allowed?{'access-control-allow-origin':origin,'vary':'Origin'}:{};
    if(!action&&m==='GET'){send(res,{site:publicSite(record)},200,{'access-control-allow-origin':'*'});return true;}
    if(allowed){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');}
    if(!allowed)throw new AppError('Ce site n’a pas encore été connecté à ArtisanPilot.',403);
    if(m==='OPTIONS'){send(res,{},204,{...cors,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type','access-control-max-age':'600'});return true;}
    if(m!=='POST')throw new AppError('Méthode non autorisée.',405);
    await rateGuard(req,'public:'+slug+':'+action,action==='leads'?5:40,600000);
    const x=await readJson(req),source=origin===config.baseUrl?'website':'lovable';
    if(action==='leads'){
      if(x.company){send(res,{received:true},202,cors);return true;}
      const lead=normalizeLead(x);
      await query('INSERT INTO site_leads(site_user_id,name,phone,message,source,request_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(site_user_id,request_key) DO NOTHING',[record.user_id,lead.name,lead.phone,lead.message,source,lead.requestKey]);
      send(res,{received:true,message:'Votre demande est transmise. L’entreprise pourra vous rappeler.'},202,cors);return true;
    }
    if(action==='events'){
      if(x.type!=='call_click')throw new AppError('Événement invalide.',422);
      const eventKey=/^[a-zA-Z0-9-]{16,80}$/.test(x.requestId||'')?x.requestId:null;
      const ip=ctx.clientIp(req);
      await query('INSERT INTO site_call_clicks(site_user_id,source,visitor_hash,event_key) VALUES($1,$2,$3,$4) ON CONFLICT(site_user_id,event_key) DO NOTHING',[record.user_id,source,sha(ip+':'+record.user_id+':'+new Date().toISOString().slice(0,10)),eventKey]);
      send(res,{recorded:true,metric:'click_to_call'},202,cors);return true;
    }
    throw new AppError('Fonction introuvable.',404);
  }
  if(!['/api/leads','/api/site/external','/api/site/external/verify'].includes(p)&&!/^\/api\/leads\/[a-f0-9-]{36}$/.test(p))return false;
  const a=await sessionUser(req);if(!a)throw new AppError('Connectez-vous.',401);
  if(p==='/api/leads'&&m==='GET'){
    const r=await query('SELECT id,name,phone,message,source,status,created_at FROM site_leads WHERE site_user_id=$1 ORDER BY created_at DESC LIMIT 200',[a.id]);
    send(res,{leads:r.rows});return true;
  }
  const leadMatch=p.match(/^\/api\/leads\/([a-f0-9-]{36})$/);
  if(leadMatch&&m==='PATCH'){
    const x=await readJson(req);if(!['new','callback','qualified','won','irrelevant'].includes(x.status))throw new AppError('Statut invalide.',422);
    const r=await query('UPDATE site_leads SET status=$1,updated_at=now() WHERE id=$2 AND site_user_id=$3 RETURNING id',[x.status,leadMatch[1],a.id]);
    if(!r.rows.length)throw new AppError('Demande introuvable.',404);
    await audit(a.id,'lead.status',{id:leadMatch[1],status:x.status});send(res,{updated:true});return true;
  }
  if(p==='/api/site/external'&&m==='GET'){
    const r=await query('SELECT url,challenge,verified_at FROM external_sites WHERE user_id=$1',[a.id]);send(res,{external:r.rows[0]||null});return true;
  }
  if(p==='/api/site/external'&&m==='POST'){
    const x=await readJson(req),u=lovableUrl(x.url);
    const site=await query('SELECT slug FROM artisan_sites WHERE user_id=$1',[a.id]);if(!site.rows[0])throw new AppError('Créez d’abord votre site.',422);
    const challenge=token();
    await query('INSERT INTO external_sites(user_id,url,origin,challenge) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET url=EXCLUDED.url,origin=EXCLUDED.origin,challenge=EXCLUDED.challenge,verified_at=NULL',[a.id,u.href,u.origin,challenge]);
    send(res,{external:{url:u.href,challenge,verified_at:null},instruction:`Ajoutez dans le head du site Lovable : <meta name="artisanpilot-verification" content="${challenge}">`});return true;
  }
  if(p==='/api/site/external/verify'&&m==='POST'){
    await rateGuard(req,'verify-external',5,600000);
    const r=await query('SELECT url,challenge FROM external_sites WHERE user_id=$1',[a.id]);if(!r.rows[0])throw new AppError('Indiquez l’adresse de votre site Lovable.',422);
    const external=r.rows[0],u=lovableUrl(external.url);
    // Only the published Lovable hosting domain is fetched, with no redirects.
    const remote=await fetch(u.href,{redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!remote.ok)throw new AppError('Le site Lovable ne répond pas. Publiez-le puis réessayez.',422);
    const reader=remote.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>500000)throw new AppError('Page trop volumineuse pour la vérification.',422);chunks.push(value)}}finally{await reader.cancel().catch(()=>{});}
    const html=Buffer.concat(chunks).toString('utf8');
    const metas=html.match(/<meta\b[^>]{0,1000}>/gi)||[];
    if(!metas.some(v=>/name\s*=\s*["']artisanpilot-verification["']/i.test(v)&&v.includes(`content="${external.challenge}"`)))throw new AppError('La balise de connexion n’est pas encore présente. Ajoutez-la dans Lovable et republiez.',422);
    await query('UPDATE external_sites SET verified_at=now(),last_checked_at=now() WHERE user_id=$1 AND challenge=$2',[a.id,external.challenge]);
    await audit(a.id,'site.lovable.connected',{origin:u.origin});
    send(res,{verified:true,url:u.href,message:'Site connecté : les demandes et clics seront visibles dans votre espace.'});return true;
  }
  throw new AppError('Méthode non autorisée.',405);
}
