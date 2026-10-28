import {config} from './config.mjs';
import {validCoordinates,validateRadiusKm} from './locations.mjs';
import {normalizeFrenchPhone} from './phone.mjs';
import {encrypt,decrypt,safeCustomerId} from './security.mjs';
const GOOGLE_ROOT='https://googleads.googleapis.com';
export class ProviderError extends Error {
  constructor(message,status=502,detail=''){super(message);this.status=status;this.detail=detail;}
}
export function oauthUrl({state,provider='ads'}) {
  const scope=provider==='business'?'openid email https://www.googleapis.com/auth/business.manage':'openid email https://www.googleapis.com/auth/adwords';
  return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:config.googleId,redirect_uri:config.baseUrl+'/api/google/callback',response_type:'code',scope,access_type:'offline',prompt:'consent',state}).toString();
}
export async function exchangeCode(code) {
  const params=new URLSearchParams({client_id:config.googleId,client_secret:config.googleSecret,redirect_uri:config.baseUrl+'/api/google/callback',code,grant_type:'authorization_code'});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:params,signal:AbortSignal.timeout(15000)});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new ProviderError('Google a refusé la connexion OAuth.',400);
  let accountEmail='';
  if(body.access_token){
    try{const user=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:'Bearer '+body.access_token},signal:AbortSignal.timeout(10000)});if(user.ok)accountEmail=String((await user.json()).email||'')}catch{}
  }
  return {access_token:body.access_token,refresh_token:body.refresh_token||'',expires_at:Date.now()+body.expires_in*1000,account_email:accountEmail};
}
export async function storeTokens(query,userId,provider,tokenData) {
  const previous=await query('SELECT encrypted_token FROM integrations WHERE user_id=$1 AND provider=$2',[userId,provider]);
  let old=null;
  if(previous.rows.length){try{old=decrypt(previous.rows[0].encrypted_token);}catch{old=null;}}
  const record={...tokenData,refresh_token:tokenData.refresh_token||old?.refresh_token};
  if(!record.refresh_token)throw new ProviderError('Google n’a pas fourni de jeton de renouvellement. Révoquez puis reconnectez cet accès.',400);
  await query('INSERT INTO integrations(user_id,provider,encrypted_token,account_email) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_token=EXCLUDED.encrypted_token,account_email=EXCLUDED.account_email,updated_at=now()',[userId,provider,encrypt(record),record.account_email||old?.account_email||null]);
}
export async function accessToken(query,userId,provider='ads') {
  const rows=await query('SELECT encrypted_token FROM integrations WHERE user_id=$1 AND provider=$2',[userId,provider]);
  if(!rows.rows.length)throw new ProviderError('Veuillez connecter votre compte Google.',401);
  const record=decrypt(rows.rows[0].encrypted_token);
  if(record.access_token && record.expires_at>Date.now()+60000)return record.access_token;
  if(!record.refresh_token)throw new ProviderError('Veuillez reconnecter votre compte Google.',401);
  const params=new URLSearchParams({client_id:config.googleId,client_secret:config.googleSecret,refresh_token:record.refresh_token,grant_type:'refresh_token'});
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:params,signal:AbortSignal.timeout(15000)});
  const val=await res.json().catch(()=>({}));
  if(!res.ok)throw new ProviderError('Votre connexion Google a expiré. Veuillez la renouveler.',401);
  const next={...record,access_token:val.access_token,expires_at:Date.now()+val.expires_in*1000};
  await query('UPDATE integrations SET encrypted_token=$1,updated_at=now() WHERE user_id=$2 AND provider=$3',[encrypt(next),userId,provider]);
  return next.access_token;
}
export async function requestAds(query,userId,path,{body,loginCustomerId,method}={}) {
  const token=await accessToken(query,userId,'ads');
  const headers={authorization:'Bearer '+token};
  // Since September 2026 Google Ads API access is bound to the OAuth Cloud project.
  // Legacy developer tokens are optional and ignored; omit the header when unset.
  if(config.developerToken)headers['developer-token']=config.developerToken;
  // listAccessibleCustomers explicitly has no login customer ID.
  const login=loginCustomerId===undefined ? config.mccId:loginCustomerId;
  if(login)headers['login-customer-id']=login;
  if(body)headers['content-type']='application/json';
  const url=`${GOOGLE_ROOT}/${config.adsVersion}/${path}`;
  const response=await fetch(url,{method:method||((body!==undefined)?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const content=await response.json().catch(()=>({}));
  if(!response.ok)throw new ProviderError('Google Ads a refusé la requête ('+response.status+').',response.status<500?422:503,String(content.error?.message||'').slice(0,240));
  return content;
}
export async function listAccounts(query,userId) {
  const roots=await requestAds(query,userId,'customers:listAccessibleCustomers',{loginCustomerId:''});
  const accounts=[];const known=new Set();
  const add=x=>{if(x.id&&!known.has(x.id)){known.add(x.id);accounts.push(x)}};
  for(const name of (roots.resourceNames||[]).slice(0,15)){
    const id=name.split('/')[1];
    try{
      // The root may be a manager: include direct client accounts. Never assume its billing currency.
      const entries=await searchAds(query,userId,id,`SELECT customer_client.id,customer_client.descriptive_name,customer_client.currency_code,customer_client.time_zone,customer_client.manager,customer_client.level FROM customer_client WHERE customer_client.level <= 1 LIMIT 100`);
      for(const result of entries){
        const x=result.customerClient||{};
        if(x.manager===true)continue;
        if(x.id)add({id:String(x.id),name:x.descriptiveName||'Compte '+x.id,currency:x.currencyCode||null,timezone:x.timeZone||null});
      }
      if(!entries.length){
        const one=await searchAds(query,userId,id,'SELECT customer.id,customer.descriptive_name,customer.currency_code,customer.time_zone FROM customer LIMIT 1');
        const c=one[0]?.customer||{};if(c.id)add({id:String(c.id),name:c.descriptiveName||'Compte '+id,currency:c.currencyCode||null,timezone:c.timeZone||null});
      }
    }catch(e){add({id,name:'Compte '+id,currency:null,timezone:null,needsVerification:true})}
  }
  return accounts;
}
export async function searchAds(query,userId,customerId,gaql) {
  const id=safeCustomerId(customerId);
  if(!id)throw new ProviderError('Identifiant Google Ads invalide',400);
  const rows=[];let pageToken;
  for(let i=0;i<3;i++){
    const r=await requestAds(query,userId,`customers/${id}/googleAds:search`,{body:{query:gaql,pageSize:1000,...(pageToken?{pageToken}:{})}});
    rows.push(...(r.results||[]));pageToken=r.nextPageToken;
    if(!pageToken)break;
  }
  return rows;
}
export async function dailyMetrics(query,userId,customerId){
  const gaql='SELECT segments.date, metrics.cost_micros,metrics.impressions,metrics.clicks,metrics.conversions,metrics.phone_calls FROM customer WHERE segments.date DURING LAST_30_DAYS ORDER BY segments.date DESC LIMIT 35';
  return searchAds(query,userId,customerId,gaql);
}
export async function searchTerms(query,userId,customerId){
  const gaql='SELECT search_term_view.search_term,metrics.cost_micros,metrics.clicks,metrics.conversions FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND metrics.clicks > 0 ORDER BY metrics.cost_micros DESC LIMIT 200';
  return searchAds(query,userId,customerId,gaql);
}
export async function geoSuggestions(query,userId,city){
  const name=String(city||'').trim().slice(0,70);
  if(!name)return [];
  const result=await requestAds(query,userId,'geoTargetConstants:suggest',{body:{locale:'fr',countryCode:'FR',locationNames:{names:[name]}}});
  return (result.geoTargetConstantSuggestions||[]).filter(x=>x.geoTargetConstant?.countryCode==='FR'&&x.geoTargetConstant?.status==='ENABLED').map(x=>({id:x.geoTargetConstant.resourceName?.split('/')[1],name:x.geoTargetConstant.name,region:x.geoTargetConstant.canonicalName||'',type:x.geoTargetConstant.targetType})).slice(0,12);
}
export function createCustomerRequest(businessName,{validateOnly=true}={}){
  return {customerClient:{descriptiveName:String(businessName||'ArtisanPilot client').slice(0,100),currencyCode:'EUR',timeZone:'Europe/Paris'},validateOnly};
}
export async function createCustomer(query,userId,businessName,{validateOnly=true}={}){
  if(!config.mccId)throw new ProviderError('Compte administrateur Google Ads (MCC) non configuré.',503);
  return requestAds(query,userId,`customers/${config.mccId}:createCustomerClient`,{body:createCustomerRequest(businessName,{validateOnly}),loginCustomerId:config.mccId});
}
// Pure builder, tested without a Google API. Never enables campaigns automatically.
export function buildSearchCampaignOperations(plan,customerId) {
  const customer=safeCustomerId(customerId);
  if(!customer)throw new Error('Identifiant client Google Ads invalide');
  if(plan.kind!=='SEARCH'||plan.destination!=='site')throw new Error('Ce constructeur ne gère que les campagnes Search vers un site web. Les fiches Google nécessitent un parcours distinct.');
  if(!/^https:\/\/[^\s]+\.[^\s]+/i.test(plan.website||''))throw new Error('Site HTTPS manquant');
  const callPhone=normalizeFrenchPhone(plan.callPhone);
  if(!callPhone)throw new Error('Un numéro professionnel est nécessaire pour ajouter le bouton d’appel Google Ads.');
  const validGeoId=/^\d{3,10}$/.test(String(plan.geoTargetId||''));
  const prox=plan.proximity;
  let geoCriterion;
  if(prox && validCoordinates(prox.lat,prox.lng)){
    const radius=validateRadiusKm(prox.radiusKm);
    geoCriterion={proximity:{geoPoint:{latitudeInMicroDegrees:Math.round(Number(prox.lat)*1e6),longitudeInMicroDegrees:Math.round(Number(prox.lng)*1e6)},radius,radiusUnits:'KILOMETERS'}};
  }else if(validGeoId){geoCriterion={location:{geoTargetConstant:`geoTargetConstants/${plan.geoTargetId}`}}}
  else throw new Error('Ciblage local Google non vérifié');
  if(!Array.isArray(plan.headlines)||plan.headlines.length<3||plan.headlines.some(x=>x.length>30))throw new Error('Titres de publicité non valides');
  if(!Array.isArray(plan.descriptions)||plan.descriptions.length<2||plan.descriptions.some(x=>x.length>90))throw new Error('Descriptions non valides');
  const daily=Number(plan.dailyBudgetEuro);
  if(!Number.isFinite(daily)||daily<5||daily>5000)throw new Error('Budget invalide');
  const name='ArtisanPilot | '+plan.jobLabel+' | '+plan.city+' | '+Date.now();
  const budget=`customers/${customer}/campaignBudgets/-1`,campaign=`customers/${customer}/campaigns/-2`,group=`customers/${customer}/adGroups/-3`;
  const operations=[
    {campaignBudgetOperation:{create:{resourceName:budget,name:name+' | Budget',amountMicros:String(Math.round(daily*1e6)),deliveryMethod:'STANDARD',explicitlyShared:false}}},
    {campaignOperation:{create:{resourceName:campaign,name,campaignBudget:budget,advertisingChannelType:'SEARCH',status:'PAUSED',manualCpc:{},networkSettings:{targetGoogleSearch:true,targetSearchNetwork:false,targetContentNetwork:false, targetPartnerSearchNetwork:false}}}},
    {campaignCriterionOperation:{create:{campaign,...geoCriterion}}},
    {adGroupOperation:{create:{resourceName:group,campaign,name:'Services locaux',status:'ENABLED',type:'SEARCH_STANDARD',cpcBidMicros:'2000000'}}},
    // A separate call asset for this specific artisan, never shared across clients.
    {assetOperation:{create:{resourceName:`customers/${customer}/assets/-4`,callAsset:{countryCode:'FR',phoneNumber:callPhone}}}},
    {campaignAssetOperation:{create:{campaign,asset:`customers/${customer}/assets/-4`,fieldType:'CALL'}}},
  ];
  for(const kw of plan.keywords.slice(0,20))operations.push({adGroupCriterionOperation:{create:{adGroup:group,status:'ENABLED',keyword:{text:kw.text,matchType:kw.matchType||'PHRASE'}}}});
  for(const kw of plan.negatives.slice(0,20))operations.push({campaignCriterionOperation:{create:{campaign,negative:true,keyword:{text:kw.text,matchType:kw.matchType||'PHRASE'}}}});
  operations.push({adGroupAdOperation:{create:{adGroup:group,status:'ENABLED',ad:{responsiveSearchAd:{headlines:plan.headlines.slice(0,15).map(text=>({text})),descriptions:plan.descriptions.slice(0,4).map(text=>({text}))},finalUrls:[plan.website]}}}});
  return operations;
}
export async function createPausedCampaign(query,userId,customerId,plan,{validateOnly=true}={}) {
  const operations=buildSearchCampaignOperations(plan,customerId);
  return requestAds(query,userId,`customers/${customerId}/googleAds:mutate`,{body:{mutateOperations:operations,validateOnly,partialFailure:false,responseContentType:'RESOURCE_NAME_ONLY'}});
}
export async function enableCampaign(query,userId,customerId,campaignResource){
  if(!/^customers\/\d{10}\/campaigns\/\d+$/.test(campaignResource)||!campaignResource.startsWith('customers/'+customerId+'/'))throw new ProviderError('Campagne invalide',400);
  return requestAds(query,userId,`customers/${customerId}/campaigns:mutate`,{body:{operations:[{update:{resourceName:campaignResource,status:'ENABLED'},updateMask:'status'}],partialFailure:false}});
}
export async function listBusinessAccounts(query,userId){
  const bearer=await accessToken(query,userId,'business');
  const response=await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts',{headers:{authorization:'Bearer '+bearer},signal:AbortSignal.timeout(16000)});
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw new ProviderError('Google Business Profile : API non autorisée ou compte inaccessible.',422);
  return (value.accounts||[]).map(x=>({name:x.name,accountName:x.accountName,type:x.type}));
}

// Google Business Profile is linked through Location assets. This is NOT a guarantee
// of a promoted pin or a specific Google Maps placement.
export function buildLocationSyncOperation(email,accessToken,businessAccountId){
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email||''))throw Error('Adresse du propriétaire Google Business Profile indisponible');
  if(!/^\d+$/.test(String(businessAccountId||'')))throw Error('Compte établissement invalide');
  if(!accessToken)throw Error('Jeton Business Profile absent');
  return {create:{name:'ArtisanPilot Business Profile Location Sync',type:'LOCATION_SYNC',locationSet:{locationOwnershipType:'BUSINESS_OWNER',businessProfileLocationSet:{emailAddress:email,httpAuthorizationToken:accessToken,businessAccountId:String(businessAccountId)}}}};
}
export async function linkBusinessLocationAssets(query,userId,customerId,businessAccountId){
  const existing=await searchAds(query,userId,customerId,`SELECT asset_set.resource_name,asset_set.type,asset_set.status FROM asset_set WHERE asset_set.type='LOCATION_SYNC' AND asset_set.status='ENABLED' LIMIT 5`);
  if(existing.length)throw new ProviderError('Ce compte publicitaire dispose déjà d’une synchronisation de fiches. Contactez le support pour éviter les doublons.',409);
  const approved=await listBusinessAccounts(query,userId);
  if(!approved.some(a=>a.name==='accounts/'+businessAccountId))throw new ProviderError('Votre compte Google ne donne pas accès à cette fiche.',403);
  const token=await accessToken(query,userId,'business');
  const record=await query('SELECT account_email FROM integrations WHERE user_id=$1 AND provider=$2',[userId,'business']);
  const email=record.rows[0]?.account_email;
  const operation=buildLocationSyncOperation(email,token,businessAccountId);
  const created=await requestAds(query,userId,`customers/${customerId}/assetSets:mutate`,{body:{operations:[operation]}});
  const assetSet=created.results?.[0]?.resourceName;
  if(!assetSet)throw new ProviderError('Google n’a pas confirmé la création du groupe de lieux.',502);
  const linked=await requestAds(query,userId,`customers/${customerId}/customerAssetSets:mutate`,{body:{operations:[{create:{assetSet}}]}});
  return {assetSet,linked,notice:'Liaison créée. Les emplacements publicitaires restent soumis à l’éligibilité de Google.'};
}

export async function inviteNewCustomerAdmin(query,userId,customerId){
  const record=await query('SELECT account_email FROM integrations WHERE user_id=$1 AND provider=$2',[userId,'ads']);
  const email=record.rows[0]?.account_email;
  if(!email)throw new ProviderError('Compte créé. Invitez l’artisan manuellement depuis Google Ads : adresse Google indisponible.',422);
  return requestAds(query,userId,`customers/${customerId}/customerUserAccessInvitations:mutate`,
    {body:{operation:{create:{emailAddress:email,accessRole:'ADMIN'}}}});
}
