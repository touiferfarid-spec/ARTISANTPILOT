'use strict';
const $=id=>document.getElementById(id);
const state={user:null,profile:null,integrations:null,account:null,drafts:[],metricRows:[],tab:'dashboard',authMode:'register'};
const money=n=>Number(n).toLocaleString('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2});
const safe=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fullApi=async(route,options={})=>{
  const r=await fetch(route,{method:options.method||'GET',credentials:'same-origin',headers:options.body?{'content-type':'application/json'}:{},body:options.body?JSON.stringify(options.body):undefined});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||'Impossible de communiquer avec le service.');
  return data;
};
function toast(message,type='success'){$('toast').textContent=message;$('toast').className='toast '+(type==='error'?'error':type==='warning'?'warning':'');setTimeout(()=>$('toast').classList.add('hidden'),5200)}
function showAuth(mode='register'){
  state.authMode=mode;$('authOverlay').classList.remove('hidden');$('authTitle').textContent=mode==='register'?'Créer mon compte artisan':'Me connecter';$('authSubmit').textContent=mode==='register'?'Créer mon compte →':'Se connecter →';$('authSwitch').textContent=mode==='register'?"J'ai déjà un compte · Se connecter":'Créer un compte';$('authPassword').setAttribute('autocomplete',mode==='register'?'new-password':'current-password');$('authFeedback').textContent='';$('authEmail').focus();
}
function hideAuth(){$('authOverlay').classList.add('hidden');$('authPassword').value=''}
function loginUi(){
  const logged=!!state.user;$('marketingView').classList.toggle('hidden',logged);$('appView').classList.toggle('hidden',!logged);$('marketingLinks').classList.toggle('hidden',logged);$('openAuth').classList.toggle('hidden',logged);$('logout').classList.toggle('hidden',!logged);$('topUser').classList.toggle('hidden',!logged);
  if(logged){$('topUser').textContent=state.user.email;setTab(['dashboard','setup','campaigns','connections','billing'].includes(location.hash.slice(1))?location.hash.slice(1):'dashboard',false);}else{$('marketingView').classList.remove('hidden');$('appView').classList.add('hidden')}
}
function setTab(tab,changeHash=true){
  state.tab=tab;for(const element of document.querySelectorAll('.tab-view'))element.classList.toggle('hidden',element.id!=='tab-'+tab);
  for(const b of document.querySelectorAll('.side-link'))b.classList.toggle('active',b.dataset.tab===tab);
  if(changeHash)history.replaceState({},'',location.pathname+'#'+tab);
  window.scrollTo(0,0);
  if(tab==='setup')window.ArtisanCoverage?.activate();
  if(tab==='connections')loadConnections();if(tab==='billing')loadBilling();if(tab==='campaigns')loadDrafts();if(tab==='dashboard')loadMetrics();
}
async function boot(){try{const d=await fullApi('/api/me');state.user=d.user;}catch{state.user=null}loginUi();if(state.user)await loadProfile();}
for(const id of ['openAuth','heroStart','offerStart'])$(id).addEventListener('click',()=>showAuth());
$('closeAuth').addEventListener('click',hideAuth);
$('authOverlay').addEventListener('click',e=>{if(e.target===$('authOverlay'))hideAuth()});
$('authSwitch').addEventListener('click',()=>showAuth(state.authMode==='register'?'login':'register'));
$('authForm').addEventListener('submit',async e=>{
  e.preventDefault();$('authFeedback').textContent='';$('authSubmit').disabled=true;
  try{const response=await fullApi('/api/auth/'+(state.authMode==='register'?'register':'login'),{method:'POST',body:{email:$('authEmail').value,password:$('authPassword').value}});state.user=response.user;hideAuth();loginUi();await loadProfile();toast('Bienvenue dans votre espace ArtisanPilot');if(!state.profile)setTab('setup');}
  catch(e){$('authFeedback').textContent=e.message}finally{$('authSubmit').disabled=false}
});
$('logout').addEventListener('click',async()=>{
  try{await fullApi('/api/auth/logout',{method:'POST'});state.user=null;state.profile=null;state.integrations=null;loginUi();history.replaceState({},'','/');toast('Vous êtes déconnecté')}catch(e){toast(e.message,'error')}
});
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>setTab(b.dataset.tab));
for(const b of document.querySelectorAll('[data-goto]'))b.addEventListener('click',()=>setTab(b.dataset.goto));
window.addEventListener('hashchange',()=>{if(state.user&&['dashboard','setup','campaigns','connections','billing'].includes(location.hash.slice(1)))setTab(location.hash.slice(1),false)});
function renderProfile(){
  const p=state.profile;if(!p)return;
  for(const key of ['business_name','job','city','website','destination','budget_eur','ads_mode','daily_max_alert_percent']){
    const e=$(key);if(e&&p[key]!==undefined&&p[key]!==null)e.value=p[key];
  }
  const choice=document.querySelector('input[name="destination"][value="'+(p.destination||'site')+'"]');
  if(choice)choice.checked=true;
  $('budgetRange').value=Math.max(5,Math.min(150,Number(p.budget_eur)||30));
  window.ArtisanCoverage?.hydrate(p);
  updateDestination();updateBudget();updateDashboard();
}
async function loadProfile(){
  try{const d=await fullApi('/api/profile');state.profile=d.profile||null;renderProfile();updateDashboard();}catch(e){toast('Impossible de charger votre configuration : '+e.message,'error')}
}
function updateDestination(){
  const dest=document.querySelector('input[name="destination"]:checked')?.value||$('destinationOptions').querySelector('input').value;
  for(const label of document.querySelectorAll('.option-card'))label.classList.toggle('selected',label.querySelector('input').value===dest);
  $('localNotice').classList.toggle('hidden',dest==='site');
}
for(const input of document.querySelectorAll('input[name="destination"]'))input.addEventListener('change',updateDestination);
function updateBudget(){
  const n=Number($('budget_eur').value)||30;
  $('budgetAverage').textContent=money(n);$('budgetMonth').textContent=money(n*30.4);
  $('dailyDisplay').textContent=money(n);$('monthDisplay').textContent=money(n*30.4);$('metricBudget').textContent=money(n);
}
$('budget_eur').addEventListener('input',()=>{const n=Number($('budget_eur').value);if(n<=150&&n>=5)$('budgetRange').value=n;updateBudget()});
$('budgetRange').addEventListener('input',()=>{$('budget_eur').value=$('budgetRange').value;updateBudget()});
$('profileForm').addEventListener('submit',async e=>{
  e.preventDefault();let values={};for(const k of ['business_name','job','city','website','ads_mode','daily_max_alert_percent'])values[k]=$(k).value;
  values.destination=document.querySelector('input[name="destination"]:checked').value;values.budget_eur=Number($('budget_eur').value);values.daily_max_alert_percent=Number(values.daily_max_alert_percent);
  const location=window.ArtisanCoverage?.selection();
  if(!location){$('profileFeedback').textContent='Choisissez d’abord une ville dans les suggestions.';return;}
  Object.assign(values,location);
  const feedback=$('profileFeedback');feedback.textContent='Enregistrement...';
  try{const result=await fullApi('/api/profile',{method:'POST',body:values});state.profile={...state.profile,...values,city:result.location.name,city_code:result.location.code,city_lat:result.location.lat,city_lng:result.location.lng,radius_km:result.location.radiusKm};window.ArtisanCoverage?.hydrate(state.profile);feedback.textContent='✓ Modifications enregistrées';updateDashboard();toast('Votre activité a bien été enregistrée');}
  catch(err){feedback.textContent=err.message;toast(err.message,'error')}
});
function updateDashboard(){
  const p=state.profile,registered=!!p?.city;
  $('greetingName').textContent=p?.business_name?(', '+p.business_name):'👋';$('setupReminder').classList.toggle('hidden',registered);
  $('dailyDisplay').textContent=money(p?.budget_eur||30);$('monthDisplay').textContent=money((p?.budget_eur||30)*30.4);$('metricBudget').textContent=money(p?.budget_eur||30);
  renderChecklist();
}
function renderChecklist(){const done=[!!state.profile?.city,!!state.integrations?.googleAds?.connected,!!state.account];const names=['Présenter mon entreprise','Connecter Google Ads','Sélectionner mon compte Google'];$('stepsList').innerHTML=names.map((n,i)=>`<div class="check-item ${done[i]?'done':''}"><span class="dot">${done[i]?'✓':i+1}</span>${safe(n)}</div>`).join('')}
async function loadConnections(){
  try{
    const i=await fullApi('/api/integrations');state.integrations=i;
    const google=i.googleAds,business=i.googleBusiness;
    const gs=$('googleStatus');gs.textContent=google.connected?'Connecté':google.configured?'Disponible':'À configurer';gs.classList.toggle('active',google.connected);
    const bs=$('businessStatus');bs.textContent=business.connected?'Connecté':business.configured?'Disponible':'À configurer';bs.classList.toggle('active',business.connected);
    $('googleActions').innerHTML=google.configured?`<button id="connectGoogle" class="btn btn-green btn-small">${google.connected?'Reconnecter Google':'Connecter mon compte Google'}</button>`:'<small>Identifiants Google à ajouter par l’administrateur dans Railway.</small>';
    $('businessActions').innerHTML=business.configured?'<button id="connectBusiness" class="btn btn-light btn-small">Connecter ma fiche</button>':'<small>Accès Business Profile à configurer par l’administrateur.</small>';
    if($('connectGoogle'))$('connectGoogle').addEventListener('click',()=>location.assign('/api/google/connect?provider=ads'));
    if($('connectBusiness'))$('connectBusiness').addEventListener('click',()=>location.assign('/api/google/connect?provider=business'));
    if(google.connected)await loadGoogleAccounts();else{$('accountSelection').classList.add('hidden');state.account=null}
    if(business.connected&&i.limits.locationSync&&google.connected)await loadBusinessAccounts();else $('businessLink').classList.add('hidden');
    if(i.limits.accountCreation&&google.connected){const b=document.createElement('button');b.id='createGoogleAccount';b.className='btn btn-light btn-small';b.textContent='Créer mon compte Google Ads';b.addEventListener('click',createGoogleAccount);$('googleActions').appendChild(b)}
    renderChecklist();
  }catch(e){toast(e.message,'error')}
}
async function createGoogleAccount(){
  if(!state.profile?.city)return toast('Enregistrez d’abord votre activité.','warning');
  if(!confirm('Créer un nouveau compte Google Ads dans notre compte gestionnaire ? La facturation restera à configurer chez Google.'))return;
  try{await fullApi('/api/google/account-create/check',{method:'POST'});
    const phrase=prompt('Pour confirmer, saisissez exactement : JE CONFIRME LA CREATION DU COMPTE');
    if(phrase!=='JE CONFIRME LA CREATION DU COMPTE')return;
    const response=await fullApi('/api/google/account-create',{method:'POST',body:{confirm:phrase}});
    toast('Compte '+response.customerId+' créé. Configurez la facturation chez Google.');await loadGoogleAccounts();
  }catch(e){toast(e.message,'error')}
}
async function loadGoogleAccounts(){
  try{const data=await fullApi('/api/google/accounts');state.account=data.selected;
    const list=$('googleAccountSelect');list.innerHTML='<option value="">Choisissez un compte</option>'+(data.accounts||[]).map(a=>`<option value="${safe(a.id)}" ${a.id===data.selected?'selected':''}>${safe(a.name||'Compte Google')} (${safe(a.id)})</option>`).join('');
    $('accountSelection').classList.remove('hidden');renderChecklist();
  }catch(e){toast('Comptes Google : '+e.message,'error')}
}
$('selectAccount').addEventListener('click',async()=>{const customerId=$('googleAccountSelect').value;if(!customerId)return toast('Sélectionnez votre compte.','warning');try{await fullApi('/api/google/accounts/select',{method:'POST',body:{customerId}});state.account=customerId;toast('Votre compte publicitaire est sélectionné');renderChecklist()}catch(e){toast(e.message,'error')}});
$('checkGeo').addEventListener('click',async()=>{
  try{const d=await fullApi('/api/google/geo');$('geoSelect').innerHTML='<option value="">Choisissez votre zone</option>'+(d.locations||[]).map(z=>`<option value="${safe(z.id)}">${safe(z.name)} · ${safe(z.type)}</option>`).join('');$('geoMessage').textContent=d.locations.length?'Choisissez votre ville puis confirmez.':'Aucune zone locale reconnue : vérifiez votre ville.';}catch(e){$('geoMessage').textContent=e.message}
});
$('saveGeo').addEventListener('click',async()=>{if(!$('geoSelect').value)return toast('Choisissez une zone.','warning');try{await fullApi('/api/google/geo/select',{method:'POST',body:{id:$('geoSelect').value}});toast('Ciblage géographique vérifié');await loadProfile()}catch(e){toast(e.message,'error')}});
async function loadDrafts(){
  try{const result=await fullApi('/api/campaigns/drafts');state.drafts=result.drafts||[];if(state.drafts.length)showDraft(state.drafts[0]);else{$('draftEmpty').classList.remove('hidden');$('campaignDraft').classList.add('hidden')}}catch(e){toast(e.message,'error')}
}
$('createDraft').addEventListener('click',async()=>{
  $('createDraft').disabled=true;
  try{const response=await fullApi('/api/campaigns/drafts',{method:'POST',body:{}});toast('Votre publicité a été préparée sans lancer de campagne');showDraft(response.draft);}
  catch(e){toast(e.message,'error')}finally{$('createDraft').disabled=false}
});
function showDraft(draft){
  const plan=draft.plan||{},box=$('campaignDraft');$('draftEmpty').classList.add('hidden');box.classList.remove('hidden');
  const headlines=plan.headlines||[],descriptions=plan.descriptions||[];
  box.innerHTML=`<div class="surface draft-card"><div class="draft-header"><div><h3>${safe(plan.jobLabel||'Campagne')} · ${safe(plan.city||'')}</h3><small>${plan.proximity?'Rayon '+safe(plan.proximity.radiusKm)+' km · ':''}Budget ${money(plan.dailyBudgetEuro||0)}/jour · ${safe(plan.destination==='site'?'Site web':plan.destination==='profile'?'Fiche Google':'Site + fiche Google')}</small></div><span class="draft-badge">${safe(draft.status||'Brouillon')}</span></div>
  <div class="draft-grid"><div><h4>Recherches à cibler</h4><div class="chips">${(plan.keywords||[]).map(x=>`<span class="chip">${safe(x.text)}</span>`).join('')}</div></div>
  <div><h4>Recherches à éviter (à vérifier)</h4><div class="chips">${(plan.negatives||[]).map(x=>`<span class="chip negative">${safe(x.text)}</span>`).join('')}</div></div>
  <div><h4>Titres des annonces</h4><div class="chips">${headlines.map(x=>`<span class="chip">${safe(x)}</span>`).join('')}</div></div>
  <div><h4>Descriptions des annonces</h4>${descriptions.map(x=>`<p class="footnote">${safe(x)}</p>`).join('')}</div></div></div>
  ${(plan.warnings||[]).length?`<ul class="warning-list">${plan.warnings.map(w=>`<li>${safe(w)}</li>`).join('')}</ul>`:''}
  <div class="campaign-actions"><button class="btn btn-light btn-small" id="improveCopy">Améliorer les textes</button><button class="btn btn-light btn-small" id="validateDraft">Vérifier sur Google Ads</button><button class="btn btn-green btn-small" id="publishPaused">Créer en pause (validation requise)</button></div><p class="footnote">La publication et l'activation ne sont pas automatiques. Une vraie campagne ne peut être créée qu'avec des droits Google et les contrôles de sécurité activés.</p></div>`;
  $('improveCopy').addEventListener('click',async()=>{try{const d=await fullApi('/api/campaigns/drafts/'+draft.id+'/suggest-copy',{method:'POST',body:{}});toast(d.copy.source==='templates_fallback'?'Textes de référence conservés':'Textes proposés : relisez-les.');await loadDrafts()}catch(e){toast(e.message,'error')}});
  $('validateDraft').addEventListener('click',async()=>{try{const d=await fullApi('/api/campaigns/drafts/'+draft.id+'/validate',{method:'POST',body:{}});toast('Google a validé la configuration sans créer de publicité.');await loadDrafts()}catch(e){toast(e.message,'error')}});
  $('publishPaused').addEventListener('click',async()=>{const phrase=prompt('Une campagne sera créée sur votre compte Google en PAUSE, sans diffusion. Saisissez : CREER EN PAUSE');if(phrase!=='CREER EN PAUSE')return;try{const d=await fullApi('/api/campaigns/drafts/'+draft.id+'/prepare-paused',{method:'POST',body:{confirm:phrase}});toast('Campagne créée en pause. Aucune dépense engagée.');await loadDrafts()}catch(e){toast(e.message,'error')}});
}
async function loadMetrics(){
  renderChecklist();if(!state.user)return;
  try{const notes=await fullApi('/api/notifications');const items=(notes.notifications||[]).slice(0,2);
    $('latestNotices').innerHTML=items.map(x=>`<div class="notice-item"><strong>${safe(x.title)}</strong><p>${safe(x.body)}</p></div>`).join('');
  }catch{}
  let i=state.integrations;
  if(!i){try{i=(await fullApi('/api/integrations'));state.integrations=i}catch{return}}
  if(!i.googleAds.connected)return;
  try{const result=await fullApi('/api/google/metrics');state.metricRows=result.rows||[];
    const total=state.metricRows.reduce((s,x)=>({spent:s.spent+Number(x.spent||0),calls:s.calls+Number(x.phoneCalls||0),conversions:s.conversions+Number(x.conversions||0)}),{spent:0,calls:0,conversions:0});
    $('metricSpend').textContent=money(total.spent);$('metricSpendInfo').textContent='30 derniers jours';$('metricCalls').textContent=String(total.calls);$('metricLeads').textContent=String(Number(total.conversions.toFixed(2)));
    renderChart(state.metricRows);if(result.notice){$('assistantNotice').innerHTML=`<span class="notice-symbol">i</span><div><strong>${result.notice.unusuallyHigh?'Votre budget a varié':'Votre budget est suivi chaque jour'}</strong><p>${safe(result.notice.explanation)}</p></div>`}
  }catch(e){$('metricSpendInfo').textContent='Google Ads : '+e.message}
}
function renderChart(rows){
  if(!rows.length)return;
  const list=[...rows].reverse().slice(-30),max=Math.max(1,...list.map(x=>Number(x.spent)||0));
  $('spendChart').innerHTML=`<div class="bar-chart" aria-label="Dépenses Google Ads réelles">${list.map(x=>`<i title="${safe(x.date||'Jour')} : ${money(x.spent||0)}" style="height:${Math.max(2,Number(x.spent||0)/max*100)}%"></i>`).join('')}</div><p class="footnote">Données Google Ads · Survolez les barres pour consulter la dépense.</p>`;
}
async function loadBilling(){
  try{const i=await fullApi('/api/integrations'),subscription=(await fullApi('/api/subscription')).subscription;
    $('subscriptionStatus').textContent='Statut : '+(subscription.status||'inactive');$('billingActions').innerHTML='';
    if(i.stripe.configured){const b=document.createElement('button');b.className='btn btn-green';b.textContent='Activer mon abonnement';b.addEventListener('click',async()=>{try{const r=await fullApi('/api/stripe/checkout',{method:'POST',body:{}});location.assign(r.url)}catch(e){toast(e.message,'error')}});$('billingActions').appendChild(b);
      if(subscription.status!=='inactive'){const portal=document.createElement('button');portal.className='btn btn-light';portal.textContent='Gérer ma facturation';portal.addEventListener('click',async()=>{try{const r=await fullApi('/api/stripe/portal',{method:'POST',body:{}});location.assign(r.url)}catch(e){toast(e.message,'error')}});$('billingActions').appendChild(portal)}}
    else $('billingActions').innerHTML='<p class="footnote">Stripe doit être configuré avant d’accepter des abonnements.</p>';
  }catch(e){toast(e.message,'error')}
}
boot();

