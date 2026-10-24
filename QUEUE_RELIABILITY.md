# Génération et reprise des tâches

La réservation de génération est enregistrée dans `TotemOrder.queuedAt` en même
temps que les réponses définitives, avec un `updateMany` conditionnel. Les
soumissions concurrentes et les notifications Stripe ne peuvent donc plus
réécrire les réponses déjà réservées. La file Redis élimine également les
doublons à l'ajout et à la prise en charge.

## Pannes et reprise

- Le worker recherche toutes les 30 secondes les commandes adultes `pending`
  avec une intention de génération persistée, par lots de 100. Il peut ainsi
  réparer un arrêt entre l'écriture PostgreSQL et l'appel Redis.
- La réservation Redis appartient à un jeton aléatoire. Elle est renouvelée
  toutes les 30 secondes. Seul ce jeton permet de retirer ou remettre la tâche
  en attente.
- Les tâches sans renouvellement depuis 20 minutes sont remises en attente
  atomiquement. Un redémarrage ne reprend plus immédiatement les tâches actives.
- Les écritures du pipeline vérifient aussi le statut et `processingAt` de la
  réservation en base. Une ancienne exécution ne peut pas remplacer le résultat
  d'une nouvelle réservation.
- Une erreur de persistance ou de remise en file ne provoque plus un acquittement
  dans un `finally`. La tâche reste récupérable.
- Une tentative est comptée à sa prise en charge, une seule fois. Après trois
  tentatives, la commande passe en erreur. La relance administrateur ne remet pas
  à zéro une génération active.
- Si l'œuvre est déjà produite, une reprise republie les fichiers enregistrés et
  poursuit la livraison ; elle ne relance pas la génération IA.
- Le traitement Junior, qui ne passe pas par la file adulte, réserve également
  sa génération par une écriture conditionnelle. Les appels simultanés ne
  produisent plus chacun leur image et leur enregistrement de totem.

## Déploiement et limites

Aucune migration SQL n'est nécessaire. Les clés Redis existantes sont conservées,
avec une nouvelle table de jetons `:owners`.

Pour le premier déploiement de ce protocole, arrêter les anciennes instances et
laisser leurs générations finir avant de démarrer les nouvelles. Ne pas mélanger
des workers de l'ancienne et de la nouvelle version : les anciens n'appliquent
pas les nouveaux contrôles de réservation.

Les tests couvrent les soumissions concurrentes, les reprises, les pertes de
réservation et les erreurs simulées de base/Redis. Le transport Upstash est simulé
dans les tests unitaires ; les scripts Lua doivent aussi être validés sur une
instance Redis de préproduction avant le déploiement. Aucune file de production
n'a été modifiée pendant ces vérifications.

Le fichier `test/queue-redis.integration.spec.ts` couvre ces scripts sur de vraies
clés isolées, supprimées à la fin des tests. Il est ignoré par défaut. Pour
l'activer, renseigner `TOTEM_TEST_REDIS_REST_URL` et
`TOTEM_TEST_REDIS_REST_TOKEN` avec les identifiants de préproduction puis lancer
`npm test -- test/queue-redis.integration.spec.ts`.

Ce mécanisme assure une livraison des tâches avec reprise, pas une transaction
unique entre PostgreSQL, Redis, le stockage et les fournisseurs IA/email. Après
une interruption réseau ou un crash, un appel externe déjà commencé peut devoir
être répété. Il ne garantit donc pas une facturation IA ou un email « exactement
une fois ».
