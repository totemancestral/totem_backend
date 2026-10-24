# Langue des livraisons

La langue de la commande (`locale`, `fr` ou `en`) suit la génération du récit,
des PDF, du certificat, de la narration et des emails de livraison. La langue
du PDF est également inscrite dans sa métadonnée `/Lang`.

Les modèles `email_templates` sont recherchés par clé et par langue. Si le
modèle anglais manque ou ne peut pas être chargé, le modèle intégré anglais
est utilisé : le backend ne reprend plus le modèle français. Les modèles
enregistrés doivent eux-mêmes contenir un HTML et un sujet dans la bonne langue.
Leur contenu dans la base de production n'a pas été modifié ni vérifié par ce lot.

L'email Junior utilise le résultat dans la langue de la commande, y compris le
nom descriptif, la qualité, la phrase et le partage. Les scores, identifiants
de totem et numéros déterministes restent identiques dans les deux langues.

Les fichiers et résultats déjà enregistrés gardent leur langue d'origine.
Ce changement ne les régénère pas et ne renvoie aucun ancien email.
Les alertes techniques de pipeline destinées à l'équipe restent en français.

Les liens de livraison restent valides 30 jours ; les liens renouvelés après
authentification dans l'espace personnel restent valides une heure. Ce lot
ne change aucune de ces durées.

Les tests `delivery-language.spec.ts` génèrent localement des PDF/certificats et
capturent les requêtes d'email et de narration avec des services simulés.
`worker-reliability.spec.ts` vérifie la transmission de la langue aux générateurs.
Aucun email réel, appel d'IA payant ou changement de données de production n'est
effectué par ces tests.

Les emails Supabase Auth sont configurés séparément : voir
`../projet-totem-ancestral/docs/emails/README.md` dans l'espace de développement.
