# Correctifs de sécurité — 22 octobre 2026

NestJS reste sur la branche 11 et Prisma sur la branche 6. Vitest passe de 3 à
4.1.12 ; sa configuration utilise désormais l'extension ESM `.mts`.

## Remplacement ciblé Prisma

`@prisma/config` 6.19.3 dépend de `deepmerge-ts` 7, concerné par
[GHSA-ggr8-5vv4-36mx](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx).
Le champ `overrides` du package impose `deepmerge-ts` 8.0.2 uniquement dans cette
dépendance. Il ne modifie pas le schéma ni la base de données.

La vérification TypeScript, la compilation, les tests et `npm run prisma:generate`
ont été exécutés avec ce remplacement. Lors d'une prochaine mise à jour Prisma,
réexaminer cet override et le retirer quand la dépendance amont sera corrigée.

Le nouvel audit npm complet ne signale aucune vulnérabilité connue dans le
verrouillage contrôlé. Ce résultat concerne les avis publiés à cette date et ne
constitue pas une garantie d'absence de faille.
