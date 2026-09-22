# Droly — génération vidéo via Supabase Edge Functions

Alternative à `../api/` (qui se déploie sur Render) : héberger le même petit
serveur de connexion à Runway sur **Supabase** à la place. Choisis-en un
seul — les deux font exactement la même chose, juste sur un hébergeur
différent.

Tout se fait ici **depuis le dashboard Supabase, dans le navigateur, sans
terminal**.

## 1. Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com), crée un compte (tu peux te
   connecter avec GitHub).
2. Crée un nouveau projet (choisis un nom, un mot de passe de base de
   données — on ne s'en sert pas ici, mais Supabase le demande — et une
   région proche de tes visiteurs).

## 2. Créer la fonction

1. Dans le menu de gauche du projet, clique **Edge Functions**.
2. Clique **Deploy a new function** → **Via Editor**.
3. Nomme-la exactement **`generate`** (important : ce nom se retrouve dans
   l'adresse finale de la fonction).
4. Efface le code d'exemple et colle à la place tout le contenu du fichier
   [`functions/generate/index.ts`](functions/generate/index.ts) de ce
   dossier.
5. Clique **Deploy function**. Ça prend 10 à 30 secondes.

## 3. Ajouter ta clé Runway (secret)

1. Toujours dans **Edge Functions**, cherche la section **Secrets** (ou
   **Manage secrets**).
2. Ajoute une entrée : clé `RUNWAYML_API_SECRET`, valeur = ta vraie clé
   Runway (récupérée sur [dev.runwayml.com](https://dev.runwayml.com/login)).
3. Enregistre. Pas besoin de redéployer la fonction, le secret est pris en
   compte immédiatement.

## 4. Récupérer les deux informations à copier dans le site

1. **L'adresse de la fonction** : elle a toujours cette forme —
   ```
   https://TON-PROJET.supabase.co/functions/v1/generate
   ```
   (remplace `TON-PROJET` par la référence de ton projet, visible dans
   l'URL du dashboard ou dans Settings → General).
2. **La clé "anon" / "publishable"** : Settings → API Keys, copie la clé
   `anon` (ou `publishable`) — c'est une clé publique, normal qu'elle soit
   visible, elle ne donne accès à rien de sensible ici.

## 5. Brancher tout ça sur le site

Sur GitHub, ouvre `index.html` à la racine du repo, clique l'icône crayon
pour l'éditer, cherche (Ctrl+F / Cmd+F) `DROLY_API_BASE` puis
`DROLY_API_KEY`, et remplace :

```js
var DROLY_API_BASE = 'https://TON-PROJET.supabase.co/functions/v1/generate';
var DROLY_API_KEY = 'colle-ta-cle-anon-ici';
```

Enregistre ("Commit changes" directement sur `main`). À partir de là,
coller une vraie image dans le champ du site déclenche une vraie
génération Runway au lieu de la démo simulée.

## À savoir

- Déployer une fonction "Via Editor" (comme ci-dessus) ne garde pas
  d'historique des versions — très bien pour démarrer, mais si tu modifies
  souvent le code plus tard, l'outil en ligne de commande Supabase (CLI)
  fait la même chose avec un vrai suivi de version.
- `imageUrl` doit être un lien DIRECT vers une image (`.jpg`, `.png`…), pas
  une page d'annonce Airbnb/Leboncoin — même limite que pour la version
  Render, voir `../api/README.md` pour le détail.
- Si tu préfères, donne-moi l'adresse de ta fonction et ta clé "anon" une
  fois en place, et je peux préparer directement le fichier `index.html`
  avec les deux lignes déjà remplies.
