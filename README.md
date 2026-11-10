# ArtisanPilot — pilote à 99 €/mois

Version 0.4.1. Reprise du SaaS existant ; lancement payant soumis aux validations externes décrites dans [le guide pilote](docs/PILOT_LAUNCH.md).

## Parcours livré

- Compte email/mot de passe, sessions sécurisées, connexion Google avec PKCE ; vérification et récupération par email lorsque l’expéditeur est configuré.
- Studio artisan : génération OpenAI structurée, modèle de secours explicite, brouillon privé, publication avec coordonnées légales et conservation de la version publique pendant les modifications.
- Formulaire de rappel, suivi distinct des clics téléphoniques, qualification des demandes et des appels rapportés par Google.
- OAuth Google Ads, sélection d’un compte EUR avec prise en charge des comptes gérés, lecture des dépenses et suggestions, brouillons Search et validation sans écriture.
- Stripe Checkout à 99 €/mois en EUR, portail client et webhooks signés. Réutilisation des sessions, contrôle du prix, traitement transactionnel, dédoublonnage et relecture de l’état Stripe.
- Export vers Lovable et connexion d’un site publié par preuve de possession. Aucun achat de domaine ni génération Lovable autonome.

Cinq comptes maximum par défaut (`PILOT_MAX_ACCOUNTS`), sans retirer l’accès aux comptes déjà créés. Stripe est reporté : l’accès pilote est ouvert sans abonnement (`BILLING_REQUIRED=false`). Les paiements réels et les écritures Google Ads restent désactivés par défaut. Les tests Stripe ne permettent pas d’activer une campagne réelle. Aucun autopilot de dépenses, enregistrement audio ou transcription n’est annoncé comme opérationnel.

## Vérifier et lancer

Node.js 22+ et PostgreSQL sont nécessaires.

```sh
npm ci --include=dev
npm run check
npm test
cp .env.example .env
# Renseigner les valeurs de développement dans .env, sans les publier.
node --env-file=.env src/server.mjs
```

Les tests d’intégration HTTP utilisent un PostgreSQL WASM isolé et des fournisseurs simulés. Ils vérifient notamment les migrations sur comptes existants, l’isolation des données, OAuth, les formulaires, les quotas et les cas d’échec de facturation. Ils ne prouvent pas une connexion fournisseur réelle. Le contrôle automatisé GitHub reprend la vérification de syntaxe et les tests sous Node 22.

## Production existante

Projet Railway `artisan-ads-autopilot`, service applicatif `artisanpilot-mvp`, base privée `Postgres`. Le service `artisanpilot-web` est une ancienne démonstration séparée, conservée.

L’URL applicative est https://artisanpilot-mvp-production.up.railway.app/studio. `/api/health` indique la disponibilité PostgreSQL, la version et la présence des configurations ; la présence d’une clé ne prouve pas son fonctionnement. Le diagnostic connecté vérifie réellement OpenAI et, lorsqu’un compte est sélectionné, l’accès Google Ads.

Les migrations sont additives. Ne pas modifier la clé de chiffrement OAuth existante ni réinitialiser la base. Aucun nettoyage de données métier historiques n’est exécuté dans ce pilote.

## Dépendances avant ouverture payante (hors pilote gratuit)

Configurer et valider Stripe en TEST, le portail et ses webhooks ; connecter chaque vrai compte Google avec son propriétaire et vérifier le niveau d’accès du projet Cloud ; installer et vérifier les conversions d’appels ; valider l’expéditeur des emails et les sauvegardes. Compléter et valider les conditions commerciales et fiscales. Les paiements réels et chaque écriture publicitaire demandent une autorisation distincte après ces vérifications.

Le [guide pilote](docs/PILOT_LAUNCH.md) détaille les variables, les contrôles et le retour à la version précédente. Aucun secret ne doit être publié dans le dépôt ou les logs.
