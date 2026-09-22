# Droly

MVP d'un service qui transforme les photos d'une annonce immobilière (Airbnb,
Leboncoin…) en vidéo de visite façon travelling drone. Concept d'exploration
inspiré de dronly.co, non affilié.

## Ce qu'il y a dans ce repo

```
droly/
├── index.html        ← le site (page d'accueil, essai, questionnaire, paiement démo)
├── package.json       ← utilisé par Vercel pour installer le SDK Runway de api/generate.js
├── videos/            ← les 5 vidéos de démonstration utilisées par le site
│   ├── hero.mp4
│   ├── salon.mp4
│   ├── cuisine.mp4
│   ├── piscine.mp4
│   └── drone.mp4
├── api/                ← fonction Vercel qui génère de VRAIES vidéos (API Runway)
│   ├── generate.js
│   └── README.md        ← instructions détaillées pour cette partie
└── supabase/            ← même chose, en alternative, à héberger sur Supabase
    ├── functions/generate/index.ts
    └── README.md         ← instructions détaillées pour cette partie
```

`api/` (Vercel) et `supabase/` font exactement la même chose (parler à
Runway pour générer la vidéo) sur deux hébergeurs différents — choisis-en
un seul, selon les instructions de son README. Si le site est déjà
déployé sur Vercel, `api/` est le plus simple : tout vit au même endroit,
un seul tableau de bord.

Le site (`index.html` + `videos/`) fonctionne seul, sans rien installer :
c'est du HTML/CSS/JS pur, aucune dépendance. Les vidéos sont de vrais
fichiers `.mp4` référencés en local (`videos/hero.mp4`, etc.) — pas de lien
externe qui peut casser.

## Voir le site en local avant de publier

Le plus fiable est de lancer un petit serveur local (les navigateurs sont
parfois capricieux avec les vidéos ouvertes en double-clic direct) :

```bash
cd droly
python3 -m http.server 8000
# puis ouvre http://localhost:8000 dans ton navigateur
```

(Ou n'importe quel autre serveur statique : `npx serve`, l'extension "Live
Server" de VS Code, etc. Double-cliquer sur `index.html` fonctionne aussi
dans la plupart des navigateurs.)

## Publier sur GitHub (avec les vidéos qui marchent)

1. Crée un nouveau repo sur GitHub (vide, sans README ni .gitignore générés
   automatiquement — ce dossier en a déjà, et il est déjà initialisé en Git
   avec un premier commit sur la branche `main`, prêt à pousser).
2. Dans ce dossier `droly/`, connecte-le à ton repo et pousse :
   ```bash
   git remote add origin https://github.com/TON-COMPTE/TON-REPO.git
   git push -u origin main
   ```
3. Une fois poussé, va dans **Settings → Pages** de ton repo GitHub.
4. Dans "Build and deployment" → Source, choisis **Deploy from a branch**,
   branche **main**, dossier **/ (root)**. Enregistre.
5. GitHub te donne une adresse du style
   `https://TON-COMPTE.github.io/TON-REPO/` — le site (et les vidéos) sont
   en ligne dessus après 1 à 2 minutes.

Comme les vidéos sont de vrais fichiers dans `videos/` (pas des liens
externes ni du texte encodé dans la page), elles se chargent normalement,
en streaming, comme n'importe quelle vidéo web — GitHub Pages les sert
sans problème.

## Mode démo vs mode réel

Par défaut, le bouton "Essayer" simule une génération (démo, pour montrer
le principe sans rien payer). Pour brancher la vraie génération de vidéo
(API Runway), choisis un des deux dossiers :

- **`api/`** (hébergé sur Render) — voir `api/README.md`, pas à pas complet.
- **`supabase/`** (hébergé sur Supabase, tout depuis le dashboard, sans
  terminal) — voir `supabase/README.md`, pas à pas complet.

Dans les deux cas, la dernière étape est la même : ouvrir `index.html` et
remplir `DROLY_API_BASE` (et `DROLY_API_KEY` pour la variante Supabase)
avec les valeurs données par l'hébergeur choisi (`/api/generate` pour
Vercel, une adresse complète pour Render/Supabase).

Sans cette étape, le site fonctionne quand même très bien en démo — rien
n'est cassé si tu ne déploies aucune des deux.

## Notes

- Aucune carte bancaire n'est réellement débitée nulle part dans ce MVP —
  le formulaire de paiement est une simulation, clairement indiquée comme
  telle sur la page.
- La clé API Runway (si tu l'utilises) ne doit jamais être mise dans
  `index.html` ni commit dans Git — elle reste côté serveur (`api/.env`,
  qui est ignoré par `.gitignore`).
