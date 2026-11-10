import crypto from 'node:crypto';
import {config} from './config.mjs';
import {constantTimeEqual} from './security.mjs';
import {AppError} from './errors.mjs';
export const MONTHLY_PRICE_CENTS=9900;
export function checkStripeSignature(raw,signature,secret,{now=Date.now()}={}) {
  if(!signature || !secret || typeof raw!=='string')return false;
  const fields={};for(const x of signature.split(',')){const i=x.indexOf('=');if(i>0){(fields[x.slice(0,i)]??=[]).push(x.slice(i+1))}}
  const ts=Number(fields.t?.[0]);
  if(!Number.isInteger(ts)||Math.abs(now-ts*1000)>300000)return false;
  const mac=crypto.createHmac('sha256',secret).update(`${ts}.${raw}`,'utf8').digest('hex');
  return (fields.v1||[]).some(v=>constantTimeEqual(mac,v));
}
export function assertBillingMode(livemode) {
  const live=/^(sk|rk)_live_/.test(config.stripeKey);
  if(!/^(sk|rk)_(test|live)_/.test(config.stripeKey))throw new AppError('Stripe non configuré.',503);
  if(live&&!config.stripeAllowLive)throw new AppError('Les paiements réels restent désactivés. Validation administrateur nécessaire.',503);
  if(livemode!==undefined&&livemode!==live)throw new AppError('Événement Stripe d’un autre environnement.',400);
  return live;
}
async function stripeRequest(method,path,values={},idempotencyKey) {
  assertBillingMode();
  const params=new URLSearchParams();
  for(const [key,val] of Object.entries(values))if(val!==undefined&&val!==null)params.append(key,String(val));
  const response=await fetch('https://api.stripe.com/v1'+path,{method,headers:{authorization:'Bearer '+config.stripeKey,'content-type':'application/x-www-form-urlencoded','Stripe-Version':'2026-10-28.endive',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:method==='POST'?params:undefined,signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new AppError('Stripe ne peut pas traiter cette demande pour le moment.',502);
  return body;
}
export function validMonthlyPrice(price) {
  return price?.id===config.stripePrice&&price.active!==false&&price.currency==='eur'&&price.unit_amount===MONTHLY_PRICE_CENTS&&price.recurring?.interval==='month'&&price.recurring?.interval_count===1;
}
const ref=x=>typeof x==='string'?x:x?.id||'';
export async function createCheckout({pool,userId,email}) {
  assertBillingMode();
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const prior=(await c.query('SELECT * FROM subscriptions WHERE user_id=$1',[userId])).rows[0];
    if(prior?.stripe_subscription_id){
      const current=await stripeRequest('GET','/subscriptions/'+encodeURIComponent(prior.stripe_subscription_id));
      if(!['canceled','incomplete_expired'].includes(current.status))throw new AppError('Un abonnement existe déjà. Utilisez « Gérer mon abonnement ».',409);
    }
    if(prior?.checkout_id){
      const current=await stripeRequest('GET','/checkout/sessions/'+encodeURIComponent(prior.checkout_id));
      if(current.status==='open'&&current.url){await c.query('COMMIT');return current;}
      if(current.status==='complete'&&!prior?.stripe_subscription_id)throw new AppError('Paiement déjà terminé. Attendez la confirmation puis actualisez votre abonnement.',409);
    }
    const price=await stripeRequest('GET','/prices/'+encodeURIComponent(config.stripePrice));
    if(!validMonthlyPrice(price))throw new AppError('Le prix Stripe doit correspondre à 99 € par mois en euros.',503);
    const session=await stripeRequest('POST','/checkout/sessions',{
      mode:'subscription','line_items[0][price]':config.stripePrice,'line_items[0][quantity]':'1',
      client_reference_id:userId,...(prior?.stripe_customer_id?{customer:prior.stripe_customer_id}:{customer_email:email}),
      success_url:config.baseUrl+'/studio#account',cancel_url:config.baseUrl+'/studio#account',
      'metadata[user_id]':userId,'subscription_data[metadata][user_id]':userId
    },'artisanpilot-checkout-'+userId+'-'+(prior?.checkout_id||'first'));
    if(!session.url||!session.id)throw new AppError('Stripe n’a pas confirmé la session de paiement.',502);
    await c.query(`INSERT INTO subscriptions(user_id,checkout_id,checkout_url,checkout_expires_at) VALUES($1,$2,$3,to_timestamp($4)) ON CONFLICT(user_id) DO UPDATE SET checkout_id=EXCLUDED.checkout_id,checkout_url=EXCLUDED.checkout_url,checkout_expires_at=EXCLUDED.checkout_expires_at,updated_at=now()`,[userId,session.id,session.url,session.expires_at]);
    await c.query('COMMIT');return session;
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function createPortal(customerId){return stripeRequest('POST','/billing_portal/sessions',{customer:customerId,return_url:config.baseUrl+'/studio#account'});}
export async function applyStripeEvent(pool,event){
  assertBillingMode(event.livemode);
  if(!/^evt_[A-Za-z0-9_]+$/.test(event.id||'')||!event.data?.object)throw new AppError('Événement Stripe invalide.',400);
  const object=event.data.object;
  const supported=event.type?.startsWith('customer.subscription.')||event.type==='checkout.session.completed'||['invoice.paid','invoice.payment_failed'].includes(event.type);
  if(!supported)return {ignored:true};
  const subscriptionId=event.type.startsWith('customer.subscription.')?ref(object):ref(object.subscription||object.parent?.subscription_details?.subscription);
  if(!/^sub_[A-Za-z0-9]+$/.test(subscriptionId))return {ignored:true};
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const claim=await c.query('INSERT INTO stripe_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[event.id]);
    if(!claim.rows.length){await c.query('COMMIT');return {duplicate:true};}
    // Serialize events before retrieving Stripe's current state; delivery order is not reliable.
    await c.query('SELECT pg_advisory_xact_lock(92740546)');
    const current=await stripeRequest('GET','/subscriptions/'+encodeURIComponent(subscriptionId));
    assertBillingMode(current.livemode);
    const owner=current.metadata?.user_id;
    if(!/^[0-9a-f-]{36}$/.test(owner||''))throw new AppError('Abonnement sans propriétaire ArtisanPilot valide.',422);
    const user=await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[owner]);
    if(!user.rows.length)throw new AppError('Propriétaire d’abonnement inconnu.',422);
    const conflict=await c.query('SELECT user_id FROM subscriptions WHERE stripe_subscription_id=$1 AND user_id<>$2',[subscriptionId,owner]);
    if(conflict.rows.length)throw new AppError('Abonnement déjà associé à un autre compte.',409);
    const previous=(await c.query('SELECT stripe_subscription_id FROM subscriptions WHERE user_id=$1',[owner])).rows[0];
    if(previous?.stripe_subscription_id&&previous.stripe_subscription_id!==subscriptionId){
      const prior=await stripeRequest('GET','/subscriptions/'+encodeURIComponent(previous.stripe_subscription_id));
      if(!['canceled','incomplete_expired'].includes(prior.status)){await c.query('COMMIT');return {ignored:true,reason:'another_subscription'};}
      if(['canceled','incomplete_expired'].includes(current.status)){await c.query('COMMIT');return {ignored:true,reason:'old_subscription'};}
    }
    const items=current.items?.data||[];
    const eligible=items.length===1&&items[0].quantity===1&&validMonthlyPrice(items[0].price);
    const status=eligible?String(current.status||'inactive'):'price_mismatch';
    await c.query(`INSERT INTO subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status,livemode) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=EXCLUDED.stripe_customer_id,stripe_subscription_id=EXCLUDED.stripe_subscription_id,status=EXCLUDED.status,livemode=EXCLUDED.livemode,updated_at=now()`,[owner,ref(current.customer),subscriptionId,status,current.livemode]);
    await c.query('COMMIT');return {processed:true};
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
