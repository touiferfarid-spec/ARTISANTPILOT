import {config,integrationsConfigured} from './config.mjs';
import {AppError} from './errors.mjs';
import {readTrackedCalls,listCallActions,configureCallActions,tagInfo,readCallReporting} from './google-calls.mjs';
import {findCityByCode} from './locations.mjs';
import {dailyMetrics,listAccounts,requestAds} from './ads.mjs';

export async function platformRoutes(req,res,url,ctx){
  const {query,send,readJson,sessionUser,rateGuard,audit,selectedAccount}=ctx,p=url.pathname,m=req.method;
  const routes=['/api/overview','/api/tracking','/api/tracking/install','/api/tracking/verify','/api/integrations/check','/api/google/disconnect','/api/calls/review','/api/site/template'];
  if(!routes.includes(p))return false;
  const a=await sessionUser(req);if(!a)throw new AppError('Connectez-vous.',401);
  const account=await selectedAccount(a.id);
  if(p==='/api/overview'&&m==='GET'){
    const [site,leads,clicks,linked,external]=await Promise.all([
      query('SELECT slug,status,draft IS NOT NULL AS has_draft,site,updated_at FROM artisan_sites WHERE user_id=$1',[a.id]),
      query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status IN ('new','callback'))::int AS waiting,count(*) FILTER(WHERE status='won')::int AS won FROM site_leads WHERE site_user_id=$1 AND created_at>now()-interval '30 days'",[a.id]),
      query("SELECT count(*)::int AS total FROM site_call_clicks WHERE site_user_id=$1 AND occurred_at>now()-interval '30 days'",[a.id]),
      query('SELECT provider FROM integrations WHERE user_id=$1',[a.id]),
      query('SELECT url,verified_at FROM external_sites WHERE user_id=$1',[a.id])
    ]);
    const s=site.rows[0],e=external.rows[0];
    const cfg=integrationsConfigured();
    send(res,{user:{email:a.email,emailVerified:a.email_verified},
      site:s?{name:s.site.business_name,city:s.site.city,slug:s.slug,status:s.status,hasDraft:s.has_draft,url:e?.verified_at?e.url:config.baseUrl+'/p/'+s.slug,updatedAt:s.updated_at}:null,
      contacts:{...leads.rows[0],clicks:clicks.rows[0].total},account,
      connections:{google:linked.rows.some(x=>x.provider==='ads'),googleConfigured:cfg.google,openaiConfigured:cfg.ai,emailConfigured:cfg.email,lovableConnected:Boolean(e?.verified_at),billingConfigured:cfg.stripe},
      capabilities:{campaignWrites:config.allowCampaignWrites,activation:config.allowCampaignWrites&&config.allowActivation,conversionWrites:config.allowConversionWrites,pilotAccess:!config.billingRequired},
      period:'30 derniers jours',templateUrl:config.lovableTemplateUrl||null});return true;
  }
  if(p==='/api/site/template'&&m==='POST'){
    if(!config.lovableTemplateUrl)throw new AppError('Le modèle Lovable n’est pas encore disponible.',503);
    const r=await query("SELECT slug FROM artisan_sites WHERE user_id=$1 AND status='published'",[a.id]);
    if(!r.rows[0])throw new AppError('Publiez d’abord votre site.',422);
    const target=new URL(config.lovableTemplateUrl);target.searchParams.set('site',r.rows[0].slug);
    await query("INSERT INTO external_sites(user_id,url,origin,challenge,verified_at) VALUES($1,$2,$3,'shared-template',now()) ON CONFLICT(user_id) DO UPDATE SET url=EXCLUDED.url,origin=EXCLUDED.origin,challenge=EXCLUDED.challenge,verified_at=now()",[a.id,target.href,target.origin]);
    await query('UPDATE profiles SET website=$1,updated_at=now() WHERE user_id=$2',[target.href,a.id]);
    await audit(a.id,'site.lovable.template');send(res,{url:target.href,connected:true});return true;
  }
  if(p==='/api/google/disconnect'&&m==='POST'){
    await query("DELETE FROM integrations WHERE user_id=$1 AND provider='ads'",[a.id]);
    await query('UPDATE google_accounts SET selected=false WHERE user_id=$1',[a.id]);
    await query('UPDATE profiles SET conversion_verified=false WHERE user_id=$1',[a.id]);
    await query("UPDATE artisan_sites SET site=site-'google_tag_id'-'google_conversion_label'-'google_customer_id',draft=CASE WHEN draft IS NULL THEN NULL ELSE draft-'google_tag_id'-'google_conversion_label'-'google_customer_id' END WHERE user_id=$1",[a.id]);
    await audit(a.id,'google.disconnected');send(res,{disconnected:true});return true;
  }
  if(p==='/api/integrations/check'&&m==='POST'){
    await rateGuard(req,'integration-check',3,300000);
    await rateGuard(req,'integration-check-user:'+a.id,3,86400000);
    const checks={database:{status:'ok',message:'Vos données sont enregistrées.'},openai:{status:'not_configured'},google:{status:account?'pending':'not_connected'}};
    const linked=await query("SELECT 1 FROM integrations WHERE user_id=$1 AND provider='ads'",[a.id]);
    if(!account&&linked.rows.length)checks.google={status:'needs_selection',message:'Autorisation enregistrée. Choisissez votre compte dans « Ma publicité Google ».'};
    if(!account&&!linked.rows.length)checks.google.message='Connectez votre compte dans « Ma publicité Google ».';
    try{await findCityByCode('69123');checks.locations={status:'ok',message:'La recherche des communes françaises est disponible.'}}catch{checks.locations={status:'error',message:'Le service des communes ne répond pas pour le moment.'};}
    checks.maps={status:config.mapsBrowserKey?'browser_check':'not_configured',message:config.mapsBrowserKey?'La carte se vérifie en affichant votre zone dans « Mon site internet ».':'La carte Google n’est pas configurée. La sélection de ville reste disponible.'};
    if(config.openaiKey){
      try{
        const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+config.openaiKey},body:JSON.stringify({model:config.openaiModel,input:'Réponds uniquement OK.',max_output_tokens:32,store:false}),signal:AbortSignal.timeout(20000)});
        // Do not return upstream bodies, identifiers or credentials.
        checks.openai={status:r.ok?'ok':'error',message:r.ok?'La génération OpenAI est disponible.':r.status===401?'La clé OpenAI est refusée.':r.status===429?'Quota ou limite OpenAI atteint.':'Le modèle OpenAI configuré est indisponible.'};
      }catch{checks.openai={status:'error',message:'OpenAI ne répond pas pour le moment.'};}
    }
    if(account){try{await requestAds(query,a.id,`customers/${account.customer_id}/googleAds:search`,{body:{query:'SELECT customer.id FROM customer LIMIT 1'}});checks.google={status:'ok',message:'Compte Google Ads accessible.'}}catch(e){checks.google={status:'error',message:e.message,detail:e.detail||''}}}
    if(account&&checks.google.status==='ok'){
      try{const [settings,actions]=await Promise.all([readCallReporting(query,a.id,account.customer_id),listCallActions(query,a.id,account.customer_id)]);
        const action=actions.some(x=>x.type==='WEBSITE_CALL'&&x.status==='ENABLED'&&tagInfo(x));
        checks.calls={status:settings.enabled&&settings.conversionsEnabled&&action?'configured':'needs_setup',message:!settings.enabled||!settings.conversionsEnabled?'Activez les rapports et conversions d’appels dans Google Ads.':!action?'Ajoutez la conversion d’appels depuis le site dans Google Ads.':'La configuration Google est présente. Installez la balise puis vérifiez un appel réel.'};
      }catch{checks.calls={status:'error',message:'Impossible de lire la configuration des appels dans Google Ads.'};}
    }
    send(res,{checks});return true;
  }
  if(p==='/api/tracking'&&m==='GET'){
    const s=await query('SELECT site FROM artisan_sites WHERE user_id=$1',[a.id]);
    const check=await query('SELECT status,checked_at FROM tracking_checks WHERE user_id=$1 AND customer_id=$2',[a.id,account?.customer_id||'']);
    const site=s.rows[0]?.site;
    send(res,{account:Boolean(account),installed:Boolean(account&&site?.google_customer_id===account.customer_id&&site?.google_tag_id&&site?.google_conversion_label),
      check:check.rows[0]||null,canCreate:config.allowConversionWrites,minimumSeconds:60,
      note:'Un clic sur le numéro n’est pas un appel décroché. Google rapporte les appels éligibles avec un délai de traitement.'});return true;
  }
  if(p==='/api/tracking/install'&&m==='POST'){
    if(!account)throw new AppError('Connectez et sélectionnez votre compte Google Ads.',422);
    await rateGuard(req,'tracking-install',4,300000);
    const input=await readJson(req),s=await query('SELECT slug,status FROM artisan_sites WHERE user_id=$1',[a.id]);
    if(s.rows[0]?.status!=='published')throw new AppError('Publiez votre site avant d’installer la mesure des appels.',422);
    let actions=await listCallActions(query,a.id,account.customer_id),result;
    let websiteAction=actions.find(x=>x.type==='WEBSITE_CALL'&&x.status==='ENABLED'&&tagInfo(x));
    if(!websiteAction){
      if(!config.allowConversionWrites)throw new AppError('Aucune conversion d’appels depuis le site n’est disponible. La création par API doit être activée par l’administrateur.',503);
      if(input.confirm!=='INSTALLER LE SUIVI DES APPELS')throw new AppError('Confirmez l’installation du suivi dans votre compte Google Ads.',422);
      result=await configureCallActions(query,a.id,account.customer_id,{validateOnly:false});
      actions=await listCallActions(query,a.id,account.customer_id);websiteAction=actions.find(x=>x.type==='WEBSITE_CALL'&&x.status==='ENABLED'&&tagInfo(x));
    }
    const tag=tagInfo(websiteAction);if(!tag)throw new AppError('Google n’a pas encore fourni la balise de suivi. Réessayez après quelques minutes.',422);
    const settings=JSON.stringify({...tag,google_customer_id:account.customer_id});
    await query('UPDATE artisan_sites SET site=site || $2::jsonb,draft=CASE WHEN draft IS NULL THEN NULL ELSE draft || $2::jsonb END,updated_at=now() WHERE user_id=$1',[a.id,settings]);
    await query('UPDATE profiles SET conversion_verified=false WHERE user_id=$1',[a.id]);
    await query("INSERT INTO tracking_checks(user_id,customer_id,website,status) VALUES($1,$2,$3,'awaiting_real_call') ON CONFLICT(user_id,customer_id) DO UPDATE SET website=EXCLUDED.website,status=EXCLUDED.status,checked_at=now()",[a.id,account.customer_id,config.baseUrl+'/p/'+s.rows[0].slug]);
    await audit(a.id,'tracking.installed',{customerId:account.customer_id});
    send(res,{installed:true,message:'Balise installée. Après consentement du visiteur, Google peut remplacer le numéro pour les visites publicitaires éligibles. Effectuez ensuite un appel test d’au moins 60 secondes.'});return true;
  }
  if(p==='/api/tracking/verify'&&m==='POST'){
    if(!account)throw new AppError('Sélectionnez un compte Google Ads.',422);
    await rateGuard(req,'tracking-test',5,300000);
    const [data,site]=await Promise.all([readTrackedCalls(query,a.id,account.customer_id),query('SELECT site FROM artisan_sites WHERE user_id=$1',[a.id])]);
    const installed=site.rows[0]?.site?.google_customer_id===account.customer_id&&site.rows[0]?.site?.google_tag_id;
    const status=installed&&data.calls.some(c=>c.counted&&c.source==='LANDING_PAGE')?'call_observed':'awaiting_real_call';
    await query("UPDATE tracking_checks SET status=$1,checked_at=now() WHERE user_id=$2 AND customer_id=$3",[status,a.id,account.customer_id]);
    // Observing real calls is evidence, not a claim that every lead is qualified.
    await query('UPDATE profiles SET conversion_verified=$1 WHERE user_id=$2',[status==='call_observed',a.id]);
    send(res,{status,summary:data.summary,message:status==='call_observed'?'Google a rapporté au moins un appel reçu de 60 secondes.':'Aucun appel reçu de 60 secondes n’a encore été rapporté. La remontée Google peut être différée.'});return true;
  }
  if(p==='/api/calls/review'&&m==='POST'){
    if(!account)throw new AppError('Sélectionnez votre compte Google Ads.',422);
    const x=await readJson(req);
    if(!['new','callback','qualified','won','irrelevant'].includes(x.outcome)||typeof x.callId!=='string'||!x.callId.startsWith(`customers/${account.customer_id}/callViews/`)||x.callId.length>240)throw new AppError('Appel ou statut invalide.',422);
    const calls=await readTrackedCalls(query,a.id,account.customer_id);
    if(!calls.calls.some(c=>c.id===x.callId))throw new AppError('Appel inaccessible.',404);
    await query('INSERT INTO call_reviews(user_id,customer_id,call_id,outcome) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,customer_id,call_id) DO UPDATE SET outcome=EXCLUDED.outcome,updated_at=now()',[a.id,account.customer_id,x.callId,x.outcome]);
    send(res,{saved:true});return true;
  }
  throw new AppError('Méthode non autorisée.',405);
}
