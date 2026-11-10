# ArtisanPilot: exploitation du pilote à 99 €/mois

Version 0.4.0, 10 novembre 2026. Reprise de la version 0.3.0 (41f4a15), avec récupération et vérification des modifications du précédent chat.

## Périmètre

Une page par artisan, génération de textes OpenAI avec repli explicite sur un modèle local, brouillons privés, publication après saisie du SIRET et de l’adresse, formulaires de rappel, suivi des clics, qualification des contacts. Connexion email/mot de passe et connexion Google distincte de l’autorisation Ads. Un compte Google Ads sélectionné par artisan, budgets en EUR, brouillons Search et recommandations en lecture seule.

Le pilote accepte cinq comptes au total par défaut (`PILOT_MAX_ACCOUNTS`). Les comptes existants gardent leur accès même si le quota est déjà atteint. Les créations de comptes par email et Google utilisent le même verrou PostgreSQL. La limite est opérationnelle, pas un système d’invitation nominative. Un compte de recette consomme aussi une place.

## Protections de production

Conserver `GOOGLE_ADS_ALLOW_ACCOUNT_CREATION`, `GOOGLE_ADS_ALLOW_CAMPAIGN_WRITES`, `GOOGLE_ADS_ALLOW_ACTIVATION`, `GOOGLE_ADS_ALLOW_LOCATION_SYNC`, `GOOGLE_ADS_ALLOW_CONVERSION_WRITES` et `STRIPE_ALLOW_LIVE_PAYMENTS` à false. Une validation Google `validateOnly` sur les services explicitement autorisés ne crée pas de campagne. Une campagne préparée après autorisation serait PAUSED ; son activation exige aussi le contrôle des conversions, l’abonnement et la confirmation explicite du budget.

Aucune publication de campagne ni activation n’est nécessaire à la recette de cette livraison. N’activer aucune écriture Google pendant l’audit. Ne pas activer les paiements réels.

## Données et déploiement

Migrations additives et répétables avec verrou, sans réinitialisation de base ni rotation de clés. Les anciennes sessions, pages et intégrations sont conservées. La clé OAUTH_ENCRYPTION_KEY doit rester identique pour déchiffrer les jetons existants. Aucun nettoyage automatique des contacts historiques dans cette livraison. Les durées de conservation du pilote restent à organiser avec les artisans.

`/api/health` doit répondre HTTP 200 avec database=true et version=0.4.0. Railway doit annoncer SUCCESS sur le commit livré. En cas d’échec applicatif, revenir à l’image précédente ; les colonnes et tables ajoutées peuvent rester. Ne pas annuler les migrations en supprimant les nouvelles données. Le volume PostgreSQL privé n’est pas modifié. La vérification d’une sauvegarde/restauration Railway reste à faire avant un pilote payant ; un déploiement réussi n’est pas une preuve de sauvegarde.

## Prérequis externes

1. Google : URI de redirection exacte APP_BASE_URL + /api/google/callback. Vérifier le consentement OAuth, les utilisateurs test ou la publication de l’application et l’accès production du projet Cloud. Connecter chaque véritable compte avec son propriétaire. Le developer token n’est plus requis depuis le 9 septembre 2026 ; l’accès appartient au projet Cloud (documentation Google liée ci-dessous).
2. Appels : vérifier le call reporting dans le compte, une action WEBSITE_CALL avec balise et numéro de transfert Google éligible, le consentement et un appel provenant de la page d’au moins 60 s. Un appel depuis une annonce ne suffit pas à valider le suivi de la page. Les clics ne sont jamais présentés comme des appels décrochés. Pas d’enregistrement, transcription, numéro dédié indépendant de Google ni résumé audio dans ce MVP.
3. OpenAI : clé existante préservée. Le bouton de diagnostic effectue une petite requête réelle ; la création d’une page doit renvoyer copy_source=ai pour prouver la génération réelle. Un fallback ne valide pas la clé. Limites par artisan de 20 générations de page/jour, 20 améliorations d’annonces/jour et 3 diagnostics/jour, en plus des limites par IP.
4. Stripe : configurer d’abord une clé TEST, un prix récurrent EUR de 9900 centimes/mois et STRIPE_WEBHOOK_SECRET. Événements : checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed. Webhook /api/stripe/webhook. Les signatures, environnements et prix sont contrôlés ; l’état courant est relu auprès de Stripe sous transaction, indépendamment de l’ordre des événements. Un retour du navigateur ne donne pas de droits. Une session Checkout ouverte est réutilisée et un abonnement existant bloque une nouvelle souscription. Configurer et tester le portail client. Les accès Google en production ne doivent pas dépendre d’un abonnement Stripe de test en exploitation réelle : maintenir l’activation Ads désactivée pendant la recette de paiement.
5. Emails : RESEND_API_KEY et MAIL_FROM avec expéditeur validé, sinon pas de récupération ni de confirmation d’email opérationnelle. Ne pas présenter cette fonction comme validée sans réception réelle.
6. Lovable : export prérempli puis action de l’utilisateur ; connexion du site publié par balise de possession. Une génération/publication entièrement automatique Lovable n’est pas fournie. Les domaines personnalisés payants et le registrar restent hors parcours pilote.

## Recette et autorisation de lancement

Exécuter npm ci, npm run check et npm test. Les tests utilisent un PostgreSQL WASM isolé et des réponses fournisseurs simulées. Ils ne prouvent ni l’autorisation d’un vrai compte Google ni un paiement Stripe réel.

Pour chaque artisan : vérifier son identité et les textes, publier son site avec ses données exactes, envoyer une demande de rappel de test consentie, connecter Google avec lui, lire les statistiques, valider un brouillon sans écriture. Configurer Stripe TEST et traiter un paiement de test, un impayé et une annulation. Valider l’email et la sauvegarde. Relire les conditions commerciales, la fiscalité, les informations du fournisseur et les obligations de confidentialité avant paiement réel. Lancer les annonces uniquement après accord distinct sur le compte, le budget et le suivi.

## Documentation fournisseur consultée

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- https://developers.google.com/google-ads/api/reference/rpc/v26/CreateCustomerClientRequest
- https://developers.google.com/google-ads/api/reference/rpc/v26/CallTrackingDisplayLocationEnum.CallTrackingDisplayLocation
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/checkout/sessions/create