async function loadBusinessAccounts(){
  try{const d=await fullApi('/api/google/business/accounts');const select=$('businessAccountSelect');
    select.innerHTML='<option value="">Choisissez votre compte établissement</option>'+(d.accounts||[]).map(a=>`<option value="${safe(String(a.name||'').split('/')[1])}">${safe(a.accountName||a.name)}</option>`).join('');
    $('businessLink').classList.remove('hidden');
  }catch(e){toast('Fiche Google : '+e.message,'warning')}
}
$('linkBusiness').addEventListener('click',async()=>{
  const id=$('businessAccountSelect').value;if(!id)return toast('Choisissez votre établissement','warning');
  if(!confirm('Autoriser l’utilisation de votre fiche comme extension de lieu dans Google Ads ? Cela ne garantit pas un emplacement sponsorisé sur Google Maps.'))return;
  try{const result=await fullApi('/api/google/business/link',{method:'POST',body:{businessAccountId:id,confirm:'ASSOCIER MA FICHE'}});toast(result.notice);$('businessLink').classList.add('hidden')}
  catch(e){toast(e.message,'error')}
});

$('loadRecommendations').addEventListener('click',async()=>{
  const box=$('recommendationsBox');box.innerHTML='<p class="footnote">Analyse en cours…</p>';
  try{const d=await fullApi('/api/google/recommendations');const list=d.suggestions||[];
    box.innerHTML=list.length?list.map(x=>`<div class="notice-item"><strong>À vérifier : « ${safe(x.term)} »</strong><p>${safe(x.clicks)} clics · ${money(x.spendEuro)} dépensés sur la période · Aucune conversion attribuée. Exclusion à valider avant application.</p></div>`).join(''):'<p class="footnote">Aucune suggestion suffisamment étayée pour le moment. Cela ne signifie pas que toutes les dépenses sont efficaces.</p>';
  }catch(e){box.innerHTML='<p class="footnote">'+safe(e.message)+'</p>'}
});
