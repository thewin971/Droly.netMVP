# Base de données Supabase

`schema.sql` crée tout ce dont Droly a besoin, en une fois :

- **`subscriptions`** : l'abonnement de chaque client (statut, date de renouvellement…).
  Un client peut lire le sien, mais **seul le serveur** peut l'écrire : impossible de
  s'activer un abonnement sans payer.
- **`videos`** : la liste des vidéos de chaque client. Chacun ne voit et ne peut
  supprimer que les siennes.
- **stockage `videos`** (privé) : les fichiers vidéo, rangés dans un dossier par client.

## Installation

Supabase → **SQL Editor** → **New query** → colle tout le contenu de `schema.sql` → **Run**.

Le script peut être relancé sans risque : il ne recrée pas ce qui existe déjà.

Le reste des réglages Supabase (clés, adresses autorisées, emails) est décrit dans
`../SETUP.md`, étape 2.
