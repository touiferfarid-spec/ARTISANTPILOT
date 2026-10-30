import {validCoordinates,validateRadiusKm} from './locations.mjs';
import {normalizeFrenchPhone} from './phone.mjs';
const JOBS = {
  plombier: {
    label:'Plomberie', variants:['plombier','dépannage plomberie','urgence plomberie','réparation fuite'],
    services:['Fuite d’eau','Débouchage','Dépannage plomberie'],
    negatives:['emploi','recrutement','formation','salaire','stage','alternance','école','cours','tutoriel','gratuit','pdf','bricolage','comment faire']
  },
  serrurier:{label:'Serrurerie',variants:['serrurier','ouverture de porte','dépannage serrure','serrurier urgence'],services:['Ouverture de porte','Serrure bloquée','Dépannage serrurerie'],negatives:['emploi','recrutement','formation','salaire','stage','cours','tutoriel','gratuit','fournisseur']},
  debouchage:{label:'Débouchage',variants:['débouchage canalisation','canalisation bouchée','déboucheur professionnel','débouchage évier'],services:['Canalisations','Débouchage urgent','Diagnostic bouchon'],negatives:['emploi','formation','salaire','stage','gratuit','tutoriel','produit maison','bicarbonate','vinaigre']},
  electricien:{label:'Électricité',variants:['électricien','dépannage électrique','panne électricité','urgence électricien'],services:['Dépannage électrique','Panne de courant','Installation électrique'],negatives:['emploi','salaire','recrutement','formation','stage','bac pro','cours','tutoriel','gratuit']},
  chauffagiste:{label:'Chauffage',variants:['chauffagiste','dépannage chauffage','panne chaudière','réparation chaudière'],services:['Dépannage chaudière','Panne de chauffage','Entretien'],negatives:['emploi','recrutement','salaire','formation','stage','tutoriel','gratuit']},
  vitrier:{label:'Vitrerie',variants:['vitrier','remplacement vitre','dépannage vitrerie','vitrier urgence'],services:['Remplacement vitrage','Bris de glace','Vitrerie'],negatives:['emploi','recrutement','formation','salaire','stage','tutoriel','gratuit']},
  climatisation:{label:'Climatisation',variants:['dépannage climatisation','réparation climatiseur','technicien climatisation','panne climatisation'],services:['Réparation climatisation','Maintenance clim','Panne de clim'],negatives:['emploi','recrutement','salaire','formation','stage','tutoriel','gratuit']},
};
const clean=x=>String(x||'').trim().replace(/\s+/g,' ');
const unique=arr=>[...new Set(arr.map(clean).filter(Boolean))];
export function generatePlan(profile) {
  const job = String(profile.job||'plombier').toLowerCase();
  const data=JOBS[job]||{
    label:profile.job_label||job,
    variants:[profile.job_label||job,...(Array.isArray(profile.services)?profile.services.slice(0,4):[])],
    services:Array.isArray(profile.services)?profile.services:['Demandez un devis'],
    negatives:['emploi','formation','stage','salaire','cours','gratuit','tutoriel']
  };
  const city=clean(profile.city||'');
  const businessName=clean(profile.business_name||'Votre artisan');
  const budget=Number(profile.budget_eur||30);
  if(!city || city.length>90)throw Error('La ville est obligatoire');
  if(!Number.isFinite(budget)||budget<5||budget>5000)throw Error('Budget invalide');
  const variants=data.variants;
  const keywords=unique(variants.flatMap(x=>[`${x} ${city}`,`${x} près de moi`])).slice(0,14).map(text=>({text,matchType:'PHRASE'}));
  let headlines=unique([
    `${data.label} à ${city}`,`Dépannage ${city}`,`Artisan à ${city}`,`Besoin d’un ${data.label}?`,
    'Demandez un devis','Intervention sur demande', 'Contactez notre équipe','Un artisan près de vous',
    'Service professionnel', 'Parlez à un professionnel', `${data.services[0]} à ${city}`,
    `Entreprise ${businessName}`
  ]).filter(x=>x.length<=30);
  if(headlines.length<3)headlines=unique(['Demandez un devis','Intervention sur demande','Contactez un artisan']);
  const descriptions=unique([
    `Besoin d’aide en ${data.label.toLowerCase()} à ${city} ? Contactez notre équipe pour un devis.`,
    `Intervention à ${city} et alentours. Expliquez-nous votre besoin et obtenez une réponse.`,
    `Contactez un artisan à ${city} pour vos besoins de ${data.label.toLowerCase()}.`,
  ]).filter(x=>x.length<=90);
  // Every new Search campaign lands on the artisan's own site or generated page.
  const destination='site';
  const website=clean(profile.website||'');
  let callPhone='';
  try{callPhone=normalizeFrenchPhone(profile.phone)}catch{}
  const verifiedSite=/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(website);
  let proximity=null;
  if(profile.city_code && validCoordinates(profile.city_lat,profile.city_lng)){
    try{proximity={cityCode:String(profile.city_code),lat:Number(profile.city_lat),lng:Number(profile.city_lng),radiusKm:validateRadiusKm(profile.radius_km??20)}}catch{}
  }
  const warnings=[];
  if(!verifiedSite)warnings.push('Site HTTPS vérifié obligatoire pour une campagne Search classique.');
  if(!callPhone)warnings.push('Numéro professionnel manquant : renseignez-le avant de valider le bouton d’appel Google Ads.');
  if(!proximity&&!profile.geo_target_id)warnings.push('Sélectionnez et validez la ville et le rayon d’intervention avant de publier.');
  if(!profile.conversion_verified)warnings.push('Tracking des appels et formulaires non validé.');
  return {
    kind:'SEARCH', job, jobLabel:data.label, city, destination, website, dailyBudgetEuro:budget,
    keywords, negatives:data.negatives.map(text=>({text,matchType:'PHRASE'})),
    headlines:headlines.slice(0,15), descriptions:descriptions.slice(0,4),
    geoTargetId:profile.geo_target_id||null, proximity,
    callPhone, callCountryCode:'FR', callTrackingNote:'Mesure des appels réels à vérifier dans les paramètres Google Ads.',
    recommendedBidStrategy:'MAXIMIZE_CLICKS_INITIAL',
    status:'draft', warnings,
    createdBy:'ArtisanPilot',
    claims:'Aucune promesse de délai ou d’intervention 24/7 sans preuve de disponibilité réelle.'
  };
}
export function dailyBudgetInfo(budget,spent,signals={}) {
  budget=Number(budget);spent=Number(spent);
  if(!Number.isFinite(budget)||budget<=0||!Number.isFinite(spent)||spent<0)throw Error('Budget ou dépense invalide');
  const ratio=spent/budget;
  const unusuallyHigh=ratio>1.1;
  const demandValidated=signals.demandValidated===true;
  let explanation='Dépense dans la plage habituelle de votre budget moyen.';
  if(unusuallyHigh)explanation=demandValidated?
    'Aujourd’hui, la demande observée est plus élevée que d’habitude ; Google a aussi dépensé davantage.':
    'Google a dépensé davantage que votre budget journalier moyen. Il peut le faire certains jours pour saisir des opportunités, mais nous ne pouvons pas confirmer une hausse de la demande sans données supplémentaires.';
  if(ratio<0.7)explanation='Google a dépensé moins que le budget journalier moyen. Cela ne signifie pas forcément un problème.';
  return {budget,spent,ratio:Number(ratio.toFixed(3)),isAboveAverage:ratio>1,unusuallyHigh,approxMonthlyLimit:Number((budget*30.4).toFixed(2)),usualDailyLimit:Number((budget*2).toFixed(2)),explanation,disclaimer:'Règles usuelles Google Ads : le plafond réel dépend du type de campagne et des conditions de facturation.'};
}
export function totalFromRows(rows){return rows.reduce((a,row)=>({impressions:a.impressions+Number(row.metrics?.impressions||0),clicks:a.clicks+Number(row.metrics?.clicks||0),spendMicros:a.spendMicros+Number(row.metrics?.costMicros||0),conversions:a.conversions+Number(row.metrics?.conversions||0),phoneCalls:a.phoneCalls+Number(row.metrics?.phoneCalls||0)}),{impressions:0,clicks:0,spendMicros:0,conversions:0,phoneCalls:0});}
export const knownJobs=Object.keys(JOBS);
