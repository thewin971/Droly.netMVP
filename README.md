# Droly

Service qui transforme les photos d'une annonce immobilière (Airbnb, Leboncoin…) en vidéo de
visite façon travelling, vendu par abonnement (29 €/mois). Concept d'exploration inspiré de
dronly.co, non affilié.

**Pour tout mettre en route (paiements, comptes clients) : suis [SETUP.md](SETUP.md), pas à pas.**

## Ce qu'il y a dans ce repo

```
droly/
├── index.html          ← page d'accueil (présentation, aperçu d'exemple, questionnaire)
├── app.html            ← espace client : compte, abonnement, génération, mes vidéos
├── videos/             ← les 5 vidéos de démonstration de la page d'accueil
├── api/                ← fonctions serveur, exécutées par Vercel
│   ├── _shared.js          outils communs (non publié comme adresse)
│   ├── config.js           GET  /api/config           réglages publics + diagnostic
│   ├── create-checkout.js  POST /api/create-checkout  ouvre le paiement Stripe
│   ├── sync-checkout.js    POST /api/sync-checkout    active l'abonnement au retour du paiement
│   ├── stripe-webhook.js   POST /api/stripe-webhook   reçoit les événements Stripe
│   ├── billing-portal.js   POST /api/billing-portal   factures / carte / résiliation (Stripe)
│   ├── listing-photos.js   POST /api/listing-photos   propose les photos publiques d'une page d'annonce
│   ├── generate.js         POST /api/generate         lance une vidéo (abonnés uniquement, limites incluses)
│   ├── generation-status.js POST /api/generation-status suit une vidéo en cours jusqu'à ce qu'elle soit prête
│   ├── _generation.js      outils de génération communs (non publié comme adresse)
│   └── README.md
├── supabase/
│   ├── schema.sql          tables + règles de sécurité + stockage, à coller dans Supabase
│   └── README.md
├── package.json        ← dépendances des fonctions (installées automatiquement par Vercel)
├── .env.example        ← liste des variables à renseigner dans Vercel
└── SETUP.md            ← guide de mise en route
```

## Parcours client

1. Sur l'accueil, le visiteur colle le lien de son annonce et voit un **exemple de rendu** (gratuit).
2. **Créer mon compte** → `app.html` : inscription (email + mot de passe).
3. **S'abonner** → page de paiement **Stripe** (la carte n'est jamais saisie sur Droly).
4. Retour sur l'espace client, abonnement actif :
   - **Nouvelle vidéo** : une photo envoyée depuis l'appareil, ou choisie parmi les photos de l'annonce (le lien de l'annonce
     est analysé quand le site l'autorise) → vidéo générée par Dreamina Seedance (BytePlus),
     au choix **Plan drone** (la caméra avance, 5 s, en général 1 à 3 minutes) ou **Tour à 360°** de la maison ou d'une pièce
     (la caméra fait le tour complet, 10 s, 2 à 5 minutes, avec jusqu'à 3 photos du même lieu pour un rendu plus fidèle),
     avec le nombre de vidéos et de tours restants affiché ; une génération longue ou interrompue est reprise automatiquement ;
   - **Mes vidéos** : toutes ses vidéos, à revoir, télécharger ou supprimer ;
   - **Abonnement** : statut, date de renouvellement, et accès à l'espace Stripe (factures, carte, résiliation).

## Sécurité

- Les clés secrètes (Stripe, Supabase `secret`, Seedance) ne sont **que** dans les variables d'environnement
  Vercel, jamais dans le code ni sur GitHub.
- Seuls les clients connectés **et** abonnés peuvent générer une vidéo (tes crédits Seedance sont protégés),
  avec des limites réglables (`MAX_VIDEOS_PER_MONTH`, `MAX_VIDEOS_PER_DAY`, `MAX_TOURS_PER_MONTH`) tenues dans un registre que le client
  ne peut pas modifier, et vérifiées de façon atomique (impossible à dépasser, même avec des demandes simultanées).
- Chaque client ne voit et ne supprime que **ses** vidéos (règles de sécurité Supabase). Un abonnement ne
  peut être activé que par Stripe (webhook signé ou vérification du paiement auprès de Stripe), jamais deux
  abonnements en même temps, et un abonnement de test ne donne jamais accès en mode réel.
- Les vidéos sont stockées dans un espace privé ; les liens de lecture/téléchargement expirent au bout d'une heure.

## Hébergement

Le site **doit être servi par Vercel** : les fonctions du dossier `api/` ne tournent pas sur GitHub Pages.
L'accueil (`index.html`) s'affiche partout, mais l'espace client a besoin de Vercel.
