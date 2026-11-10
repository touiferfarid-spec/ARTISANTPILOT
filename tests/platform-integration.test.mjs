import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from '../src/server.mjs';
import {config} from '../src/config.mjs';
import {sha,token,passwordVerify} from '../src/security.mjs';
import {structuredCopy} from '../src/ai.mjs';

// Real PostgreSQL semantics in WASM, real HTTP server, deterministic provider doubles.
test('end-to-end tenant, publication, contacts, OAuth and account lifecycle',async t=>{
 const db=new PGlite();const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const originalFetch=global.fetch,old={...config};
 config.openaiKey='';config.googleId='test-client';config.googleSecret='not-a-real-secret';config.encryptionKey='b'.repeat(64);
 let aiRequest;
 global.fetch=async(url,options)=>{
  const value=String(url);
  if(value.startsWith('https://geo.api.gouv.fr/communes/69123'))return Response.json({nom:'Lyon',code:'69123',codeDepartement:'69',centre:{coordinates:[4.835,45.764]},codesPostaux:['69001']});
  if(value==='https://oauth2.googleapis.com/token'){assert.ok(new URLSearchParams(options.body).get('code_verifier'));return Response.json({access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600});}
  if(value==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:'google-subject-test',email:'google@example.invalid',email_verified:true});
  if(value.startsWith('https://googleads.googleapis.com/')){
   if(value.endsWith('customers:listAccessibleCustomers')){assert.equal(options.headers['login-customer-id'],undefined);return Response.json({resourceNames:['customers/1234567890']});}
   const body=JSON.parse(options.body||'{}');
   if(value.endsWith('/googleAds:mutate')){assert.equal(body.validateOnly,true);return Response.json({});}
   if(body.query?.includes('FROM customer_client'))return Response.json({results:[{customerClient:{id:'1234567890',descriptiveName:'Compte pilote',currencyCode:'EUR',timeZone:'Europe/Paris',manager:false}}]});
   if(body.query?.includes('FROM customer'))return Response.json({results:[{customer:{id:'1234567890'}}]});
   return Response.json({results:[]});
  }
  if(value==='https://api.openai.com/v1/responses'){aiRequest=JSON.parse(options.body);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'{"heading":"Plombier à Lyon"}'}]}]});}
  return originalFetch(url,options);
 };
 const server=await createServer({pool});await new Promise(r=>server.listen(0,'127.0.0.1',r));config.baseUrl='http://127.0.0.1:'+server.address().port;
 const request=async(path,{body,method,cookie,origin=config.baseUrl}={})=>{const r=await originalFetch(config.baseUrl+path,{method:method||(body?'POST':'GET'),headers:{...(body?{'content-type':'application/json'}:{}),...(origin?{origin}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});return {status:r.status,headers:r.headers,data:await r.text()};};
 let alice,bob,slug,userId;
 const input={business_name:'Test Plomberie',job:'plombier',city:'Lyon',city_code:'69123',email:'contact@example.invalid',phone:'06 12 34 56 78',radius_km:20,services:['Recherche de fuite'],design_style:'atelier'};
 try{
 await t.test('registration issues protected sessions and separates tenants',async()=>{
  let r=await request('/api/auth/register',{body:{email:'alice@example.invalid',password:'correct-long-password'}});assert.equal(r.status,200,r.data);alice=r.headers.get('set-cookie').split(';')[0];userId=JSON.parse(r.data).user.id;assert.match(r.headers.get('set-cookie'),/HttpOnly/);
  r=await request('/api/auth/register',{body:{email:'bob@example.invalid',password:'another-long-password'}});assert.equal(r.status,200);bob=r.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/leads')).status,401);
  assert.equal((await request('/api/site/generate',{body:input,cookie:alice,origin:'https://attacker.invalid'})).status,403);
 });
 await t.test('draft stays private; published page has working contact hooks',async()=>{
  let r=await request('/api/site/generate',{body:input,cookie:alice});assert.equal(r.status,201,r.data);slug=JSON.parse(r.data).site.slug;
  assert.equal((await request('/p/'+slug)).status,404);assert.equal((await request('/p/'+slug,{cookie:bob})).status,404);assert.equal((await request('/p/'+slug,{cookie:alice})).status,200);
  assert.equal((await request('/api/public/sites/'+slug)).status,404);
  r=await request('/api/site/publish',{body:{siret:'12345678901234',legal_address:'12 rue Exemple, 69001 Lyon'},cookie:alice});assert.equal(r.status,200,r.data);
  r=await request('/p/'+slug);assert.equal(r.status,200);assert.match(r.data,/data-artisan-lead/);assert.match(r.data,/site-track.js/);
  r=await request('/api/public/sites/'+slug);assert.equal(r.status,200,r.data);assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.equal(JSON.parse(r.data).site.email,input.email);assert.ok(!r.data.includes(userId));
 });
 await t.test('regenerating preserves live publication and owner-only draft',async()=>{
  let r=await request('/api/site/generate',{body:{...input,business_name:'Nouvelle version'},cookie:alice});assert.equal(r.status,201,r.data);assert.match(JSON.parse(r.data).site.preview_url,/draft=1/);
  r=await request('/p/'+slug);assert.match(r.data,/Test Plomberie/);assert.ok(!r.data.includes('Nouvelle version'));
  r=await request('/p/'+slug+'?draft=1',{cookie:alice});assert.match(r.data,/Nouvelle version/);assert.ok(!r.data.includes('src="/site-track.js"'));
  assert.equal((await request('/p/'+slug+'?draft=1',{cookie:bob})).status,404);
 });
 await t.test('cross-origin contacts require verified ownership, are idempotent and isolated',async()=>{
  const lead={name:'Client test',phone:'0612345678',message:'Une fuite à Lyon',consent:true,requestId:'integration-request-00001'};
  let r=await request('/api/public/sites/'+slug+'/leads',{body:lead,origin:'https://unknown.lovable.app'});assert.equal(r.status,403);
  r=await request('/api/site/external',{cookie:alice,body:{url:'http://127.0.0.1'}});assert.equal(r.status,422);
  r=await request('/api/site/external',{cookie:alice,body:{url:'https://test-artisan.lovable.app'}});assert.equal(r.status,200,r.data);
  await db.query('UPDATE external_sites SET verified_at=now() WHERE user_id=$1',[userId]);
  r=await request('/api/public/sites/'+slug+'/leads',{method:'OPTIONS',origin:'https://test-artisan.lovable.app'});assert.equal(r.status,204);
  for(let i=0;i<2;i++){r=await request('/api/public/sites/'+slug+'/leads',{body:lead,origin:'https://test-artisan.lovable.app'});assert.equal(r.status,202,r.data);assert.equal(r.headers.get('access-control-allow-origin'),'https://test-artisan.lovable.app');}
  r=await request('/api/leads',{cookie:alice});const list=JSON.parse(r.data).leads;assert.equal(list.length,1);assert.equal(list[0].source,'lovable');
  assert.deepEqual(JSON.parse((await request('/api/leads',{cookie:bob})).data).leads,[]);
  assert.equal((await request('/api/leads/'+list[0].id,{body:{status:'won'},method:'PATCH',cookie:bob})).status,404);
  assert.equal((await request('/api/leads/'+list[0].id,{body:{status:'won'},method:'PATCH',cookie:alice})).status,200);
  r=await request('/api/public/sites/'+slug+'/leads',{body:{...lead,requestId:'invalid-phone-request',phone:'bad'}});assert.equal(r.status,422,r.data);
  r=await request('/api/public/sites/'+slug+'/events',{body:{type:'call_click',requestId:'integration-event-00001'}});assert.equal(r.status,202);
  r=await request('/api/overview',{cookie:alice});assert.equal(JSON.parse(r.data).contacts.clicks,1);assert.equal(JSON.parse(r.data).contacts.won,1);
 });
 await t.test('shared Lovable template serves live public configuration without secrets',async()=>{
  config.lovableTemplateUrl='https://connected-template.lovable.app';
  let r=await request('/api/site/template',{cookie:alice,body:{}});assert.equal(r.status,200,r.data);assert.ok(JSON.parse(r.data).url.endsWith('?site='+slug));
  r=await request('/api/public/sites/'+slug+'/events',{body:{type:'call_click',requestId:'template-click-000001'},origin:config.lovableTemplateUrl});assert.equal(r.status,202,r.data);
  r=await request('/site-track.js');assert.equal(r.headers.get('cross-origin-resource-policy'),'cross-origin');
 });
 await t.test('Ads OAuth is session-bound, encrypted and validation cannot publish',async()=>{
  let r=await request('/api/campaigns/drafts',{cookie:alice,body:{}});assert.equal(r.status,201,r.data);const unboundId=JSON.parse(r.data).draft.id;
  assert.equal((await request('/api/campaigns/drafts/'+unboundId+'/validate',{cookie:alice,body:{}})).status,422);
  r=await request('/api/google/connect',{cookie:alice});assert.equal(r.status,303,r.data);
  const u=new URL(r.headers.get('location')),state=u.searchParams.get('state');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  assert.equal((await request('/api/google/callback?state='+state+'&code=test',{cookie:bob})).status,400);
  r=await request('/api/google/callback?state='+state+'&code=test',{cookie:alice});assert.equal(r.status,303,r.data);
  const stored=(await db.query("SELECT encrypted_token FROM integrations WHERE user_id=$1 AND provider='ads'",[userId])).rows[0].encrypted_token;assert.ok(!stored.includes('test-access-token'));
  r=await request('/api/google/accounts/select',{cookie:alice,body:{customerId:'1234567890'}});assert.equal(r.status,200,r.data);
  assert.equal(JSON.parse((await request('/api/overview',{cookie:bob})).data).account,null);
  r=await request('/api/campaigns/drafts/'+unboundId+'/validate',{cookie:alice,body:{}});assert.equal(r.status,200,r.data);
  assert.equal((await db.query('SELECT customer_id FROM campaign_drafts WHERE id=$1',[unboundId])).rows[0].customer_id,'1234567890');
  r=await request('/api/integrations/check',{cookie:alice,body:{}});assert.equal(r.status,200,r.data);assert.equal(JSON.parse(r.data).checks.calls.status,'needs_setup');
  const pilot=JSON.parse((await request('/api/subscription',{cookie:alice})).data);assert.equal(pilot.pilotAccess,true);
  r=await request('/api/campaigns/drafts',{cookie:alice,body:{}});assert.equal(r.status,201,r.data);const id=JSON.parse(r.data).draft.id;
  r=await request('/api/campaigns/drafts/'+id+'/validate',{cookie:alice,body:{}});assert.equal(r.status,200,r.data);
  r=await request('/api/campaigns/drafts/'+id+'/prepare-paused',{cookie:alice,body:{confirm:'CREER EN PAUSE'}});assert.equal(r.status,503);
  assert.equal((await request('/api/stripe/checkout',{cookie:alice,body:{}})).status,503);
  assert.equal((await request('/api/campaigns/drafts/'+id+'/activate',{cookie:alice,body:{confirm:'JE VALIDE LE BUDGET ET LA DIFFUSION'}})).status,503);
  await request('/api/google/disconnect',{cookie:alice,body:{}});
  assert.equal((await db.query("SELECT count(*)::int AS n FROM integrations WHERE user_id=$1 AND provider='ads'",[userId])).rows[0].n,0);
 });
 await t.test('password recovery is one-use and revokes all sessions',async()=>{
  const reset=token();await db.query("INSERT INTO auth_tokens(token_hash,user_id,kind,expires_at) VALUES($1,$2,'reset',now()+interval '30 minutes')",[sha(reset),userId]);
  let r=await request('/api/auth/reset',{body:{token:reset,password:'replacement-long-password'}});assert.equal(r.status,200,r.data);
  r=await request('/api/me',{cookie:alice});assert.equal(JSON.parse(r.data).user,null);
  assert.equal((await request('/api/auth/reset',{body:{token:reset,password:'replacement-long-password'}})).status,422);
  r=await request('/api/auth/login',{body:{email:'alice@example.invalid',password:'replacement-long-password'}});assert.equal(r.status,200,r.data);
 });
 await t.test('Google sign-in binds state to the browser and verifies identity',async()=>{
  let r=await request('/api/auth/google');assert.equal(r.status,303,r.data);const location=new URL(r.headers.get('location'));const state=location.searchParams.get('state');const stateCookie=r.headers.get('set-cookie').split(';')[0];assert.equal(location.searchParams.get('scope'),'openid email profile');assert.equal(location.searchParams.get('code_challenge_method'),'S256');
  assert.equal((await request('/api/google/callback?state='+state+'&code=test')).status,403);
  r=await request('/api/google/callback?state='+state+'&code=test',{cookie:stateCookie});assert.equal(r.status,303,r.data);assert.equal(r.headers.get('location'),'/studio');const loginCookie=r.headers.get('set-cookie').split(';')[0];
  r=await request('/api/me',{cookie:loginCookie});assert.equal(JSON.parse(r.data).user.emailVerified,true);
 });
 await t.test('pilot capacity preserves existing logins and blocks new signup',async()=>{
  config.pilotMaxAccounts=3;
  assert.equal((await request('/api/auth/register',{body:{email:'overflow@example.invalid',password:'safe-long-password'}})).status,503);
  assert.equal((await request('/api/auth/login',{body:{email:'bob@example.invalid',password:'another-long-password'}})).status,200);
 });
 await t.test('structured generation uses strict schemas and does not store prompts',async()=>{
  config.openaiKey='test-only-key';const result=await structuredCopy('test',{heading:{type:'string'}},'Return a heading',{city:'Lyon'});assert.equal(result.heading,'Plombier à Lyon');assert.equal(aiRequest.store,false);assert.equal(aiRequest.text.format.strict,true);assert.equal(aiRequest.text.format.schema.additionalProperties,false);
 });
 }finally{global.fetch=originalFetch;Object.assign(config,old);await new Promise(r=>server.close(r));await db.close();}
});
