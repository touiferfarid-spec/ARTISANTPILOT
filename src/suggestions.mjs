import {totalFromRows} from './planner.mjs';
const RISK_TERMS=/\b(formation|emploi|stage|salaire|recrutement|cours|tuto|tutoriel|gratuit|pdf|bricolage|école|alternance)\b/i;
export function suggestExclusions(rows,{minClicks=5,minSpendEuro=15}={}) {
  if(!Array.isArray(rows))return [];
  return rows.flatMap(row=>{
    const term=String(row.searchTermView?.searchTerm||'').trim();
    const spend=Number(row.metrics?.costMicros||0)/1e6;
    const conversions=Number(row.metrics?.conversions||0);
    const clicks=Number(row.metrics?.clicks||0);
    if(!term||!RISK_TERMS.test(term)||clicks<minClicks||spend<minSpendEuro||conversions>0)return [];
    return [{term,clicks,spendEuro:Math.round(spend*100)/100,conversions,risk:'Recherche probablement non commerciale',kind:'REVIEW_NEGATIVE',
      notice:'Suggestion à vérifier. Exclure cette recherche peut aussi bloquer de futurs prospects. Le montant historique n’est pas une économie garantie.'}];
  }).sort((a,b)=>b.spendEuro-a.spendEuro).slice(0,20);
}
export function performanceAlert(daily,average, priorImpressions){
  const observed=(daily.impressions!=null && Number.isFinite(Number(priorImpressions)) && priorImpressions>0);
  const demandValidated=observed && Number(daily.impressions)>Number(priorImpressions)*1.25;
  return {demandValidated,impressionComparison:observed?{today:daily.impressions,usual:priorImpressions}:null};
}
export {totalFromRows};
