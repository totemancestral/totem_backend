# Permissions Supabase : migration explicite

`20261023_public_permissions.sql` prépare la correction de l'inventaire du
23 octobre. **Non appliqué à la base distante.** Ce dossier est séparé des
migrations Prisma automatiques car les tables miroir et politiques Supabase
ne sont pas créées par le schéma Prisma seul.

Le script transactionnel exige les 14 tables RLS et les droits CRUD existants
du service_role. Une erreur annule les changements. Il retire les droits de
table et de colonne aux rôles anon/authenticated/PUBLIC, puis conserve SELECT
authenticated sur les six tables à lecture personnelle. Les politiques de
lecture étendue admin exigent rôle admin ET AAL2. La lecture de son propre
rôle reste possible avant MFA. Les écritures du profil et du questionnaire
passent par les API serveur existantes, qui utilisent service_role.

Les droits serveur, données, triggers d'inscription, règles Storage et schémas
gérés Supabase ne sont pas modifiés. Un admin AAL1 conserve ses droits ordinaires
sur ses propres données mais ne peut plus lire celles d'autres personnes via
les politiques admin modifiées. Les politiques de propriété restent nécessaires.

Avant application : examiner les intégrations externes éventuelles qui
écriraient directement ces tables, sauvegarder le schéma/ACL/politiques avec
les outils de l'hébergeur et exécuter les tests SQL sur une base jetable.
Le script ne fournit pas de rollback qui rétablirait aveuglément les privilèges
excessifs. Utiliser le schéma sauvegardé si un retour précis est nécessaire.

Après application autorisée, relancer l'inventaire de métadonnées et contrôler
les parcours serveur, le profil, le questionnaire et l'enrôlement MFA.
Ne pas considérer la présence du fichier comme une protection déjà déployée.

Restent distincts : privilèges par défaut des futures tables et exposition de
la fonction has_role. Cette migration ne prétend pas clôturer ces deux sujets.

## Vérification locale effectuée

`verify-local.cjs` utilise PGlite (PostgreSQL embarqué) dans une base en mémoire
avec rôles, fonctions Auth simulées, politiques et données entièrement fictives.
Il ne charge pas de .env et ne peut pas se connecter à Supabase.

Commande : `node prisma/security/verify-local.cjs <chemin absolu du module @electric-sql/pglite>`.
Le module de vérification a été installé uniquement dans le dossier temporaire
de la machine, sans modifier les dépendances applicatives.

Résultat : **43 vérifications réussies**. Elles reproduisent la lecture admin
AAL1 avant correction, puis vérifient admin AAL1 limité à ses données, admin
AAL2 avec lecture étendue, utilisateur ordinaire AAL1/AAL2 limité à ses données,
lecture de son propre rôle avant MFA, refus des écritures directes, retrait de
TRUNCATE et droits de colonne, maintien des écritures service_role, répétition
du script et annulation atomique si une politique attendue manque.

Cette simulation n'est pas une preuve de déploiement Supabase ni une validation
de toutes les intégrations distantes. Les catalogues réels devront être relus
après une application autorisée.

## Deuxième script : futures tables et interrogation des rôles

`20261023_defaults_and_role_lookup.sql` s'applique explicitement après le
premier script. Il retire les privilèges par défaut des rôles publics sur les
futures tables et séquences créées dans public par postgres et supabase_admin.
Les droits par défaut service_role existants sont conservés. Toute nouvelle
table destinée au navigateur nécessitera un GRANT et une politique explicites.
Les autres propriétaires, schémas et privilèges par défaut de fonctions ne
sont pas modifiés. Les futures fonctions/RPC nécessitent toujours une revue.

has_role conserve sa signature et son statut SECURITY DEFINER pour les règles
RLS existantes, avec un search_path vide et des noms qualifiés. Il ne répond
vrai que pour l'identité Auth courante : interroger un autre UUID donne faux.
Le rôle n'est jamais lu depuis les métadonnées modifiables du compte.
L'exécution est refusée à anon/PUBLIC. Les politiques admin continuent
d'exiger AAL2 indépendamment de cette fonction. Le backend n'utilise pas cette
fonction pour interroger le rôle d'un tiers : il lit user_roles côté serveur.

Validation locale étendue : **59 vérifications réussies**, dont conservation
des lectures admin AAL2 et personnelles AAL1, impossibilité d'interroger le
rôle admin d'un tiers, refus de la fonction pour anon, et création effective
de tables/séquences fictives sous chacun des deux propriétaires pour vérifier
les privilèges obtenus. Aucune base distante touchée par ces tests.

### Correction après refus SQL Editor (42501)

La première version ciblait aussi supabase_admin, rôle géré par l'hébergeur.
SQL Editor a refusé de modifier ses privilèges par défaut. Le script corrigé
cible uniquement postgres : le périmètre précédent est remplacé par celui-ci.
Aucune élévation de droits nécessaire. Les nouveaux objets applicatifs doivent
être créés par postgres avec des droits explicites ; ceux créés par le rôle
géré restent un point de suivi. Les 59 vérifications locales repassent et
contrôlent désormais que les droits par défaut supabase_admin sont inchangés.
La relecture distante confirme les anciens defaults et l'ancienne définition
has_role après l'échec : aucune application partielle constatée.
