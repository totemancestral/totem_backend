# Limites des routes interactives

Un intercepteur global applique des limites par compte Supabase vérifié et par
action, sur toutes les instances. Il utilise les identifiants Redis REST existants
UPSTASH_REDIS_URL / UPSTASH_REDIS_TOKEN (HTTPS obligatoire), sans migration SQL.
Les clés `totem:rate-limit:backend:v1:` sont distinctes de la file de génération
et des compteurs du frontend. L'identifiant de compte est pseudonymisé par HMAC.

Fenêtre de 60 secondes, à partir de la première requête :

| Action | Requêtes par minute et par compte |
| --- | ---: |
| Paiement, finalisation, tirage, révélation junior, partage junior | 10 |
| Relance administrateur (MFA obligatoire) | 5 |
| Renouvellement des liens, historique, liste junior | 30 |
| Consultation de session et état des cauris | 60 |

INCR, expiration et lecture du TTL sont atomiques. Le dépassement produit 429,
Retry-After et retryAfter. Une panne/erreur Redis ou un délai dépassé (3 secondes)
produit 503 avec un délai de 30 secondes, sans lancer l'action métier.

Les contrôles d'authentification et de propriété des contrôleurs restent actifs ;
la vérification Supabase de l'intercepteur s'ajoute à celle du contrôleur/service.
Les webhooks Stripe, sondes de santé et téléchargements signés sont exclus de ces
quotas interactifs. La protection amont contre le trafic non authentifié reste
à configurer chez l'hébergeur et Supabase ; ce compteur par compte ne la remplace pas.

Tester les quotas sur un Redis de préproduction avant déploiement. Les tests
unitaires simulent le transport Redis et ne prouvent pas sa configuration réelle.
