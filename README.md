# ArtisanPilot V3 — SaaS Google Ads pour artisans

**Version : 0.3.0 · Prototype multi-clients · Non encore commercialisable**

ArtisanPilot accompagne les plombiers, serruriers, déboucheurs, électriciens, chauffagistes, vitriers et entreprises de climatisation dans la préparation et la gestion de leurs publicités Google. Les écrans utilisent le vocabulaire des artisans : activité, ville, budget, appels, devis et dépenses.

## Ce qui est développé

| Fonction | État du code | État réel |
|---|---|---|
| Landing page / UX responsive | Développé | Testé syntaxiquement, pas de recette navigateur complète |
| Inscription et connexion | Développé | Nécessite PostgreSQL accessible |
| Sessions sécurisées et stockage séparé par artisan | Développé | Non testé contre PostgreSQL réel dans cette session |
| Configuration métier, ville, site / fiche / les deux, budget | Développé | Non déployé |
| Brouillons Search par métier et mots-clés négatifs | Développé et testé | Pas de campagne créée |
| Connexion OAuth Google Ads | Développé | Client OAuth et jeton développeur non fournis |
| Lecture comptes Google et métriques sur 30 jours | Développé | Non testé avec compte Google réel |
| Création de sous-compte via MCC éligible | Développé derrière drapeau OFF | MCC éligible et facturation Google requis |
| Création Google Search par API (PAUSED) | Développé derrière drapeau OFF | Contrôle des conversions et validation Google requis |
| Activation d'une campagne | Développé derrière drapeau OFF + vérification conversion et abonnement | Désactivé |
| Business Profile OAuth + association extension de lieu | Développé derrière drapeau OFF | Disponibilité locale soumise à Google |
| Stripe Checkout + portail + webhooks signés | Développé | Compte Stripe, tarif et signature non configurés |
| Suggestions de termes de recherche à examiner | Développé | Non automatisées en modification |
| Notifications budget et rapports quotidiens (cron) | Développé | Nécessite cron et Google Ads connecté |
| Suggestions de textes via OpenAI | Facultatif, avec fallback déterministe | Clé OpenAI non configurée |
| Qualification réelle des appels | Non développée | Système de call tracking à choisir |
| Optimisation des campagnes en autopilot complet | Pas encore développée | Ne pas promettre ce service avant tests |

**Important :** le projet Railway existant `artisan-ads-autopilot` comprend une démo `artisanpilot-web` et une base `Postgres` en ligne. **La V3 contenue dans ce dossier n'a pas été déployée** : les outils de création/mise à jour des services Railway ont refusé les tentatives précédentes. La démo reste inchangée. Aucun Google Ads, Stripe ou OpenAI API réel n'a été connecté.

## Tests disponibles

```bash
npm run check
npm test
```

Les tests n'utilisent pas de données de clients. Ils portent sur les limites publicitaires, les mots de passe, la signature Stripe, les règles d'explication du budget et la structure de campagnes Google Search. Ils **ne remplacent pas** les tests d'intégration avec les vraies API et une vraie base PostgreSQL.

## Démarrage local

Prérequis : Node.js 22+, PostgreSQL, accès npm.

```bash
npm install
cp .env.example .env
# Modifier .env en local avec les valeurs de développement.
node --env-file=.env src/server.mjs
```

L'application est disponible sur `http://localhost:3000`. L'endpoint `/api/health` indique si la base et les intégrations sont opérationnelles. Sans `DATABASE_URL`, la page d'accueil fonctionne mais les fonctionnalités nécessitant des données clients restent désactivées.

## Déploiement prévu

Voir [docs/DEPLOIEMENT_RAILWAY.md](docs/DEPLOIEMENT_RAILWAY.md) pour les opérations précises. Ne pas pousser ce dossier dans un dépôt existant sans lien avec ArtisanPilot.

## Gouvernance des dépenses publicitaires

- Aucun compte Google Ads n'est créé par simple inscription au SaaS.
- Les opérations d'écriture sont **désactivées par défaut** et nécessitent des variables d'environnement explicites.
- Un brouillon doit être vérifié par Google Ads via `validateOnly`, puis la campagne peut être créée **en pause** après confirmation explicite.
- L'activation réelle nécessite la configuration technique autorisée, un abonnement actif, des conversions validées et une confirmation explicite.
- La notion d'« économies réalisées » n'est pas affirmée sur la base de mots-clés exclus : l'application montre les coûts historiques et des suggestions, avec une estimation prudente.
- Aucune annonce sponsorisée Google Maps n'est garantie : l'association d'une fiche ne crée pas automatiquement un affichage sponsorisé.
- Le budget journalier est un budget **moyen** pour les campagnes concernées ; Google peut dépenser plus certains jours. La demande accrue n'est mentionnée que si des signaux mesurés le justifient.

## Priorités bloquantes avant ouverture aux clients

1. Configurer et tester les API externes avec des comptes pilotes autorisés.
2. Mettre en place la validation d'emails, la récupération de mot de passe, les limites de connexion distribuées et l'observabilité.
3. Vérifier les conversions de téléphone et de formulaire sur chaque compte et définir la qualité des leads.
4. Tester Google Ads `validateOnly`, campagnes PAUSED, assets GBP et règles de facturation sur des comptes tests.
5. Ajouter un vrai moteur d'optimisation contrôlé avec historique, rollback et alertes critiques.
6. Déployer en région UE si la stratégie de traitement de données et le RGPD l'exigent, puis vérifier sauvegardes / confidentialité / DPA.
7. Effectuer tests de charge, migrations, sauvegardes, tests de reprise et un audit sécurité avant 1 000 clients.

**Ce dépôt ne contient aucun identifiant secret.** Définir les secrets dans Railway Variables, jamais dans les fichiers, issues GitHub ou le chat.
