# Renouvellement des liens privés

Les fichiers restent dans le bucket privé existant. Lors d'une consultation,
`POST /orders/asset-links` reçoit au maximum 100 identifiants de session Stripe,
authentifie le jeton Supabase et sélectionne uniquement les commandes terminées
de cet utilisateur. Aucune clé de fichier transmise par le client n'est acceptée.

Le serveur génère des URL signées valables une heure pour l'image, l'audio, le PDF
et le certificat, depuis les clés enregistrées en base. Une clé doit appartenir
au préfixe `orders/<id de cette commande>/`.

Pour les anciens enregistrements sans clé séparée, le serveur peut retrouver la
clé dans l'ancienne URL, même expirée, mais seulement après validation de sa
signature et du préfixe de commande. Un fichier absent ou une URL non authentique
ne peuvent pas être réparés par ce renouvellement.

Le frontend renouvelle les liens à l'ouverture des œuvres et de la liste des
commandes. Il les rafraîchit après 45 minutes et au retour dans un onglet ancien.
Les réponses contenant les liens sont privées et ne doivent pas être mises en
cache. Une panne du service ne réutilise pas silencieusement les anciennes URL.

Les images Junior sont également renouvelées lors de leur consultation. Les
liens envoyés par email gardent leur durée actuelle de 30 jours ; une fois ceux-ci
expirés, les fichiers restent consultables depuis l'espace personnel.

## Mise en ligne

Déployer d'abord le backend, puis le frontend : le nouveau frontend utilise la
route de renouvellement. Aucune migration SQL ni nouvelle variable d'environnement
n'est nécessaire. Les clés de signature restent exclusivement côté backend.

Les tests simulent les données et le stockage : expiration après 30 jours,
renouvellement d'une heure, ancien lien signé, signature falsifiée, accès entre
utilisateurs, validation des lots et panne du service. Aucune œuvre réelle n'a
été modifiée ou régénérée pour ces vérifications.
