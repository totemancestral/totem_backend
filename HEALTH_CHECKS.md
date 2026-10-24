# Disponibilité du backend

`GET /health/live` indique que le processus HTTP répond. Il ne contacte aucun
prestataire. `GET /health/ready` vérifie Redis par PING, la lecture des tables
TotemOrder, TotemPipelineError et ConsultationReading, et le démarrage local
du worker. Une dépendance refusée produit un 503 générique sans détails privés.

Redis utilise un signal d'abandon de 3 secondes. Les lectures PostgreSQL sont
regroupées dans une transaction sans écriture, avec maxWait 1 seconde et timeout
4 secondes. Le délai de connexion initial dépend aussi de la configuration
Prisma/PostgreSQL : ces valeurs ne constituent pas une borne absolue réseau.

Le contrôle du worker atteste son cycle de vie local, pas la réussite d'une
génération ni une preuve de progression de chaque tâche. Un worker occupé
reste disponible. Les heartbeats et les leases de tâches restent indépendants.
La validité de toutes les colonnes/migrations, les droits SQL et la disponibilité
des prestataires IA, Stripe ou emails ne sont pas certifiés par ces sondes.

Aucun changement de health check Render n'est effectué automatiquement.
Éviter de transformer une panne Redis temporaire en redémarrages en boucle :
choisir explicitement entre liveness et readiness selon le rôle de la sonde.
