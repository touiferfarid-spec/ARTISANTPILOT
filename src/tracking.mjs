import {config} from './config.mjs';

export function trackingState({site,check,account,website,published}) {
  const installed=Boolean(published&&account&&site?.google_customer_id===account.customer_id&&
    /^AW-\d{6,16}$/.test(site.google_tag_id||'')&&/^[A-Za-z0-9_-]{4,100}$/.test(site.google_conversion_label||'')&&
    check?.installed_at&&check.website===website&&check.phone===site.phone);
  return {installed,verified:installed&&check.status==='call_observed',
    status:installed?check.status:'needs_installation',installedAt:installed?check.installed_at:null};
}

export async function readTrackingState(query,userId,account) {
  const [sites,checks,external]=await Promise.all([
    query("SELECT site-'portrait' AS site,slug,status FROM artisan_sites WHERE user_id=$1",[userId]),
    query('SELECT status,checked_at,installed_at,website,phone FROM tracking_checks WHERE user_id=$1 AND customer_id=$2',[userId,account?.customer_id||'']),
    query('SELECT url FROM external_sites WHERE user_id=$1 AND verified_at IS NOT NULL',[userId])
  ]);
  const record=sites.rows[0],check=checks.rows[0]||null;
  const website=external.rows[0]?.url||(record?config.baseUrl+'/p/'+record.slug:null);
  return {...trackingState({site:record?.site,check,account,website,published:record?.status==='published'}),
    check,website,phone:record?.site?.phone||null};
}

// Account changes invalidate tracking in the same transaction as selection.
export async function clearTracking(query,userId) {
  await query('UPDATE profiles SET conversion_verified=false WHERE user_id=$1',[userId]);
  await query("UPDATE tracking_checks SET status='needs_installation',installed_at=NULL WHERE user_id=$1",[userId]);
  await query("UPDATE artisan_sites SET site=site-'google_tag_id'-'google_conversion_label'-'google_customer_id',draft=CASE WHEN draft IS NULL THEN NULL ELSE draft-'google_tag_id'-'google_conversion_label'-'google_customer_id' END WHERE user_id=$1",[userId]);
}

function wallTime(date,timeZone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// Google returns account-local wall times. Reject ambiguous/nonexistent DST times
// instead of treating an older call as evidence for the current installation.
export function callTimestamp(value,timeZone) {
  if(typeof value!=='string')return NaN;
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return Date.parse(value);
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)||!timeZone)return NaN;
  const guess=Date.parse(value.replace(' ','T')+'Z');if(!Number.isFinite(guess))return NaN;
  const candidates=new Set();
  try{
    for(const delta of [-86400000,0,86400000]){
      const sample=guess+delta,local=wallTime(new Date(sample),timeZone);
      const offset=Date.parse(local.replace(' ','T')+'Z')-sample;
      const candidate=guess-offset;
      if(wallTime(new Date(candidate),timeZone)===value)candidates.add(candidate);
    }
  }catch{return NaN;}
  return candidates.size===1?[...candidates][0]:NaN;
}

export function hasRecentLandingCall(calls,{installedAt,timeZone,now=Date.now()}) {
  const installed=new Date(installedAt).getTime();
  if(!installedAt||!Number.isFinite(installed))return false;
  return calls.some(c=>{
    const when=callTimestamp(c.date,timeZone);
    return c.counted&&c.source==='LANDING_PAGE'&&when>=installed&&when<=now;
  });
}
