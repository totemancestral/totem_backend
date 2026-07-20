# TOTEM Orchestrator - Backend NestJS

Backend de production de TOTEM Ancestral. Il gere Stripe, la queue BullMQ, la generation IA, le stockage Supabase Storage, la livraison email et le miroir des resultats vers les tables Supabase consommees par le frontend Next.js.

## Stack

- NestJS 11, TypeScript, Express.
- Prisma 6 sur Postgres Supabase.
- BullMQ + Redis/Upstash pour la queue de generation.
- Stripe Checkout + webhooks.
- Anthropic pour la generation editoriale.
- OpenAI Images et TTS pour les visuels et l'audio.
- pdf-lib pour le parchemin PDF multi-page.
- Supabase Storage pour les artefacts prives.
- Resend pour les emails de livraison et alertes.

## Responsabilites

- Verifier les webhooks Stripe.
- Creer des sessions Stripe Checkout depuis un JWT Supabase utilisateur.
- Creer ou mettre a jour les commandes backend de facon idempotente.
- Executer le pipeline asynchrone texte -> image couverture -> image recit -> audio long -> PDF -> upload -> email.
- Stocker les livrables dans le bucket Supabase prive `totem-deliveries`.
- Generer des URLs signees via `GET /totem-assets/:token`.
- Miroir les commandes et oeuvres dans Supabase pour le frontend.

## Structure

```text
src/main.ts                         Bootstrap Nest
src/app.module.ts                   Config globale + BullMQ Redis
src/config/env.schema.ts            Validation des variables d'environnement
src/health.controller.ts            Healthchecks Render
src/prisma/                         PrismaService et module
src/totem/checkout.*                Creation Stripe Checkout
src/totem/stripe-webhook.*          Verification et traitement webhooks Stripe
src/totem/totem.worker.ts           Worker BullMQ du pipeline de generation
src/totem/totem-ai.service.ts       Anthropic, OpenAI image/TTS, PDF
src/totem/supabase-storage.service.ts Stockage et signature des artefacts
src/totem/supabase-mirror.service.ts  Miroir vers tables Supabase frontend
src/totem/resend-mailer.service.ts  Emails livraison/alertes
prisma/schema.prisma                Modele backend TotemOrder
render.yaml                         Blueprint Render
Dockerfile                          Image de production
```

## Installation locale

Prerequis: Node.js 20+, npm, Postgres/Supabase, Redis, cles Anthropic/OpenAI.

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run typecheck
npm run build
npm run start
```

En local le service peut tourner sur `PORT=3001` si le frontend utilise `http://localhost:3000`.

## Scripts

```bash
npm run prisma:generate  # genere Prisma Client
npm run prisma:migrate   # applique les migrations Prisma
npm run typecheck        # verification TypeScript sans emission
npm run build            # compile dans dist/
npm run start            # lance dist/main.js
npm run start:dev        # build puis node --watch
```

## Variables d'environnement

Voir `.env.example` pour la liste complete. Les valeurs sensibles ne doivent jamais etre commitees.

Variables critiques:

```env
PUBLIC_ASSET_BASE_URL=
CORS_ORIGIN=
DATABASE_URL=
REDIS_URL=
TOTEM_WORKER_CONCURRENCY=2
TOTEM_STORY_PAGE_COUNT=20
TOTEM_IMAGE_GENERATION_CONCURRENCY=2
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-4-6
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=onyx
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=totem-deliveries
DELIVERY_SIGNING_SECRET=
RESEND_API_KEY=
RESEND_SENDER_EMAIL=livraison@example.com
RESEND_SENDER_NAME=TOTEM ANCESTRAL
ALERT_EMAIL=tech@example.com
```

Notes:

- `PUBLIC_ASSET_BASE_URL` doit etre l'URL publique du backend, sans slash final.
- `DATABASE_URL` doit utiliser le pooler Supabase IPv4 en production si l'hebergeur ne supporte pas IPv6.
- `REDIS_URL` doit utiliser `rediss://` avec Upstash TLS.
- `TOTEM_WORKER_CONCURRENCY` reste bas car une commande genere deux images IA et un audio long.
- `OPENAI_IMAGE_MODEL` est `gpt-image-2` pour les visuels sculpture/artefact.

## Pipeline de generation

