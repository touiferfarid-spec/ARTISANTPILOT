import {config} from './config.mjs';
import {readTrackingState} from './tracking.mjs';

export async function launchReadiness(query,userId,account) {
  const [sites,links,drafts,payments,tracking]=await Promise.all([
    query('SELECT status FROM artisan_sites WHERE user_id=$1',[userId]),
    query("SELECT 1 FROM integrations WHERE user_id=$1 AND provider='ads'",[userId]),
    query('SELECT status,plan FROM campaign_drafts WHERE user_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 30',[userId,account?.customer_id||'']),
    query('SELECT status,livemode FROM subscriptions WHERE user_id=$1',[userId]),
    readTrackingState(query,userId,account)
  ]);
  const published=sites.rows[0]?.status==='published';
  const prepared=drafts.rows.some(d=>['validated','paused','active'].includes(d.status)&&d.plan.website===tracking.website&&d.plan.callPhone===tracking.phone);
  const paid=!config.billingRequired||(['active','trialing'].includes(payments.rows[0]?.status)&&payments.rows[0]?.livemode&&config.stripeAllowLive);
  const steps=[
    {id:'site',label:'Publier votre site',done:published,target:'site',detail:published?'Votre site est accessible.':'Préparez votre page, relisez-la et ajoutez vos coordonnées avant publication.'},
    {id:'google',label:'Connecter Google Ads',done:Boolean(account&&links.rows.length),target:'google',detail:account?'Compte sélectionné : '+account.name+'.':links.rows.length?'Autorisation reçue. Choisissez le compte de votre entreprise.':'Connectez le compte publicitaire de votre entreprise.'},
    {id:'campaign',label:'Vérifier votre publicité',done:prepared,target:'google',detail:prepared?'Un brouillon a été vérifié pour votre site et votre numéro actuels.':'Enregistrez votre budget, préparez votre publicité et vérifiez-la chez Google.'},
    {id:'tracking',label:'Installer le suivi des appels',done:tracking.installed,target:'google',detail:tracking.installed?'La balise est installée pour le site et le numéro actuels.':'Installez la mesure sur le site qui recevra vos visiteurs.'},
    {id:'test',label:'Vérifier un appel test',done:tracking.verified,target:'google',detail:tracking.verified?'Un appel de page web d’au moins 60 s a été rapporté après l’installation.':'Effectuez un appel test depuis une visite publicitaire éligible, puis vérifiez sa remontée.'}
  ];
  if(config.billingRequired)steps.push({id:'billing',label:'Activer votre abonnement',done:Boolean(paid),target:'account',detail:paid?'Votre abonnement est actif.':'Un abonnement actif est nécessaire avant diffusion.'});
  const blockers=[];
  if(!config.allowCampaignWrites)blockers.push('La création des campagnes est en attente d’ouverture par l’équipe ArtisanPilot.');
  if(!config.allowActivation)blockers.push('La diffusion est en attente d’ouverture par l’équipe ArtisanPilot.');
  return {steps,completed:steps.filter(s=>s.done).length,total:steps.length,blockers,
    readyForActivation:steps.every(s=>s.done)&&!blockers.length,
    mode:config.billingRequired?'subscription':'pilot',
    notice:'L’activation d’une campagne demandera votre confirmation du budget. Aucun lancement automatique.'};
}
