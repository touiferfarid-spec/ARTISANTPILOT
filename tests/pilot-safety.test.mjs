import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {applyMigrations} from '../src/schema.mjs';
import {config} from '../src/config.mjs';
import {assertAdsRequestAllowed} from '../src/ads.mjs';
import {applyStripeEvent,createCheckout,assertBillingMode} from '../src/billing.mjs';

const poolFor=db=>({query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})});
test('upgrade preserves old users, credentials, sessions, pages and tokens',async()=>{
 const db=new PGlite(),pool=poolFor(db);
 try{
  await db.exec(`CREATE TABLE users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()); INSERT INTO users(email,password_hash) VALUES('legacy@example.invalid','unchanged-hash');`);
  await applyMigrations(pool);
  const u=(await db.query('SELECT * FROM users')).rows[0];assert.equal(u.email_verified,false);assert.equal(u.password_hash,'unchanged-hash');
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('old-session',$1,now()+interval '1 day')",[u.id]);
  await db.query("INSERT INTO integrations(user_id,provider,encrypted_token) VALUES($1,'ads','unchanged-ciphertext')",[u.id]);
  await db.query("INSERT INTO artisan_sites(user_id,slug,site,status) VALUES($1,'legacy-artisan','{\"business_name\":\"Existing\"}','published')",[u.id]);
  await applyMigrations(pool);
  assert.equal((await db.query('SELECT token_hash FROM sessions')).rows[0].token_hash,'old-session');
  assert.equal((await db.query('SELECT encrypted_token FROM integrations')).rows[0].encrypted_token,'unchanged-ciphertext');
  assert.equal((await db.query('SELECT status FROM artisan_sites')).rows[0].status,'published');
 }finally{await db.close()}
});
test('provider boundary rejects all real Ads mutations when switches are off',()=>{
 const old={...config};try{
  for(const k of ['allowCampaignWrites','allowActivation','allowConversionWrites','allowAccountCreation','allowLocationSync'])config[k]=false;
  for(const path of ['customers/1234567890/googleAds:mutate','customers/1234567890/campaigns:mutate','customers/1234567890/conversionActions:mutate','customers/1234567890/assetSets:mutate','customers/1234567890/customerAssetSets:mutate','customers/1234567890:createCustomerClient','customers/1234567890/customerUserAccessInvitations:mutate','customers/1234567890/unexpected:mutate'])assert.throws(()=>assertAdsRequestAllowed(path,{operations:[]}));
  assert.doesNotThrow(()=>assertAdsRequestAllowed('customers/1234567890/googleAds:mutate',{validateOnly:true}));
  assert.doesNotThrow(()=>assertAdsRequestAllowed('customers/1234567890/googleAds:search',{query:'SELECT customer.id FROM customer'}));
  config.allowActivation=true;assert.throws(()=>assertAdsRequestAllowed('customers/1234567890/campaigns:mutate',{}));
 }finally{Object.assign(config,old)}
});
test('Stripe uses current provider state, transaction rollback and duplicate protection',async t=>{
 const db=new PGlite(),pool=poolFor(db),old={...config},originalFetch=global.fetch;
 config.stripeKey='sk_test_offline';config.stripePrice='price_test';config.stripeAllowLive=false;
 await applyMigrations(pool);
 const user=(await db.query("INSERT INTO users(email,password_hash) VALUES('billing@example.invalid','test') RETURNING id")).rows[0].id;
 const price={id:'price_test',active:true,currency:'eur',unit_amount:9900,recurring:{interval:'month',interval_count:1}};
 let current={id:'sub_test',livemode:false,metadata:{user_id:user},customer:'cus_test',status:'active',items:{data:[{quantity:1,price}]}};
 let creates=0,reads=0,fail=false;
 global.fetch=async(url,options)=>{
  assert.match(String(url),/^https:\/\/api.stripe.com\/v1\//);
  assert.equal(options.headers['Stripe-Version'],'2026-10-28.endive');
  if(fail)return Response.json({error:{}},{status:500});
  if(String(url).includes('/prices/'))return Response.json(price);
  if(String(url).includes('/subscriptions/')){reads++;return Response.json(current);}
  if(options.method==='POST'){creates++;const body=new URLSearchParams(options.body);assert.equal(body.get('line_items[0][price]'),'price_test');assert.ok(options.headers['Idempotency-Key']);return Response.json({id:'cs_test',url:'https://checkout.stripe.com/test',expires_at:Math.floor(Date.now()/1000)+1800,status:'open'});}
  return Response.json({id:'cs_test',url:'https://checkout.stripe.com/test',status:'open'});
 };
 const event=(id,type='customer.subscription.updated')=>({id,type,livemode:false,data:{object:{id:'sub_test',status:'active'}}});
 try{
  await t.test('live charges blocked before any provider request',()=>{config.stripeKey='sk_live_offline';assert.throws(()=>assertBillingMode(),/réels/);config.stripeKey='sk_test_offline';assert.throws(()=>assertBillingMode(true),/environnement/);});
  await t.test('checkout reused and wrong amount rejected',async()=>{
   price.unit_amount=9800;await assert.rejects(createCheckout({pool,userId:user,email:'billing@example.invalid'}),/99/);assert.equal(creates,0);
   price.unit_amount=9900;await createCheckout({pool,userId:user,email:'billing@example.invalid'});await createCheckout({pool,userId:user,email:'billing@example.invalid'});assert.equal(creates,1);
  });
  await t.test('subscription activated only from current verified provider state',async()=>{
   await applyStripeEvent(pool,event('evt_first'));assert.equal((await db.query('SELECT status FROM subscriptions')).rows[0].status,'active');
   const before=reads;assert.deepEqual(await applyStripeEvent(pool,event('evt_first')),{duplicate:true});assert.equal(reads,before);
   await assert.rejects(createCheckout({pool,userId:user,email:'billing@example.invalid'}),/existe déjà/);
  });
  await t.test('delayed old active payload cannot resurrect canceled subscription',async()=>{
   current.status='canceled';await applyStripeEvent(pool,event('evt_delayed'));assert.equal((await db.query('SELECT status FROM subscriptions')).rows[0].status,'canceled');
  });
  await t.test('failed payment removes access and mismatched price cannot grant access',async()=>{
   current.status='past_due';await applyStripeEvent(pool,{id:'evt_failure',livemode:false,type:'invoice.payment_failed',data:{object:{parent:{subscription_details:{subscription:'sub_test'}}}}});assert.equal((await db.query('SELECT status FROM subscriptions')).rows[0].status,'past_due');
   current.status='active';price.unit_amount=100;await applyStripeEvent(pool,event('evt_wrongprice'));assert.equal((await db.query('SELECT status FROM subscriptions')).rows[0].status,'price_mismatch');price.unit_amount=9900;
  });
  await t.test('provider failure rolls back event receipt and retries safely',async()=>{
   fail=true;await assert.rejects(applyStripeEvent(pool,event('evt_retry')));assert.equal((await db.query("SELECT count(*)::int AS n FROM stripe_events WHERE id='evt_retry'")).rows[0].n,0);
   fail=false;await applyStripeEvent(pool,event('evt_retry'));assert.equal((await db.query('SELECT status FROM subscriptions')).rows[0].status,'active');
  });
 }finally{global.fetch=originalFetch;Object.assign(config,old);await db.close()}
});
