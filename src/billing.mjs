import crypto from 'node:crypto';
import {config} from './config.mjs';
import {constantTimeEqual} from './security.mjs';
export function checkStripeSignature(raw,signature,secret,{now=Date.now()}={}) {
  if(!signature || !secret || typeof raw!=='string')return false;
  const fields={};for(const x of signature.split(',')){const i=x.indexOf('=');if(i>0){(fields[x.slice(0,i)]??=[]).push(x.slice(i+1))}}
  const ts=Number(fields.t?.[0]);
  if(!Number.isInteger(ts)||Math.abs(now-ts*1000)>300000)return false;
  const mac=crypto.createHmac('sha256',secret).update(`${ts}.${raw}`,'utf8').digest('hex');
  return (fields.v1||[]).some(v=>constantTimeEqual(mac,v));
}
async function stripeRequest(method,path,values={}) {
  if(!config.stripeKey)throw new Error('Stripe non configuré');
  const params=new URLSearchParams();
  for(const [key,val] of Object.entries(values))if(val!==undefined&&val!==null)params.append(key,String(val));
  const response=await fetch('https://api.stripe.com/v1'+path,{method,headers:{authorization:'Bearer '+config.stripeKey,'content-type':'application/x-www-form-urlencoded'},body:method==='POST'?params:undefined,signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('Stripe a refusé la demande : '+String(body.error?.message||response.status).slice(0,180));
  return body;
}
export async function createCheckout({userId,email}) {
  return stripeRequest('POST','/checkout/sessions',{
    mode:'subscription','line_items[0][price]':config.stripePrice,'line_items[0][quantity]':'1',
    client_reference_id:userId,customer_email:email,
    success_url:config.baseUrl+'/?checkout=success#dashboard',
    cancel_url:config.baseUrl+'/?checkout=cancel#dashboard',
    'metadata[user_id]':userId,
    'subscription_data[metadata][user_id]':userId,
    allow_promotion_codes:'true'
  });
}
export async function createPortal(customerId){return stripeRequest('POST','/billing_portal/sessions',{customer:customerId,return_url:config.baseUrl+'/#dashboard'});}
export async function applyStripeEvent(query,event){
  const client=event.data?.object||{};
  const existing=await query('SELECT id FROM stripe_events WHERE id=$1',[event.id]);
  if(existing.rows.length)return {duplicate:true};
  if(event.type==='checkout.session.completed'&&client.mode==='subscription'&&client.client_reference_id){
    const status=client.payment_status==='paid'?'active':'incomplete';
    await query('INSERT INTO subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=EXCLUDED.stripe_customer_id,stripe_subscription_id=EXCLUDED.stripe_subscription_id,status=EXCLUDED.status,updated_at=now()',
      [client.client_reference_id,String(client.customer||''),String(client.subscription||''),status]);
  }
  if(['customer.subscription.updated','customer.subscription.deleted','customer.subscription.created'].includes(event.type)){
    const subscriptionId=String(client.id||''),status=String(client.status||'inactive');
    const owner=client.metadata?.user_id;
    if(owner) await query('INSERT INTO subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=EXCLUDED.stripe_customer_id,stripe_subscription_id=EXCLUDED.stripe_subscription_id,status=EXCLUDED.status,updated_at=now()',
      [owner,String(client.customer||''),subscriptionId,status]);
    else await query('UPDATE subscriptions SET status=$1,updated_at=now() WHERE stripe_subscription_id=$2',[status,subscriptionId]);
  }
  await query('INSERT INTO stripe_events(id) VALUES($1) ON CONFLICT DO NOTHING',[event.id]);
  return {processed:true};
}
