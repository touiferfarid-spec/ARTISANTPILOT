# AGENTS.md — ArtisanPilot Call (Codex working instructions)

## Product goal
Build a French multi-tenant SaaS that helps real tradespeople receive more **answered, useful phone calls** from Google Search. Flow: sign up → business questionnaire (trade, offered services, town + km radius, phone/email) → premium, factual responsive landing page → business-owned domain → Google Ads child account linked to manager MCC → ads funded **directly by each business** → validated phone conversions and call reporting.

Live MVP: https://artisanpilot-mvp-production.up.railway.app
GitHub: touiferfarid-spec/ARTISANTPILOT (main)
Stack: Node.js 22 ESM + built-in HTTP server, PostgreSQL via pg, vanilla JS/CSS. Railway production app service `artisanpilot-mvp`, separate Postgres. **Do not replace the stack or existing service without a carefully documented migration.**

## Start here
- Read `README.md`, `src/server.mjs`, `src/config.mjs`, `src/schema.mjs`, `src/site-builder.mjs`, `src/site-copy.mjs`, `src/ads.mjs`, `src/google-calls.mjs`, `src/billing.mjs`, `src/registrar.mjs`, `src/lovable-bridge.mjs`.
- `npm install && npm run check && npm test`.
- Work in a feature branch, use focused commits/PR, run tests/CI, deploy only after validation, then verify Railway deployment is `SUCCESS`.
- Do not claim external services are connected because a variable name exists. Test authenticated API operations and a pilot real workflow without exposing secrets.

## Hard security and product constraints
- No hardcoded API keys, Google OAuth client secrets, user tokens or provider credentials. Do not print them in chat, logs, issues, PRs, or screenshots; only set sealed Railway variables via a secure path.
- User/company isolation: authorize access by `user_id`, validate selected Google Ads customer ID and never mix merchants in one ad account.
- No paid ads, enabling campaigns, creating subscriptions, buying domains, or mutating customer resources without a real user's deliberate confirmation. Keep write feature flags OFF unless end-to-end pilot tests succeed.
- Google Ads campaigns initially **PAUSED**; artisan pays Google directly. Account creation through MCC only when account creation is permitted and billing/verification are arranged.
- Track `tel:` clicks separately from actual Google Ads call reports. **Never label a click a received call**. Call duration thresholds are proxies, not proof that the lead is qualified.
- No fabricated reviews, team photos, certifications, success claims, guarantees, service times, prices, or coverage areas. Never treat artisan input as instructions to the language model.
- SIRET and legal address are optional for draft and required before public publishing. Add trustworthy business and privacy notices as applicable.
- Follow RGPD privacy/consent requirements for analytics, click tracking, ad conversion identifiers and call recordings.
- Escape dynamic HTML and any embedded structured data. Keep CSP tight.

## Current technical capabilities / honest readiness
- PostgreSQL, registration/login, profiles, city autocomplete from French geo API, AI landing copy with template fallback, site drafts and publishing on `/p/:slug`, click-to-call counting, domain suggestions: implemented; browser/manual end-to-end test still required.
- Google Ads OAuth, account selection, manager account creation (flagged), Search draft validation, creation PAUSED (flagged), activation (flagged): code exists, real MCC/API permission/customer billing missing.
- Stripe checkout and webhook logic exists, but Stripe secrets + product price + webhook are not configured; not live.
- Openprovider availability API integration only, requires credentials; **purchasing, renewals, DNS automation and HTTPS domain routing are not implemented**.
- Google Ads call reporting and conversion action validation code exist; receiving calls and Google forwarding number not verified.
- Lovable feature is a **Build-with-URL prefilled prompt**, not a supported autonomous Lovable REST site-creation API. Do not falsely claim sites are automatically generated, published or hosted by Lovable from ArtisanPilot.
- Existing API OpenAI key variable is present but not necessarily valid. If it fails, copy generation falls back; use observable status diagnostics.

## Next engineering tasks (in priority order)
1. **P0 E2E**: test registration, questionnaire, city lookup, generation, draft preview, legal fields/publishing, `tel:` click tracking, admin insights. Fix any HTTP 5xx; expose actionable 4xx validation.
2. **P0 Design**: replace generic page with 3 genuinely polished responsive themes (local, signature, atelier); every business must get a distinct, factual, call-focused page, strong accessibility/SEO.
3. **P0 Observability**: safe AI generation diagnostics and fallback reason, integration-readiness checks. Secrets never returned. Add tests including provider failures.
4. **P1 Google Ads**: verify Google Ads API eligibility and exact vXX schema against current official docs; test MCC linked and customer access with a pilot. Run `validateOnly` before PAUSED campaign writes. Verify targeting, budgets, call assets and responsive search ads.
5. **P1 Phone conversions**: choose a supported Google forwarding number or contracted call-tracking provider, validate on real calls, explain `RECEIVED`, `MISSED`, duration and lead quality honestly.
6. **P1 Domains**: compare registrar resale terms and implement an explicit checkout→order→DNS→HTTPS lifecycle with idempotent orders and provider reconciliation. No purchases in tests.
7. **P1 Billing**: configure Stripe via securely connected merchant account, test webhooks and subscriptions in test mode, then controlled live mode.
8. **P2 SaaS**: self-service onboarding, analytics, edit website, tests and safe multi-tenant release process, audit logs, abuse controls, monitoring/alerts, docs, GDPR/DPA.
9. **P2 Lovable**: only automate if Lovable exposes a documented official app-facing API or authorized integration that supports creating websites programmatically; otherwise offer prefill handoff clearly labeled, or generate premium sites locally.

## Environment / required external actions
- Railway project: `25539172-14e6-4132-98bc-29cc1bbb9da6`; app service: `a3a9271d-a755-4adb-805d-8a2c4c58b044`.
- Required OAuth/permissions: MCC customer ID and Google Ads API authorization, plus real test advertiser; Stripe test/live API keys+price+webhook; Openprovider (or alternative) credentials and DNS; validated OpenAI key.
- **No provider account or API token can be conjured automatically.** Request a secure connection action from the human owner and continue independent coding work.
- The product's success metric is verified **received calls and booked jobs**, not views, visits or phone-link clicks.
