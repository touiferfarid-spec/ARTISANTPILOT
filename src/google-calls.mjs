import {searchAds,requestAds} from './ads.mjs';
import {safeCustomerId} from './security.mjs';

const AD_NAME='ArtisanPilot - Appels depuis annonces';
const SITE_NAME='ArtisanPilot - Appels depuis site';
export const MIN_ANSWERED_SECONDS=60;

export function summarizeCalls(rows=[]){
  const calls=rows.map(r=>{
    const v=r.callView||{};
    const status=String(v.callStatus||'UNKNOWN');
    const seconds=Math.max(0,Number(v.callDurationSeconds)||0);
    const answered=status==='RECEIVED';
    return {
      date:String(v.startCallDateTime||''),
      status,seconds,
      answered,
      counted:answered&&seconds>=MIN_ANSWERED_SECONDS,
      source:String(v.callTrackingDisplayLocation||'UNKNOWN'),
      campaign:String(r.campaign?.name||''),
      id:String(v.resourceName||'')
    };
  });
  return {calls,summary:{
    calls:calls.length,
    answered:calls.filter(x=>x.answered).length,
    missed:calls.filter(x=>x.status==='MISSED').length,
    answered60s:calls.filter(x=>x.counted).length,
    note:'Statistiques des appels téléphoniques signalés par Google Ads, pas des clics. Une durée >=60 s ne garantit pas un devis qualifié.'
  }};
}
export async function readTrackedCalls(query,userId,customerId){
  const id=safeCustomerId(customerId);if(!id)throw Error('Compte Google Ads invalide');
  const start=new Date(Date.now()-30*86400000).toISOString().slice(0,19).replace('T',' ');
  const q="SELECT call_view.resource_name,call_view.call_duration_seconds,call_view.call_status,call_view.call_tracking_display_location,call_view.start_call_date_time,campaign.name FROM call_view WHERE call_view.start_call_date_time >= '"+start+"' ORDER BY call_view.start_call_date_time DESC LIMIT 500";
  return summarizeCalls(await searchAds(query,userId,id,q));
}
export const VALID_TYPES=['AD_CALL','WEBSITE_CALL'];
export function createCallActionRequest(type,name){
  if(!VALID_TYPES.includes(type))throw Error('Type de conversion inconnu');
  return {
    name,type,category:'PHONE_CALL_LEAD',status:'ENABLED',
    primaryForGoal:true,countingType:'ONE_PER_CLICK',
    phoneCallDurationSeconds:String(MIN_ANSWERED_SECONDS),
    valueSettings:{defaultValue:0,defaultCurrencyCode:'EUR',alwaysUseDefaultValue:true}
  };
}
export async function listCallActions(query,userId,customerId){
  const id=safeCustomerId(customerId);if(!id)throw Error('Compte invalide');
  const q="SELECT conversion_action.id,conversion_action.name,conversion_action.resource_name,conversion_action.type,conversion_action.status,conversion_action.phone_call_duration_seconds,conversion_action.tag_snippets FROM conversion_action WHERE conversion_action.type IN ('AD_CALL','WEBSITE_CALL') AND conversion_action.status != 'REMOVED' LIMIT 100";
  return (await searchAds(query,userId,id,q)).map(r=>r.conversionAction).filter(Boolean);
}
export function tagInfo(action){
  if(!action)return null;
  const body=(action.tagSnippets||[]).map(v=>(v.eventSnippet||'')+'\n'+(v.globalSiteTag||'')).join('\n');
  const match=body.match(/AW-\d{6,16}\/([A-Za-z0-9_-]{4,100})/);
  if(!match)return null;
  return {google_tag_id:match[0].split('/')[0],google_conversion_label:match[1]};
}
export async function configureCallActions(query,userId,customerId,{validateOnly=true}={}){
  const existing=await listCallActions(query,userId,customerId);
  const matches={
    AD_CALL:existing.find(x=>x.type==='AD_CALL'&&x.name===AD_NAME),
    WEBSITE_CALL:existing.find(x=>x.type==='WEBSITE_CALL'&&x.name===SITE_NAME)
  };
  const missing=VALID_TYPES.filter(type=>!matches[type]);
  if(!missing.length)return {created:false,validated:true,actions:matches,tag:tagInfo(matches.WEBSITE_CALL)};
  const operations=missing.map(type=>({create:createCallActionRequest(type,type==='AD_CALL'?AD_NAME:SITE_NAME)}));
  const google=await requestAds(query,userId,'customers/'+customerId+'/conversionActions:mutate',{body:{operations,validateOnly,partialFailure:false}});
  if(validateOnly)return {validated:true,created:false,missing,google};
  const current=await listCallActions(query,userId,customerId);
  const updated={
    AD_CALL:current.find(x=>x.type==='AD_CALL'&&x.name===AD_NAME),
    WEBSITE_CALL:current.find(x=>x.type==='WEBSITE_CALL'&&x.name===SITE_NAME)
  };
  if(!updated.AD_CALL||!updated.WEBSITE_CALL)throw Error('Conversions créées, mais vérification Google incomplète. Contactez le support.');
  return {created:true,validated:true,actions:updated,tag:tagInfo(updated.WEBSITE_CALL)};
}
