# TOTEM Orchestrator

Backend NestJS pour le paiement Stripe et l'orchestration du coffret digital TOTEM ANCESTRAL.

## Responsabilites

- Reception et verification des webhooks Stripe.
- Creation des sessions Stripe Checkout depuis un JWT Supabase utilisateur.
- Creation idempotente des commandes apres paiement.
- Orchestration asynchrone du pipeline texte -> image -> audio -> PDF via BullMQ/Redis.
- Persistance des commandes dans Postgres via Prisma. En production, `DATABASE_URL` doit pointer vers Supabase Postgres.
- Stockage des artefacts dans Supabase Storage.
- Livraison email via Resend.
- Exposition des liens de telechargement signes pendant 30 jours via `GET /totem-assets/:token`.

Supabase reste responsable de la base de donnees, de l'authentification utilisateur et du stockage. Ce service backend reste responsable de Stripe, de la queue et du pipeline de generation.

## Commandes

```bash
npm install
npm run prisma:generate
npm run typecheck
npm run build
```

## Base de donnees

```bash
npm run prisma:migrate
```

## Demarrage

```bash
npm run start
```

## Deploiement backend

Le service peut etre deploye tel quel avec `TOTEM/Dockerfile`. Avant le premier
demarrage en production, executer les migrations Prisma contre la base Supabase:

```bash
npm run prisma:migrate
```

Variables a renseigner dans l'hebergeur: voir `TOTEM/.env.example` et
`../docs/env.md`. Le frontend Next doit ensuite recevoir l'URL publique du
backend dans `TOTEM_BACKEND_URL`.

### Render

Le depot contient `render.yaml` pour creer un Web Service Docker depuis Render.

1. Render > New > Blueprint ou New > Web Service.
2. Choisir le depot `REBCDR07/totem_backend`.
3. Renseigner les variables marquees `sync: false` dans le dashboard Render.
4. Mettre `PUBLIC_ASSET_BASE_URL` sur l'URL publique Render du backend.
5. Mettre `CORS_ORIGIN` sur l'URL publique du frontend Next.
6. Utiliser Upstash Redis pour `REDIS_URL` si Render ne fournit pas Redis dans le plan choisi.
7. Apres le premier deploy, creer le webhook Stripe vers `/webhooks/stripe`.

## Endpoints

- `POST /checkout`
- `POST /webhooks/stripe`
- `GET /totem-assets/:token`
- `GET /health/live`
- `GET /health/ready`

## Variables de production

Voir `.env.example`. Sur Railway ou Render, il faut configurer Supabase, Redis,
Anthropic, OpenAI et Resend. Stripe peut etre ajoute ensuite, mais les endpoints
checkout et webhook resteront indisponibles tant que ses cles ne sont pas renseignees.

Le webhook Stripe doit etre configure avec le secret `STRIPE_WEBHOOK_SECRET`. L'evenement principal est `checkout.session.completed`; `payment_intent.succeeded` est tolere pour compatibilite, mais le flux Checkout repose sur la session Stripe.
