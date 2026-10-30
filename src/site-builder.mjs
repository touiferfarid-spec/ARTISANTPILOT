import crypto from 'node:crypto';
import {normalizeFrenchPhone} from './phone.mjs';

export const trades = Object.freeze({
  plombier: {name:'Plombier', services:['Recherche de fuite','Dépannage plomberie','Débouchage','Installation sanitaire','Réparation de robinet','Remplacement de chauffe-eau'], color:'blue'},
  electricien: {name:'Électricien', services:['Dépannage électrique','Mise aux normes','Installation de prises','Tableau électrique','Éclairage','Recherche de panne'], color:'orange'},
  couvreur: {name:'Couvreur', services:['Réparation de toiture','Recherche de fuite toiture','Rénovation de couverture','Nettoyage toiture','Zinguerie','Gouttières'], color:'slate'},
  serrurier: {name:'Serrurier', services:['Ouverture de porte','Changement de serrure','Serrure bloquée','Blindage de porte','Sécurisation','Dépannage serrurerie'], color:'slate'},
  chauffagiste: {name:'Chauffagiste', services:['Dépannage chauffage','Entretien chaudière','Remplacement chaudière','Installation radiateur','Pompe à chaleur','Réparation chauffage'], color:'orange'},
  climatisation: {name:'Installateur de climatisation', services:['Installation climatisation','Dépannage climatisation','Entretien climatiseur','Climatisation réversible','Maintenance climatisation'], color:'blue'},
  debouchage: {name:'Déboucheur', services:['Débouchage canalisation','Débouchage WC','Débouchage évier','Inspection canalisation','Curage canalisation'], color:'blue'},
  vitrier: {name:'Vitrier', services:['Remplacement vitre','Dépannage vitrerie','Double vitrage','Vitrine de magasin','Réparation fenêtre'], color:'blue'},
  menuisier: {name:'Menuisier', services:['Pose de fenêtres','Pose de portes','Menuiserie sur mesure','Volets roulants','Agencement intérieur'], color:'amber'},
  peintre: {name:'Peintre en bâtiment', services:['Peinture intérieure','Peinture extérieure','Rénovation des murs','Enduit et préparation','Ravalement'], color:'orange'},
  jardinier: {name:'Jardinier paysagiste', services:['Entretien de jardin','Taille de haies','Élagage','Tonte de pelouse','Aménagement paysager'], color:'green'},
  macon: {name:'Maçon', services:['Maçonnerie générale','Muret et clôture','Extension de maison','Terrasse béton','Rénovation de façade'], color:'slate'},
  renovation: {name:'Entreprise de rénovation', services:['Rénovation de salle de bain','Rénovation intérieure','Rénovation de cuisine','Travaux tous corps d’état','Aménagement intérieur'], color:'amber'},
  isolation: {name:'Entreprise d’isolation', services:['Isolation des combles','Isolation thermique','Isolation extérieure','Isolation des murs','Rénovation énergétique'], color:'green'},
});
const clean=(v,max=100)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const alphabetize=v=>clean(v,90).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const emails=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function normalizeSiteInput(value={}) {
  const job=clean(value.job,40).toLowerCase();
  if(!Object.hasOwn(trades,job))throw new Error('Sélectionnez un métier dans la liste.');
  const businessName=clean(value.business_name,90),city=clean(value.city,90),email=clean(value.email,180).toLowerCase();
  if(businessName.length<3)throw new Error('Indiquez le nom complet de votre entreprise.');
  if(city.length<2)throw new Error('Indiquez votre ville.');
  if(!emails.test(email))throw new Error('Indiquez une adresse email valide.');
  const phone=normalizeFrenchPhone(value.phone);
  if(!phone)throw new Error('Indiquez un numéro de téléphone professionnel.');
  const radius=Number(value.radius_km||20);
  if(!Number.isInteger(radius)||radius<1||radius>80)throw new Error('Rayon d’intervention invalide (1 à 80 km).');
  const inputServices=Array.isArray(value.services)?value.services:[];
  const services=[...new Set(inputServices.map(x=>clean(x,65)).filter(x=>x.length>=3))].slice(0,8);
  if(services.length<1)throw new Error('Sélectionnez au moins une prestation.');
  const description=clean(value.description,600);
  const advantage=clean(value.advantage,200);
  const schedule=clean(value.schedule,100);
  const postal=clean(value.postal_code,10);
  const siret=clean(value.siret,14).replace(/\s/g,'');
  if(siret && !/^\d{14}$/.test(siret))throw new Error('Le SIRET doit contenir 14 chiffres.');
  const domainName=clean(value.domain_name,253).toLowerCase();
  if(domainName && !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(domainName))throw new Error('Nom de domaine non valide.');
  return {business_name:businessName,job,job_label:trades[job].name,city,city_code:clean(value.city_code,15),radius_km:radius,email,phone,services,description,advantage,schedule,postal_code:postal,siret,domain_name:domainName};
}
export function makeSlug(input) {
  const prefix=alphabetize(input.business_name+'-'+input.city).slice(0,52).replace(/-$/,'')||'artisan';
  return prefix+'-'+crypto.randomBytes(3).toString('hex');
}
export function suggestDomains(input) {
  const brand=alphabetize(input.business_name).replace(/-/g,'').slice(0,24);
  const city=alphabetize(input.city).replace(/-/g,'').slice(0,18);
  const profession=alphabetize(trades[input.job]?.name||input.job).replace(/-/g,'').slice(0,22);
  const labels=[brand,brand+'-'+city,profession+'-'+city].filter(Boolean);
  return [...new Set(labels.flatMap(x=>[x+'.fr',x+'.com']))].slice(0,6).map(domain=>({domain,availability:'unverified',price:null}));
}
export const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function fallbackCopy(site){
  const job=site.job_label||trades[site.job]?.name||'Artisan';
  return {
    heading:job+' à '+site.city,
    subheading:'Un besoin en '+job.toLowerCase()+' ? Contactez directement '+site.business_name+' pour présenter votre projet ou demander un devis.',
    about:site.description||site.business_name+' intervient à '+site.city+' et dans les communes environnantes selon les prestations demandées.',
    cta:'Appeler maintenant',
    service_intro:'Découvrez les prestations proposées par notre équipe.',
  };
}
const plain=v=>clean(v,350);
export function safeCopy(site,candidate){
  const fallback=fallbackCopy(site);if(!candidate||typeof candidate!=='object')return fallback;
  const permitted=['heading','subheading','about','cta','service_intro'];
  const out={...fallback};for(const key of permitted){const val=plain(candidate[key]);if(val&&val.length>5&&!/\b(24\s*\/?\s*7|gratuit|garanti|certifi[ée]|meilleur|n°\s*1|en\s*\d+\s*minutes)\b/i.test(val))out[key]=val;}
  return out;
}
export function sitePreviewUrl(baseUrl,slug) { return baseUrl.replace(/\/$/,'')+'/p/'+encodeURIComponent(slug); }
export function renderLanding(site,{baseUrl='',customHost=false}={}){
  const x=htmlEscape;
  const copy=safeCopy(site,site.copy);
  const serviceList=(Array.isArray(site.services)?site.services:[]).slice(0,8);
  const phone=String(site.phone||'');
  const title=copy.heading+' | '+site.business_name;
  const desc=copy.subheading.slice(0,155);
  const color=trades[site.job]?.color||'blue';
  const adsId=/^AW-\d{6,16}$/.test(String(site.google_tag_id||''))?String(site.google_tag_id):'';
  const label=/^[a-zA-Z0-9_-]{4,100}$/.test(String(site.google_conversion_label||''))?String(site.google_conversion_label):'';
  const tracked=Boolean(adsId&&label);
  const hostname=customHost?'https://'+site.domain_name:sitePreviewUrl(baseUrl,site.slug);
  const scriptAttrs='data-slug="'+x(site.slug)+'" data-phone="'+x(phone)+'" data-ads-id="'+x(adsId)+'" data-label="'+x(label)+'"';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${x(title)}</title><meta name="description" content="${x(desc)}"><meta name="theme-color" content="#0e263c">
<link rel="canonical" href="${x(hostname)}"><link rel="stylesheet" href="/landing.css"></head>
<body class="landing theme-${x(color)}">
<header class="landing-header"><div class="landing-wrap header-row"><a class="logo" href="#accueil"><span class="logo-icon">✳</span><span>${x(site.business_name)}</span></a><a class="mini-phone" href="tel:${x(phone)}" data-call>☎ <span>Appelez-nous</span></a></div></header>
<main id="accueil"><section class="landing-hero"><div class="landing-wrap hero-layout"><div class="hero-words"><div class="eyebrow"><span class="pulse"></span> ${x(site.job_label)} · ${x(site.city)}</div>
<h1>${x(copy.heading)}</h1><p class="hero-subtitle">${x(copy.subheading)}</p>
<div class="hero-actions"><a class="primary-call" href="tel:${x(phone)}" data-call>☎ &nbsp; ${x(copy.cta)}</a><a href="#prestations" class="secondary-call">Nos prestations ↓</a></div>
<p class="help-line">Contact direct avec l’entreprise · Numéro : <strong data-number>${x(phone)}</strong></p></div>
<div class="hero-card"><div class="card-mark">✳</div><div class="card-overline">Besoin d’un professionnel ?</div><h2>Parlons de votre projet</h2><p>Présentez-nous votre besoin par téléphone. Nous vous indiquerons les prochaines étapes.</p><a href="tel:${x(phone)}" data-call class="card-call">☎ &nbsp; Appeler ${x(site.business_name)}</a><div class="card-geo">◎ ${x(site.city)} · Rayon déclaré : ${x(site.radius_km)} km</div></div></div></section>
<section id="prestations" class="landing-section"><div class="landing-wrap"><div class="section-kicker">NOS SERVICES</div><h2>Des prestations adaptées à vos besoins</h2><p class="section-intro">${x(copy.service_intro)}</p><div class="services-grid">${serviceList.map((service,i)=>`<article class="service-card"><div class="service-icon">${String(i+1).padStart(2,'0')}</div><h3>${x(service)}</h3><p>Vous avez besoin de cette prestation ? Échangeons sur votre demande.</p><a href="tel:${x(phone)}" data-call>Nous appeler →</a></article>`).join('')}</div></div></section>
<section class="landing-section location-section"><div class="landing-wrap location-layout"><div><div class="section-kicker">VOTRE ENTREPRISE LOCALE</div><h2>${x(site.business_name)}</h2><p>${x(copy.about)}</p>${site.advantage?`<p class="advantage">${x(site.advantage)}</p>`:''}${site.schedule?`<p><strong>Horaires déclarés :</strong> ${x(site.schedule)}</p>`:''}<div class="location-badge">◎ ${x(site.city)} et environs</div></div><div class="contact-panel"><h3>Nous contacter</h3><p>Contactez notre entreprise pour obtenir des informations sur votre besoin.</p><a class="primary-call" href="tel:${x(phone)}" data-call>☎ &nbsp; Appeler l’entreprise</a><a class="email-link" href="mailto:${x(site.email)}">${x(site.email)}</a></div></div></section>
<section class="final-banner"><div class="landing-wrap"><h2>Votre projet commence par un appel.</h2><p>Expliquez votre besoin directement à ${x(site.business_name)}.</p><a class="primary-call light" href="tel:${x(phone)}" data-call>☎ &nbsp; Nous appeler</a></div></section></main>
<footer class="landing-footer"><div class="landing-wrap footer-row"><div><strong>${x(site.business_name)}</strong><span>${x(site.job_label)} · ${x(site.city)}</span>${site.siret?`<span>SIRET : ${x(site.siret)}</span>`:''}</div><div><a href="mailto:${x(site.email)}">Email</a><a href="/privacy">Confidentialité</a><span>Ce site est édité par l’entreprise indiquée.</span></div></div></footer>
<a class="sticky-mobile" href="tel:${x(phone)}" data-call>☎ &nbsp; ${x(copy.cta)}</a>
<div class="consent-box" id="consentBox" hidden><span>Autorisez-vous la mesure publicitaire des appels via Google ?</span><div><button type="button" id="consentAccept">Accepter</button><button type="button" id="consentReject">Refuser</button></div></div>
<script src="/site-track.js" defer ${scriptAttrs}></script></body></html>`;
}
