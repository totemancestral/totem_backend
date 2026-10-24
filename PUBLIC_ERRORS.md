# Erreurs HTTP publiques

`PublicErrorFilter`, enregistré comme `APP_FILTER` dans `AppModule`, traite
les exceptions HTTP de l’application NestJS. Les appels directs aux méthodes
de service dans les tests unitaires ne passent pas par un filtre HTTP.

La réponse conserve le statut HTTP et expose uniquement : `statusCode`, `code`,
`message` (le même code pour compatibilité), `requestId` et, sur 429/503 seulement,
un `retryAfter` entier valide lorsqu’il existe. Le détail de validation, la pile
et les réponses arbitraires des prestataires ne sont pas copiés dans le corps.
L’en-tête `Retry-After` déjà posé par le limiteur reste conservé.

Seuls les codes explicitement recensés dans `PUBLIC_CODES` sont repris.
Une nouvelle exception ne doit pas être rendue publique sur la seule base
de sa forme : un message technique peut aussi ressembler à un code.
Les codes inconnus utilisent un code générique dépendant du statut. Une erreur
Zod non enveloppée produit une requête invalide 400, sans réflexion des entrées.

L’identifiant de suivi est créé côté serveur et partagé entre réponse et log.
Les diagnostics contiennent le code, le statut, la classe de l’exception et des
emplacements de pile. Les lignes de message, corps, en-têtes, valeurs d’entrée et
payloads d’exception arbitraires ne sont pas journalisés par ce filtre. Les détails
de pipeline persistés pour l’équipe restent dans leur circuit existant ; cette
protection HTTP ne définit pas leur durée de conservation ni tous les autres logs.

L’authentification distingue un refus explicite de jeton (401 `auth_failed`)
d’une panne de vérification (503 `authentication_unavailable`). Le rôle et le
contrôle MFA restent obligatoires. L’échec de génération d’une commande expose
`generation_failed`, pas le message du prestataire enregistré en base.

Le relais Next de statut de commande filtre aussi les réponses d’un ancien
backend : il ne reprend pas les détails d’erreur HTTP, retire les champs non
prévus et remplace le message de génération par le code public. L’inscription
ne renvoie plus un message Auth inconnu ; le signalement volontaire des comptes
existants reste inchangé. Les interfaces utilisent leurs messages FR/EN existants.

Tests : `test/public-errors.spec.ts`, `test/admin-mfa.spec.ts`, et côté frontend
`test/public-order-errors.spec.ts` / `test/signup-existing-account.spec.ts`.
Ces tests emploient des services simulés, sans compte ni données de production.

Ce lot ne clôture pas la stratégie globale de journaux, rétention, supervision
et alertes. Ne pas interpréter la présence d’un requestId comme un système de
traçage distribué déjà déployé.
