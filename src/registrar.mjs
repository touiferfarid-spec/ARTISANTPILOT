import {config} from './config.mjs';
const ROOT='https://api.openprovider.eu/v1';
export function splitDomain(input){
  const str=String(input||'').toLowerCase().trim();
  if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:fr|com|net|org)$/.test(str))throw Error('Nom de domaine invalide ou extension non prise en charge.');
  const parts=str.split('.'); const extension=parts.pop();
  return {name:parts.join('.'),extension};
}
export async function registrarAuth(fetcher=fetch){
  if(!config.registrarUser||!config.registrarPassword)throw Error('Compte revendeur Openprovider non configuré.');
  const response=await fetcher(ROOT+'/auth/login',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({username:config.registrarUser,password:config.registrarPassword,ip:'0.0.0.0'}),signal:AbortSignal.timeout(16000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||Number(data.code||0)!==0||!data.data?.token)throw Error('Authentification du registrar impossible.');
  return data.data.token;
}
export async function checkAvailability(domainNames,{fetcher=fetch}={}){
  if(!Array.isArray(domainNames)||!domainNames.length||domainNames.length>10)throw Error('Entre 1 et 10 domaines à vérifier.');
  const domains=domainNames.map(splitDomain);
  const bearer=await registrarAuth(fetcher);
  const response=await fetcher(ROOT+'/domains/check',{
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+bearer},
    body:JSON.stringify({domains,with_price:true}),signal:AbortSignal.timeout(18000)
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||Number(body.code||0)!==0)throw Error('Le fournisseur ne peut pas vérifier la disponibilité pour le moment.');
  return {raw:body.data||{},notice:'Prix et disponibilités indicatifs. Aucun achat réalisé.'};
}
