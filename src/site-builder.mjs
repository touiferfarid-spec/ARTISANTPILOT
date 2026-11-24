import crypto from 'node:crypto';
import {renderCallLanding} from './landing.mjs';
import {tradeContent,serviceDescription} from './trade-content.mjs';
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
  if(businessName&&businessName.length<3)throw new Error('Indiquez le nom complet de votre entreprise.');
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
  const legalAddress=clean(value.legal_address,200);
  if(legalAddress && legalAddress.length<12)throw new Error('Adresse professionnelle incomplète (12 caractères minimum).');
  const siret=clean(value.siret,14).replace(/\s/g,'');
  if(siret && !/^\d{14}$/.test(siret))throw new Error('Le SIRET doit comporter exactement 14 chiffres. Laissez-le vide pour créer un brouillon.');
  const domainName=clean(value.domain_name,253).toLowerCase();
  if(domainName && !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(domainName))throw new Error('Nom de domaine non valide.');
  return {business_name:businessName||trades[job].name,business_name_pending:!businessName,contact_name:clean(value.contact_name,64),job,job_label:trades[job].name,city,city_code:clean(value.city_code,15),radius_km:radius,email,phone,services,description,advantage,schedule,postal_code:postal,legal_address:legalAddress,siret,domain_name:domainName,design_style:['local','signature','atelier'].includes(value.design_style)?value.design_style:'local'};
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
  const guide=tradeContent[site.job]||tradeContent.renovation;
  const services=Array.isArray(site.services)?site.services:[];
  return {
    heading:job+' à '+site.city,
    subheading:(services.length?serviceDescription(services[0],site.job)+' ':'')+'Appelez pour connaître les disponibilités à '+site.city+'.',
    about:site.description||site.business_name+' intervient à '+site.city+' et dans un rayon de '+site.radius_km+' km. Au téléphone, indiquez votre commune et la prestation souhaitée.',
    cta:'Appeler maintenant',service_intro:guide.serviceIntro,
    service_descriptions:services.map(service=>serviceDescription(service,site.job))
  };
}
const unverified=/(?:24\s*[h/]\s*(?:sur\s*)?(?:24|7)|7\s*j\s*\/\s*7|gratuit|garanti|certifi[ée]|meilleur|n[°º]\s*1|en\s*\d+\s*min|\d+\s*(?:€|euros?|ans d.expérience)|\d\s*\/\s*5|\d\s*étoiles?|agré[ée]|sans engagement|intervention immédiate|\bRGE\b)/iu;
function safeText(value,max) {
  if(typeof value!=='string')return '';
  const text=clean(value,max+1);
  return text.length>5&&text.length<=max&&!unverified.test(text)&&!/[<>]|https?:\/\//i.test(text)?text:'';
}
export function safeCopy(site,candidate){
  const fallback=fallbackCopy(site);if(!candidate||typeof candidate!=='object')return fallback;
  const out={...fallback};
  for(const [key,max] of Object.entries({heading:110,subheading:210,about:380,cta:40,service_intro:165})){
    const text=safeText(candidate[key],max);
    if(text&&(key!=='heading'||text.toLocaleLowerCase('fr').includes(String(site.city).toLocaleLowerCase('fr'))))out[key]=text;
  }
  const cards=candidate.service_descriptions;
  if(Array.isArray(cards)&&cards.length===fallback.service_descriptions.length){
    out.service_descriptions=cards.map((value,i)=>safeText(value,150)||fallback.service_descriptions[i]);
  }
  return out;
}
export function sitePreviewUrl(baseUrl,slug) { return baseUrl.replace(/\/$/,'')+'/p/'+encodeURIComponent(slug); }
export function renderLanding(site,{baseUrl='',customHost=false,preview=false}={}){
  const hostname=customHost?'https://'+site.domain_name:sitePreviewUrl(baseUrl,site.slug);
  return renderCallLanding(site,{baseUrl,hostname,preview,copy:safeCopy(site,site.copy),color:trades[site.job]?.color||'blue'});
}

export function renderLegalPage(site,kind='privacy'){
  const x=htmlEscape,slug=encodeURIComponent(site.slug);
  const privacy=kind==='privacy';
  const title=privacy?'Politique de confidentialité':'Mentions légales';
  const body=privacy?`
<h2>Responsable de traitement</h2><p>${x(site.business_name)}, ${x(site.legal_address)}. Contact : <a href="mailto:${x(site.email)}">${x(site.email)}</a>.</p>
<h2>Données et finalité</h2><p>Les coordonnées et le message saisis dans le formulaire de rappel sont transmis à l’entreprise pour répondre à votre demande. Ils ne sont pas utilisés pour vous inscrire à une newsletter. Les clics sur les boutons d’appel sont comptés séparément ; un clic ne prouve pas qu’un appel a abouti. L’empreinte technique utilisée pour limiter les abus n’est pas votre numéro de téléphone.</p>
<h2>Mesure publicitaire</h2><p>Lorsque la mesure Google Ads est configurée et acceptée par le visiteur, Google peut traiter des données liées aux interactions publicitaires. Vous pouvez refuser ce suivi depuis le bandeau de consentement.</p>
<h2>Conservation</h2><p>Pendant le pilote, les demandes et statistiques sont conservées pour le suivi de votre activité. Contactez l’entreprise pour obtenir leur suppression ; la durée de conservation doit être adaptée à votre besoin. Google traite les appels éligibles selon la configuration du compte publicitaire et ses propres règles de conservation.</p><h2>Vos droits</h2><p>Pour exercer vos droits d'accès, de rectification et de suppression, contactez ${x(site.email)}. Vous pouvez aussi saisir la CNIL.</p>
`:`
<h2>Éditeur</h2><p><strong>${x(site.business_name)}</strong><br>Entreprise : ${x(site.job_label)}${site.legal_address?`<br>Adresse professionnelle : ${x(site.legal_address)}`:''}${site.siret?`<br>SIRET : ${x(site.siret)}`:''}<br>Téléphone : ${x(site.phone)}<br>Email : <a href="mailto:${x(site.email)}">${x(site.email)}</a></p>
<h2>Hébergement technique</h2><p>Site généré et hébergé par ArtisanPilot sur une infrastructure cloud. Pour obtenir les coordonnées complètes du prestataire technique, contactez l'éditeur.</p>
`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${x(title)} — ${x(site.business_name)}</title><link rel="stylesheet" href="/landing.css"><meta name="robots" content="noindex,follow"></head><body><header class="landing-header"><div class="landing-wrap header-row"><a class="logo" href="/p/${slug}">← ${x(site.business_name)}</a></div></header><main class="landing-wrap landing-section" style="max-width:780px"><h1>${x(title)}</h1>${body}<p><a href="/p/${slug}">Retour au site</a></p></main></body></html>`;
}
