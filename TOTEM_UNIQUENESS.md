# Un Totem par compte

La règle est commune aux offres adulte, Famille et Junior. Le bénéficiaire est
identifié par l'identifiant Auth du compte, jamais par un nom ou une adresse email.
Cela ne détecte pas une personne qui crée plusieurs comptes. Les invitations
Famille ne sont pas implémentées par cette modification.

## Fonctionnement

- Le questionnaire vérifie l'éligibilité auprès du backend avant de commencer.
- Le paiement prend un verrou transactionnel PostgreSQL propre au compte.
  Une requête simultanée reçoit un conflit ; elle ne crée pas une autre session.
- Une session ouverte et impayée du même parcours et de la même offre est réutilisée.
  Pour changer de parcours/offre, l'ancienne session doit être expirée par Stripe.
- Un paiement confirmé, un Totem livré ou une génération interrompue bloquent un nouvel achat.
  La panne d'un prestataire ne constitue jamais une preuve d'abandon du paiement.
- `TotemIdentity` réserve définitivement la génération à une commande. Les triggers
  sur `TotemOrder` et `JuniorTotem` empêchent une seconde génération, même si un appel
  contourne l'interface. Une relance de la même commande conserve son droit.
- Le droit `TotemIdentity.juniorId` réserve atomiquement un seul nouvel
  enregistrement Junior. Les doublons historiques restent tous accessibles :
  aucune contrainte unique rétroactive n'est imposée à `JuniorTotem.userId`.

Les appels Stripe sont limités à 8 secondes sans relance automatique dans ce flux.
Le verrou utilise une transaction de 45 secondes maximum : c'est une section
critique de paiement, à surveiller si le trafic augmente. Les sessions devenues
impayables sont conservées avec `checkoutExpiredAt`, sans supprimer leur historique.
Si une nouvelle session Stripe a été créée puis que la transaction échoue, son
expiration est tentée. Un échec ambigu reste à réconcilier via Stripe ; aucune
erreur ne doit être interprétée comme la preuve d'une absence de débit.

## Activation

La migration a été appliquée le **26 octobre 2026** à la base configurée du
backend. Les empreintes avant/après des 19 commandes et 3 enregistrements Junior
sont identiques. Huit comptes sont protégés ; aucun ancien Totem n'a été supprimé
ou réécrit. Les deux triggers sont actifs et la table de contrôle est protégée
par RLS, sans accès `anon`/`authenticated`.

Preuve sans données personnelles :
`../audit-totem-2026-10-22/totem-uniqueness-activation-2026-10-26.json`.
Les nouveaux contrôles applicatifs et leurs messages nécessitent encore le
déploiement du backend et des frontends.

Pour une autre base :

1. Sauvegarder la base et examiner les doublons avec
   `prisma/security/20261025_totem_uniqueness_preflight.sql` (lecture seule).
2. Vérifier `npx prisma migrate status`. Si l'historique de migration est cohérent,
   appliquer les migrations avec `npx prisma migrate deploy`, puis générer le client
   avec `npx prisma generate`. Ne pas utiliser `db push`, `migrate reset` ou une
   suppression de données pour contourner un conflit.
3. Déployer le backend, puis les deux frontends. La migration doit précéder le
   nouveau code : l'absence de la table bloque les nouveaux parcours/paiements.

La migration est transactionnelle. Selon la décision du 26 octobre 2026, tous les
anciens Totems et achats sont conservés, y compris lorsqu'un compte en possède
plusieurs. Un seul enregistrement de contrôle marque ce compte comme déjà utilisé ;
il ne retire aucun accès aux anciens fichiers. Le renouvellement de leurs liens et
les compteurs de partage restent possibles. Une commande terminée ne peut pas être
repassée en génération. Aucun compte ni achat n'est supprimé, fusionné ou réécrit.

## Vérification locale

`npm test` couvre les conflits, sessions expirées, reprises et erreurs Stripe simulées.
`npm run typecheck` et `npm run build` vérifient la compilation.

Le script `scripts/check-totem-uniqueness.cjs` exécute la vraie migration dans des
bases PostgreSQL jetables via PGlite. Il ne charge jamais `.env` et ne contacte pas
Supabase. Installer `@electric-sql/pglite` dans un dossier d'outils séparé et définir
`PGLITE_MODULE` vers ce module, puis lancer `node scripts/check-totem-uniqueness.cjs`.

La création des types de compte adulte/Junior à l'inscription constitue un sujet
distinct : l'inscription actuelle ne persiste pas ce choix. L'unicité est donc
imposée à tous les parcours d'un même compte, quel que soit le parcours demandé.
