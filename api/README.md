# Droly API (Vercel)

Une seule fonction (`generate.js`) qui fait le pont entre la page Droly et
l'API Runway pour générer une vraie vidéo à partir d'une photo. Elle est
faite pour tourner directement sur Vercel, **sur le même projet que le
site** (celui qui contient `index.html`) — pas besoin d'un hébergeur séparé.

## Pourquoi une fonction, et pas juste du code dans la page ?

`index.html` est un fichier public : n'importe qui peut voir son code
source. Si la clé secrète Runway y était écrite, n'importe qui pourrait la
copier et l'utiliser à tes frais. Cette fonction garde la clé cachée côté
serveur (variable d'environnement Vercel), et c'est elle qui parle à
Runway — la page ne fait que l'appeler.

```
Page Droly (navigateur)  →  api/generate.js (sur Vercel, garde la clé)  →  API Runway
```

## Comment ça marche sur Vercel

Vercel a une règle simple : tout fichier posé directement dans un dossier
`api/` à la racine du repo devient automatiquement une adresse du même
nom. Ce fichier (`api/generate.js`) devient donc `/api/generate` — rien à
configurer, rien à faire tourner en permanence, pas de `npm start`.

Le fichier `package.json` à la racine du repo (à côté de `index.html`,
pas dans `api/`) sert uniquement à dire à Vercel d'installer le SDK Runway
avant de déployer la fonction.

## 1. Récupérer une clé API Runway

1. Va sur https://dev.runwayml.com/login et crée un compte (ou connecte-toi).
2. Dans le tableau de bord, crée une clé API ("API key" / "Secret key").
3. Garde-la précieusement — c'est ce qui va dans `RUNWAYML_API_SECRET`.

Runway facture l'utilisation de l'API en crédits (pas d'abonnement Droly
là-dedans, c'est séparé) — regarde leur page de tarifs avant de tester en
volume.

**Important : `imageUrl` doit être un lien DIRECT vers une image**
(qui se termine par `.jpg`, `.png`…), pas un lien vers une page d'annonce
Airbnb ou Leboncoin. Pour avoir un lien direct : clic droit sur une photo
→ « Copier l'adresse de l'image ».

## 2. Ajouter la clé sur Vercel

1. Sur le tableau de bord Vercel, ouvre ton projet Droly.
2. **Settings** → **Environment Variables**.
3. Nom : `RUNWAYML_API_SECRET` — Valeur : ta clé Runway. Coche au moins
   **Production**, puis **Save**.
4. Cette étape ne redéploie pas automatiquement les déploiements déjà en
   ligne : le prochain push GitHub (par exemple celui qui ajoute ce
   fichier) déclenchera un nouveau déploiement qui, lui, verra la clé.

La génération prend en général 30 à 90 secondes — c'est normal. Les
fonctions Vercel (offre gratuite incluse) peuvent tourner jusqu'à 5
minutes, largement assez de marge.

## 3. Connecter la page Droly à cette fonction

Ouvre `index.html` (à la racine du repo), cherche (Ctrl+F / Cmd+F)
`DROLY_API_BASE` :

```js
var DROLY_API_BASE = '';
var DROLY_API_KEY = '';
```

Remplace par :

```js
var DROLY_API_BASE = '/api/generate';
var DROLY_API_KEY = '';
```

Comme le site et la fonction vivent maintenant sur le même projet Vercel,
un simple chemin relatif suffit — pas besoin de l'adresse complète.
`DROLY_API_KEY` ne sert que si tu héberges l'API ailleurs (Supabase, voir
`../supabase/README.md`) ; laisse-le vide ici.

Enregistre, commit sur GitHub. Vercel redéploie tout seul en quelques
secondes. À partir de là, coller une vraie image dans le champ déclenche
une vraie génération Runway au lieu de la démo simulée.

## Tester / voir les erreurs

Si une génération échoue, va dans le tableau de bord Vercel → ton projet
→ **Deployments** → le déploiement en cours → onglet **Functions** →
`generate` → **Logs**. C'est là que s'affichent les messages d'erreur
détaillés (clé manquante, réponse Runway inattendue, etc.).

## Alternative : héberger l'API ailleurs

Si tu préfères ne pas mettre l'API sur Vercel (par exemple pour la
séparer du site), le dossier `../supabase/` fait exactement la même
chose sur Supabase, avec ses propres instructions dans
`../supabase/README.md`.
