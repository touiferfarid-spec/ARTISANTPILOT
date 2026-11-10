(() => {
  'use strict';
  const script=document.currentScript;if(!script)return;
  const slug=script.dataset.slug,origin=new URL(script.src).origin;
  if(!/^[a-z0-9-]{5,90}$/.test(slug||''))return;
  if(window.__artisanTrack?.[slug])return;
  window.__artisanTrack=window.__artisanTrack||{};window.__artisanTrack[slug]=true;
  const endpoint=origin+'/api/public/sites/'+slug,links=new WeakSet(),forms=new WeakSet(),settings=new WeakSet();
  const requestId=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-artisan';
  const send=(type,body)=>fetch(endpoint+'/'+type,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'omit',keepalive:true});
  function bind(){
    for(const link of document.querySelectorAll('[data-call],a[href^="tel:"]')){if(links.has(link))continue;links.add(link);link.addEventListener('click',()=>{send('events',{type:'call_click',requestId:requestId()}).catch(()=>{});});}
    for(const form of document.querySelectorAll('form[data-artisan-lead]')){if(forms.has(form))continue;forms.add(form);form.addEventListener('submit',async event=>{
      event.preventDefault();if(!form.reportValidity())return;
      const status=form.querySelector('[data-form-status]'),button=form.querySelector('[type="submit"]');
      if(button?.disabled)return;if(button)button.disabled=true;if(status)status.textContent='Transmission de votre demande…';
      const fd=new FormData(form);const id=form.dataset.requestId||requestId();form.dataset.requestId=id;
      try{
        const r=await send('leads',{name:fd.get('name'),phone:fd.get('phone'),message:fd.get('message'),company:fd.get('company'),consent:form.elements.consent?.checked===true,requestId:id});
        const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Votre demande n’a pas pu être envoyée. Appelez directement l’entreprise.');
        if(status)status.textContent=data.message||'Votre demande est transmise.';form.reset();delete form.dataset.requestId;
      }catch(e){if(status)status.textContent=e.message;}
      finally{if(button)button.disabled=false;}
    });}
    for(const b of document.querySelectorAll('[data-consent-settings]')){if(settings.has(b))continue;settings.add(b);b.addEventListener('click',()=>{if(consentBox)consentBox.hidden=false;});}
  }
  let consentBox,activated=false,phone=script.dataset.phone||'',tag=null;
  function storageGet(){try{return localStorage.getItem('artisan-consent:'+slug)}catch{return null}}
  function storageSet(v){try{localStorage.setItem('artisan-consent:'+slug,v)}catch{}}
  function activate(){
    if(activated||!tag?.adsId||!tag.label)return;activated=true;
    window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};
    window.gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});
    window.gtag('consent','update',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'denied',analytics_storage:'denied'});
    window.gtag('js',new Date());window.gtag('config',tag.adsId);
    window.gtag('config',tag.adsId+'/'+tag.label,{phone_conversion_number:phone,
      phone_conversion_callback:(formatted,mobile)=>{
        if(storageGet()!=='yes'||!/^\+?[\d ()-]{6,30}$/.test(String(mobile||'')))return;
        for(const a of document.querySelectorAll('[data-call],a[href^="tel:"]'))a.href='tel:'+String(mobile).replace(/[^+\d]/g,'');
        for(const e of document.querySelectorAll('[data-number]'))e.textContent=formatted;
      }
    });
    const remote=document.createElement('script');remote.async=true;remote.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(tag.adsId);document.head.append(remote);
  }
  function consent(){
    if(!tag?.adsId||!tag.label)return;
    consentBox=document.createElement('aside');consentBox.setAttribute('aria-label','Mesure publicitaire');consentBox.style.cssText='position:fixed;bottom:85px;left:16px;right:16px;max-width:620px;margin:auto;background:#fff;color:#203428;border:1px solid #ccd6c5;border-radius:12px;padding:18px;box-shadow:0 5px 35px #0002;z-index:9999;font:13px/1.6 system-ui';
    const text=document.createElement('p');text.textContent='Autorisez-vous Google Ads à mesurer les appels liés à la publicité ? Votre choix ne change pas la possibilité de nous contacter.';
    const controls=document.createElement('div');controls.style.cssText='display:flex;gap:12px';
    for(const [label,value] of [['Accepter','yes'],['Refuser','no']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='flex:1;padding:10px;border:1px solid #ccd6c5;border-radius:6px;background:#fff;color:#203428;font:inherit;cursor:pointer';b.onclick=()=>{storageSet(value);consentBox.hidden=true;if(value==='yes')activate();else{if(window.gtag)window.gtag('consent','update',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});for(const a of document.querySelectorAll('[data-call],a[href^="tel:"]'))a.href='tel:'+phone;for(const e of document.querySelectorAll('[data-number]'))e.textContent=phone;}};controls.append(b);}
    consentBox.append(text,controls);document.body.append(consentBox);const saved=storageGet();consentBox.hidden=!!saved;if(saved==='yes')activate();
  }
  bind();const observer=new MutationObserver(bind);observer.observe(document.body,{childList:true,subtree:true});
  fetch(endpoint,{credentials:'omit'}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{const s=d.site;phone=s.phone||phone;tag=s.tracking;if(!/^AW-\d{6,16}$/.test(tag?.adsId||'')||!/^[A-Za-z0-9_-]{4,100}$/.test(tag?.label||''))tag=null;consent();}).catch(()=>{});
})();