Le pipeline est lance par un job BullMQ dans `TotemWorker`.

1. Lire la commande `TotemOrder`.
2. Marquer la commande `processing` et miroir Supabase `en_generation`.
3. Generer le payload texte via Anthropic.
4. Le payload contient:
   - `archetypeId`
   - `ancestralName`
   - `parchmentText`
   - `audioMessage`
   - `imagePrompt`
   - `storyPages[]` avec les sections du long recit.
5. Generer l'image de couverture.
6. Generer une seule image principale du recit, apres la couverture.
7. Generer un audio long a partir du prologue et des pages.
8. Generer le PDF parchemin: couverture avec la premiere image, page de recit avec la seconde image, puis texte long continu sur autant de pages que necessaire.
9. Uploader image, audio et PDF dans Supabase Storage.
10. Mettre a jour `TotemOrder`, miroir `oeuvres`/`oeuvre_versions`, puis envoyer l'email.

## Style visuel des images

Les deux images sont forcees cote backend avec un prompt de style commun. Le totem doit apparaitre comme une sculpture/artefact rituel premium:

- animal totem reconnaissable et stable sur toutes les pages;
- matieres noir ebene/obsidienne, metal sombre, bronze vieilli, incrustations or;
- gravures geometriques ancestrales, relief sculpte, profondeur visible;
- cadrage centre, lumiere dramatique, fond bleu-noir, poussiere doree subtile;
- aucun texte, logo, watermark, visage humain ou objet moderne.

Chaque page conserve son univers narratif propre, mais le meme animal totem reste identifiable.

## Endpoints

- `POST /checkout`: cree une session Stripe Checkout.
- `POST /webhooks/stripe`: traite les webhooks Stripe.
- `GET /totem-assets/:token`: sert un artefact prive signe en telechargement.
- `GET /health/live`: healthcheck simple.
- `GET /health/ready`: healthcheck de disponibilite.

## Base de donnees backend

Prisma gere deux tables backend principales:

- `TotemOrder`: commande payee et etat du pipeline.
- `TotemPipelineError`: erreurs historisees par commande.

Le frontend lit principalement les tables Supabase applicatives (`commandes`, `oeuvres`, `oeuvre_versions`). Le service `SupabaseMirrorService` synchronise les donnees backend vers ces tables.

## Stockage

Le bucket Supabase `totem-deliveries` doit etre prive. Les fichiers sont ranges sous:

```text
orders/{totemOrderId}/image-{timestamp}.png
orders/{totemOrderId}/audio-{timestamp}.mp3
orders/{totemOrderId}/pdf-{timestamp}.pdf
```

Les URLs publiques en base sont des liens signes par le backend, pas des URLs publiques Supabase.

## Stripe

Configurer le webhook Stripe vers:

```text
https://<backend-host>/webhooks/stripe
```

Evenements utiles:

- `checkout.session.completed`
- `payment_intent.succeeded` pour compatibilite.

Le webhook doit utiliser le secret `STRIPE_WEBHOOK_SECRET` du meme environnement que `STRIPE_SECRET_KEY`.

## Deploiement Render

Le depot contient `render.yaml`.

1. Creer un Web Service Docker depuis le repo backend.
2. Renseigner toutes les variables marquees `sync: false`.
3. Mettre `PUBLIC_ASSET_BASE_URL` sur l'URL publique Render.
4. Mettre `CORS_ORIGIN` sur l'URL Vercel du frontend.
5. Executer `npm run prisma:migrate` contre la base Supabase si necessaire.
6. Configurer le webhook Stripe.

Render doit avoir ces valeurs pour la generation longue:

```env
TOTEM_WORKER_CONCURRENCY=2
TOTEM_STORY_PAGE_COUNT=20
TOTEM_IMAGE_GENERATION_CONCURRENCY=2
OPENAI_IMAGE_MODEL=gpt-image-2
```

## Verification avant push/deploiement

```bash
npm run typecheck
npm run build
```

Pour tester uniquement le rendu PDF sans appels IA, utiliser un script Node qui instancie `TotemAiService` avec un payload factice et appelle `generatePdf`.

## Documentation transverse

Voir `../docs/architecture.md` pour le schema d'ensemble front/back/Supabase/Stripe/Redis.
