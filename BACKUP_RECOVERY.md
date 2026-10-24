# Sauvegarde et récupération — état du 23 octobre 2026

## Ce qui est établi

Le backend utilise PostgreSQL pour les commandes, réponses, états de génération
et tirages. Les artefacts image/audio/PDF sont téléversés dans Supabase Storage
par SupabaseStorageService. Le bucket de livraison inventorié est privé.
Le dépôt ne contient pas de procédure de sauvegarde/restauration ni de tâche
planifiée identifiée pour exporter ces données et fichiers.
Cela ne prouve pas l'absence de sauvegardes gérées par l'hébergeur.

L'offre Supabase, l'historique effectif des sauvegardes et une éventuelle
sauvegarde indépendante du Storage restent à confirmer. L'offre Render
n'indique pas le niveau de sauvegarde Supabase. Aucun export de données client,
aucune copie de fichiers privés ni restauration n'a été réalisé pendant cette revue.

## Différence essentielle

Une sauvegarde PostgreSQL conserve les données et métadonnées du Storage,
mais pas les octets des images/audios/PDF stockés via l'API Storage.
Restaurer seulement la base peut donc rétablir des références vers des fichiers
supprimés sans rétablir ces fichiers. Prévoir deux sauvegardes coordonnées.

La documentation Supabase indique des sauvegardes quotidiennes sur les offres
Pro/Team/Enterprise, avec accès aux sept derniers jours pour Pro. Le Free
nécessite de prévoir des exports réguliers et une copie hors site. Le PITR
est une option distincte ; ne pas le considérer actif sans preuve du tableau
de bord, ni l'activer comme option payante sans décision du propriétaire.

## Vérifications requises avant de déclarer ce point résolu

1. Dans Supabase, Database > Backups : relever les dates disponibles, la
   rétention et l'état PITR, sans lancer de restauration.
2. Confirmer l'offre réelle Supabase et que le projet correspond aux connexions
   utilisées par les applications déployées.
3. Identifier une sauvegarde séparée des objets Storage (destination, fréquence,
   historique/versionnement, accès et chiffrement). Ne pas rendre le bucket public.
4. Définir la perte acceptable de données et le délai acceptable de remise en
   service avant de fixer la fréquence des copies. Les sauvegardes quotidiennes
   peuvent laisser perdre les écritures effectuées depuis la dernière copie.
5. Préparer une restauration dans un environnement isolé : cohérence des
   utilisateurs/profils/commandes/réponses/tirages, droits SQL/RLS, objets liés
   aux clés d'artefacts, lecture des fichiers et renouvellement des liens.
6. Désactiver emails, paiements et worker dans cet environnement de restauration
   pour éviter les effets externes ; ne jamais tester une restauration sur la
   production pour simplement vérifier une procédure.

Les liens expirables ne sont pas des sauvegardes : conserver les objets et
leurs clés. Les secrets de configuration doivent pouvoir être récupérés par
un circuit sécurisé séparé, sans être ajoutés aux exports ou au dépôt Git.
Un redéploiement Render/Vercel ne restaure pas la base ni les fichiers.

## Références officielles consultées

- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/clone-project
- https://supabase.com/docs/guides/storage/management/download-objects

Statut : inventaire initial effectué ; configuration distante et restauration
non validées. Aucune automatisation de sauvegarde installée à ce stade.
