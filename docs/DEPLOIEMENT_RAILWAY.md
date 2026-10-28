# Déployer ArtisanPilot V3 sur Railway

## Infrastructure déjà existante

- Projet Railway : `artisan-ads-autopilot`
- ID projet : `25539172-14e6-4132-98bc-29cc1bbb9da6`
- Environnement production : `ac5680dd-cf3a-4068-89d8-2fde453ec405`
- Service démo actuel : `artisanpilot-web` (ne pas écraser avant validation de la V3)
- Base : `Postgres` (service existant, région `sfo` au 28/10/2026)
- Démo publique existante : https://artisanpilot-web-production.up.railway.app

## Étape A — Dépôt propre à ArtisanPilot

Créer un dépôt GitHub privé **nouveau** (nom proposé `artisanpilot-saas`) sous le compte GitHub utilisé par Railway, puis y importer le contenu de ce dossier. Les outils connectés dans cette session permettent de gérer des fichiers dans des dépôts existants mais ne proposent pas la création d'un dépôt neuf. **Ne pas réutiliser le dépôt `stayshawk`, qui concerne un autre projet.**

Dans Railway, ouvrir le projet `artisan-ads-autopilot`, choisir **New service → GitHub Repo**, sélectionner le nouveau dépôt, conserver la branche principale. Le projet possède un `Dockerfile` et `railway.toml`. Créer le nouveau service sous le nom `artisanpilot-platform`, en parallèle de la démo.

## Étape B — Variables du nouveau service

Définir dans **Railway → Service → Variables** :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (référence Railway, pas de mot de passe en clair) |
| `NODE_ENV` | `production` |
| `APP_BASE_URL` | URL HTTPS publique du nouveau service, **sans slash final** |
| `GOOGLE_ADS_API_VERSION` | `v26` |

Lancer le service et vérifier `https://<domaine>/api/health` : `status=ok`, `database=true`. Le serveur initialise les tables de façon idempotente ; en production, prévoir une stratégie de migrations versionnées. Les tables ArtisanPilot V3 utilisent leurs propres noms (`users`, `profiles`, etc.) et ne modifient pas le service StaysPro distinct.

**Attention :** la région Railway observée est `sfo` (États-Unis), non une région européenne. Étudier le lieu de traitement et les garanties de transfert avant d'héberger des données d'artisans français en production.

## Étape C — Google Cloud + Google Ads

1. Configurer un projet Google Cloud et l'écran de consentement OAuth pour les scopes nécessaires (`adwords`, et séparément Business Profile `business.manage`, ainsi que l'identification de l'adresse email).
2. Créer un **OAuth Client ID de type Web Application**.
3. Ajouter exactement cette URI de redirection : `https://<domaine>/api/google/callback`.
4. Activer Google Ads API ; demander ou utiliser un jeton développeur conforme à la politique actuelle.
5. Si l'application doit créer un compte Ads pour un artisan, relier un MCC éligible. Google impose notamment plus de 1 000 USD de dépenses antérieures et un compte en règle pour cette fonctionnalité.
6. Dans Railway Variables, définir `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (MCC si nécessaire).
7. Définir `OAUTH_ENCRYPTION_KEY` à une **nouvelle clé aléatoire de 32 octets** encodée en 64 caractères hexadécimaux. Exemple de génération en local : `openssl rand -hex 32`. Ne jamais coller la valeur dans le chat.
8. Connecter un **compte de test ou pilote autorisé**, vérifier `/api/google/accounts`, puis sélectionner un compte en EUR.
9. Vérifier l'éligibilité et la facturation du compte Google. La carte ou le profil de paiement restent à renseigner dans l'environnement Google prévu à cet effet.

Pour Google Business Profile : vérifier l'accès à l'API, les scopes, les droits au compte et la disponibilité des assets de localisation. Activer `GOOGLE_BUSINESS_PROFILE_ENABLED=true` seulement après tests.

Les opérations qui peuvent modifier un compte sont désactivées par défaut :

- `GOOGLE_ADS_ALLOW_ACCOUNT_CREATION=false`
- `GOOGLE_ADS_ALLOW_CAMPAIGN_WRITES=false`
- `GOOGLE_ADS_ALLOW_LOCATION_SYNC=false`
- `GOOGLE_ADS_ALLOW_ACTIVATION=false`

Ne les activer individuellement qu'après test de bout en bout et contrôle opérationnel des comptes réels. Les campagnes créées sont initialement **PAUSED**.

## Étape D — Stripe

1. Créer le produit Stripe « ArtisanPilot » avec un tarif récurrent de **99 EUR/mois** dans le compte Stripe choisi.
2. Utiliser d'abord les **clés de TEST** et un prix de test.
3. Créer un webhook Stripe vers `https://<domaine>/api/stripe/webhook` en choisissant les événements `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` et `customer.subscription.deleted`.
4. Configurer dans Railway Variables `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
5. Vérifier la redirection de checkout, l'abonnement en base, la résiliation et la prévention des doublons. **Ne pas démarrer avec des clés live avant ces vérifications.**

## Étape E — Assistant IA et alertes

- `OPENAI_API_KEY` est facultative : sans clé, des textes prudents sont générés à partir de modèles prédéfinis.
- `OPENAI_MODEL` peut être ajusté à un modèle réellement disponible sur le compte API.
- `DAILY_REPORTS_ENABLED=false` et `CRON_TOKEN` doivent être configurés avant de lancer les collectes quotidiennes.
- Un déclencheur planifié doit appeler `POST /api/cron/daily` avec `Authorization: Bearer <CRON_TOKEN>` ; aucun appel sortant ne doit être lancé depuis une page navigateur.
- Les alertes budget apparaissent en espace client si une dépense observée dépasse le seuil personnalisé. **Aucun SMS, email ou WhatsApp n'est encore intégré.**

## Vérification et retour arrière

- `GET /api/health` : état explicite de la base et des API.
- `npm run check && npm test` : tests locaux.
- Vérifier dans Railway les logs de `artisanpilot-platform` et les métriques PostgreSQL.
- Conserver `artisanpilot-web` comme démonstration de secours le temps de la recette de V3.

**Aucun outil de cette conversation n'a pu déployer directement la V3** après les refus de publication de nouveaux services. Un dépôt GitHub ArtisanPilot distinct et sa connexion au nouveau service Railway constituent le chemin de déploiement restant.
