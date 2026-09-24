# Mettre en route les paiements et l'espace client

Voici les services qui font tourner Droly :

| Service | Rôle | Coût |
|---|---|---|
| **Supabase** | comptes clients, base de données, stockage des vidéos | gratuit pour tester (voir « Avant d'encaisser ») |
| **Stripe** | encaisse les 29 €/mois, factures, résiliation | commission par paiement |
| **Dreamina Seedance** (BytePlus ModelArk) | fabrique les vidéos | à l'usage : environ 0,10 $ par vidéo « Plan drone » (5 s, 720p) et 0,75 $ par tour à 360° (10 s) — estimations, prix exact dans ta console BytePlus |
| **Vercel** | héberge le site et les fonctions | l'offre gratuite (Hobby) est réservée à un usage **non commercial** : pour vendre, il faut l'offre **Pro** (20 $/mois) |

Tout se fait depuis les sites web de ces services, **sans terminal**. Compte 30 à 45 minutes.
On commence en **mode test** (fausse carte bancaire, aucun argent réel), puis on passe en réel à l'étape 7.

Dans ce guide, remplace `drolynet.vercel.app` par ton adresse Vercel si elle est différente.

---

## 1. Mettre les fichiers sur GitHub (et vérifier que Vercel publie)

Depuis un téléphone, le plus simple est d'envoyer le zip et de laisser GitHub le déballer tout seul :

1. Sur ton repo GitHub : **Add file → Upload files** → choisis `droly-github-ready.zip` → **Commit changes**.
2. **Une seule fois** : **Add file → Create new file**, nom exact `.github/workflows/installer-site.yml`,
   colle le texte ci-dessous → **Commit changes**.
3. Onglet **Actions** : attends la coche verte (environ 1 minute). Les fichiers (`api`, `app.html`, `index.html`…)
   apparaissent à la racine du repo et le zip disparaît.

Pour une future mise à jour, il suffira de refaire l'étape 1 avec le nouveau zip.

```yaml
name: Installer le site depuis le zip
on:
  push:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  installer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - name: Deballer le zip le plus recent
        run: |
          set -e
          ZIP=""; BEST=-1
          for f in *.zip; do
            [ -f "$f" ] || continue
            T=$(git log -1 --format=%ct -- "$f"); T=${T:-0}
            if [ "$T" -ge "$BEST" ]; then BEST=$T; ZIP=$f; fi
          done
          if [ -z "$ZIP" ]; then echo "Aucun zip a installer"; exit 0; fi
          echo "Zip installe : $ZIP"
          rm -rf /tmp/site && mkdir -p /tmp/site
          unzip -q -o "$ZIP" -d /tmp/site
          IDX=$(find /tmp/site -name index.html -not -path '*/__MACOSX/*' | awk -F/ '{print NF "\t" $0}' | sort -n | head -n 1 | cut -f2-)
          if [ -z "$IDX" ]; then echo "Pas de index.html dans le zip"; exit 1; fi
          SRC=$(dirname "$IDX")
          rm -rf "$SRC/.git" "$SRC/.github"
          find . -mindepth 1 -maxdepth 1 ! -name .git ! -name .github -exec rm -rf {} +
          cp -a "$SRC"/. .
      - name: Enregistrer a ton nom (sinon Vercel gratuit refuse de publier)
        run: |
          git config user.name "${{ github.actor }}"
          git config user.email "${{ github.actor_id }}+${{ github.actor }}@users.noreply.github.com"
          git add -A
          if git diff --cached --quiet; then echo "Rien a enregistrer"; exit 0; fi
          git commit -m "Installe le site depuis le zip"
          git push
```

**Vérifier que Vercel publie** (ton projet Vercel) :
- **Settings → Git** : le repo connecté doit être le tien (`Droly.net`). Sinon, connecte-le.
- **Settings → Build and Deployment → Root Directory** : doit être **vide**.
- 1 à 2 minutes après la coche verte, ton site affiche **Mon espace** en haut à droite. L'espace client dit
  « pas encore prêt » tant que les étapes suivantes ne sont pas faites : c'est normal.

> Le déballeur enregistre les fichiers **à ton nom** : l'offre gratuite de Vercel refuse de publier ce qu'enregistre un robot.
> Si Vercel ne publie toujours pas, modifie n'importe quel fichier sur GitHub (par exemple une lettre dans `README.md`)
> et enregistre : cela relance la publication.

---

## 2. Supabase (comptes clients + base de données)

### 2a. Créer le projet
1. Va sur **supabase.com** → crée un compte → **New project**.
2. Donne un nom (ex. `droly`), choisis un mot de passe (garde-le), région **Europe (Paris ou Frankfurt)**.
3. Attends 1 à 2 minutes que le projet soit prêt.

### 2b. Créer les tables
1. Menu de gauche : **SQL Editor** → **New query**.
2. Ouvre le fichier `supabase/schema.sql` de ce dossier, copie **tout** son contenu, colle-le.
3. Clique **Run**. Tu dois voir « Success ». (Le relancer plus tard ne casse rien.)

### 2c. Récupérer l'adresse et les clés
- **Adresse du projet** (du type `https://abcdefgh.supabase.co`) : bouton **Connect** en haut de la page, ou **Project Settings → Data API**.
- **Clés** : **Project Settings → API Keys** :
  - la clé **publishable** (commence par `sb_publishable_`) ;
  - la clé **secret** (commence par `sb_secret_`, clique pour l'afficher ou en créer une).

> La clé **secret** ne doit jamais apparaître ailleurs que dans Vercel (étape 4).

### 2d. Autoriser ton site
**Authentication → URL Configuration** :
- **Site URL** : `https://drolynet.vercel.app`
- **Redirect URLs** → Add URL : `https://drolynet.vercel.app/**`
- Enregistre.

Sans ça, les liens reçus par email (confirmation, mot de passe oublié) renverraient vers une mauvaise adresse.

### 2e. Emails (obligatoire avant tes premiers clients)
Sans réglage, Supabase **n'envoie des emails qu'aux adresses de ton équipe Supabase** (toi),
et 2 par heure maximum. Tes clients ne recevraient donc ni l'email de confirmation d'inscription,
ni le lien « Mot de passe oublié ».

1. **Pour tester tout de suite, seul·e** : rien à faire, les emails arrivent sur ton adresse.
2. **Avant d'ouvrir à de vrais clients** :
   - crée un compte chez un service d'envoi d'emails (par exemple Resend ou Brevo, qui ont une offre gratuite)
     et suis leur guide « SMTP » ;
   - colle les informations dans **Authentication → Emails → SMTP Settings** → active **Enable custom SMTP** → Save.
3. **Confirmation d'inscription** : dans **Authentication → Sign In / Providers → Email**, l'option **Confirm email**
   oblige chaque client à cliquer un lien reçu par email avant de se connecter. Tu peux la laisser activée
   une fois le SMTP branché, ou la désactiver pour que les clients soient connectés dès l'inscription.

L'espace client gère les deux cas (il affiche « vérifiez vos emails » si la confirmation est activée,
et un message clair si un lien a expiré).

---

## 3. Stripe (paiement), en mode test

Crée un compte sur **stripe.com**. Vérifie en haut du tableau de bord que tu es bien en **mode test / sandbox**.

### 3a. Créer l'abonnement à 29 €
1. **Product catalog** (parfois dans le menu **More**) → **+ Add product**.
2. Nom : `Droly Créateur`. Prix : **29**, devise **EUR**, **Recurring**, période **Monthly**.
3. **Add product**.
4. Ouvre le produit créé. Dans la partie **Pricing**, clique sur le prix : copie son identifiant, qui commence par **`price_`**.

> Attention au piège classique : il faut l'identifiant du **prix** (`price_...`), pas celui du **produit** (`prod_...`).

### 3b. Clé secrète
Page **API keys** (dashboard.stripe.com/apikeys) → copie la **Secret key** (commence par `sk_test_`).

### 3c. Espace de facturation client (résiliation, factures)
**Settings → Billing → Customer portal** (dashboard.stripe.com/settings/billing/portal) :
- active **Cancel subscriptions** (annulation à la fin de la période),
- active **Invoice history** et la mise à jour du moyen de paiement,
- laisse le **lien de connexion** au portail activé,
- **Save**.

Puis, **à activer aussi** (protection contre les doubles abonnements) :
**Settings → Checkout and Payment Links** (dashboard.stripe.com/settings/checkout) → section **Subscriptions** →
active **Limit customers to one subscription** (redirection vers l'espace de facturation). Le site vérifie déjà
lui-même qu'un client n'a qu'un abonnement ; ce réglage bloque aussi le cas rare de deux paiements lancés en même temps.

### 3d. Webhook (Stripe prévient ton site à chaque paiement / résiliation)
1. **Workbench → Webhooks** (dashboard.stripe.com/webhooks) → **Create an event destination**.
2. **Your account** → garde la version d'API proposée.
3. Coche ces 4 événements :
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. **Continue** → **Webhook endpoint** → **Continue**.
5. Endpoint URL : `https://drolynet.vercel.app/api/stripe-webhook` → crée.
6. Sur la page du webhook : **Reveal secret** → copie la valeur qui commence par **`whsec_`**.

---

## 3bis. Dreamina Seedance (les vidéos)

Tout se passe sur **console.byteplus.com** (crée un compte si besoin), dans **ModelArk**.
Le site utilise **deux modèles** : les moins chers qui rendent bien en 720p.

| Ce que le client demande | Modèle | Identifiant | Coût estimé |
|---|---|---|---|
| **Plan drone** (5 s) | Seedance 1.0 Pro Fast | `seedance-1-0-pro-fast-251015` | environ **0,10 $** la vidéo |
| **Tour à 360°** (10 s) | Dreamina Seedance 2.0 Mini | `dreamina-seedance-2-0-mini-260615` | environ **0,75 $** le tour |

1. **Activer les deux modèles** : menu **Model activation** (parfois appelé « Activation management ») → active
   **Seedance 1.0 Pro Fast** et **Dreamina Seedance 2.0 Mini**. Vérifie l'identifiant exact affiché sur la fiche de
   chaque modèle : s'il diffère du tableau, mets le bon dans `SEEDANCE_MODEL` / `SEEDANCE_TOUR_MODEL` (étape 4).
2. **Pouvoir payer l'usage** : ajoute un moyen de paiement (ou du crédit) dans la partie facturation. Pour les modèles
   de la série 2.0 — donc pour les tours — BytePlus demande en plus un **pack de crédits prépayé** (« resource pack ») :
   à partir d'environ 30 $, non remboursable, valable environ 90 jours. **Un pack ne sert qu'au modèle pour lequel il
   est acheté** : prends celui de Seedance 2.0 Mini.
3. **Créer la clé** : menu **API Key Management** → **Create API Key** → donne un nom (ex. `droly`) → copie la clé et
   garde-la pour l'étape 4 (`SEEDANCE_API_KEY`). La même clé sert aux deux modèles. Elle ne va nulle part ailleurs que dans Vercel.

**Pourquoi ces deux modèles ?** Comparés en septembre 2026, Kling, Veo, Wan, Luma et MiniMax coûtent plus cher à
qualité comparable. Les autres Seedance aussi, pour 5 s en 720p et au tarif à l'usage : 2.0 Mini ≈ 0,38 $,
2.0 Fast ≈ 0,60 $, 2.0 ≈ 0,76 $, 2.5 ≈ 1,16 $ (un pack de crédits réduit ces prix d'environ 40 %).

**Comment marche le tour à 360° ?** La photo principale sert d'image de **début ET de fin** : la caméra doit donc faire
le tour complet et revenir à son point de départ. Les photos supplémentaires (3 au maximum) servent de références pour
les côtés qu'aucune photo ne montre. Ce qui n'est sur aucune photo est **imaginé** par l'IA : dis-le à tes clients, et
ajoute le plus de photos possible du même lieu.

**Changer de modèle.** Mets l'identifiant d'un autre modèle activé sur ton compte dans `SEEDANCE_MODEL` (plans drone) ou
`SEEDANCE_TOUR_MODEL` (tours), étape 4. Le modèle des tours doit accepter une image de début **et** de fin
(Seedance 2.x, ou Seedance 1.0 Pro). Si tu prends un modèle plus cher, baisse `MAX_TOURS_PER_MONTH` en conséquence.

Réglages envoyés à chaque vidéo : 720p, format 16:9, **sans filigrane et sans son** ; 5 secondes pour un plan drone,
10 secondes pour un tour à 360°.

---

## 4. Vercel : coller les réglages

Projet Vercel → **Settings → Environment Variables**. Ajoute chaque ligne (Name / Value), environnement **Production** coché :

| Name | Value |
|---|---|
| `SUPABASE_URL` | l'adresse du projet Supabase (`https://….supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | clé `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | clé `sb_secret_…` |
| `STRIPE_SECRET_KEY` | clé `sk_test_…` |
| `STRIPE_PRICE_ID` | identifiant `price_…` |
| `STRIPE_WEBHOOK_SECRET` | secret `whsec_…` |
| `FAL_KEY` | **conseillé** : ta clé fal.ai (fal.ai → API Keys → Add key). Si elle est renseignée, les vidéos sont fabriquées chez fal.ai (Seedance 1.0 Pro Fast pour les plans drone ≈ 0,11 $, Seedance 1.5 Pro sans son pour les tours ≈ 0,26 $). Pas de numéro de TVA demandé. |
| `SEEDANCE_API_KEY` | ou bien ta clé API BytePlus ModelArk (étape 3bis), utilisée seulement si `FAL_KEY` est vide. Une seule des deux clés suffit. |

Facultatif :

| Name | Value |
|---|---|
| `MAX_VIDEOS_PER_MONTH` | vidéos maximum par client sur 30 jours glissants (défaut : **30**, `0` = sans limite) |
| `MAX_TOURS_PER_MONTH` | tours à 360° maximum par client sur 30 jours (défaut : **5**, `0` = sans limite). Ils comptent aussi dans la limite ci-dessus. |
| `FREE_TRIALS_PER_DAY` | vidéos gratuites offertes chaque jour sur la page d'accueil (défaut : **20**, soit environ 2 $ par jour au maximum ; `0` ferme l'essai) |
| `MAX_VIDEOS_PER_DAY` | vidéos maximum par client sur 24 h (défaut : **10**, `0` = sans limite) |
| `SEEDANCE_MODEL` | modèle des vidéos « Plan drone » (défaut : `seedance-1-0-pro-fast-251015`). Voir étape 3bis. |
| `SEEDANCE_TOUR_MODEL` | modèle des tours à 360° (défaut : `dreamina-seedance-2-0-mini-260615`). Voir étape 3bis. |
| `SITE_URL` | seulement si tu utilises un nom de domaine personnalisé, ex. `https://droly.fr` |

**Puis redéploie** (les réglages ne s'appliquent qu'au déploiement suivant) :
**Deployments** → sur le dernier déploiement, menu **⋯** → **Redeploy**.

---

## 5. Vérifier la configuration

Ouvre **`https://drolynet.vercel.app/api/config`** dans ton navigateur. Tu dois voir :
- `"ready": true`
- toutes les lignes de `checks` à `true`
- `"warnings": []` (sinon, chaque avertissement explique quoi corriger)

Cette page n'affiche jamais tes clés secrètes, seulement si elles sont présentes, ainsi que les limites de vidéos en vigueur.

**L'essai gratuit de la page d'accueil.** Un visiteur peut recevoir **une vraie vidéo, offerte**, sans compte ni carte :
il laisse son email, ajoute une photo, et repart avec le fichier. Trois garde-fous, tous appliqués par la base de données :
une seule vidéo par adresse email, une seule par connexion toutes les 24 h, et un plafond pour tout le site
(`FREE_TRIALS_PER_DAY`, 20 par défaut ≈ 2 $ par jour). Les essais ratés ne comptent pas. Pour fermer l'essai : mets `0`.

**Pourquoi des limites ?** Chaque vidéo te coûte des crédits Seedance (environ 0,10 $ un plan drone, 0,75 $ un tour à 360°).
Avec les réglages par défaut, un client peut générer au maximum 30 vidéos sur 30 jours, dont 5 tours : environ **6 $** de
crédits dans le pire des cas, pour un abonnement à 29 €. Ajuste `MAX_VIDEOS_PER_MONTH` et `MAX_TOURS_PER_MONTH` selon ta marge.
Les générations ratées ne sont pas décomptées, et supprimer une vidéo ne redonne pas de crédit (sinon la limite
serait contournable). Le client voit dans son espace combien de vidéos il lui reste.

---

## 6. Tester tout le parcours (mode test)

1. Va sur ton site → colle un lien d'annonce → **Créer mon compte**.
2. Crée un compte (vrai email si la confirmation est activée).
3. **S'abonner** → page Stripe → carte de test **`4242 4242 4242 4242`**, date future quelconque, CVC quelconque, nom quelconque.
4. Retour automatique sur ton site : « Abonnement activé ».
5. **Nouvelle vidéo** → laisse « Plan drone » → choisis une photo → **Générer la vidéo** (1 à 3 minutes).
   Recommence avec **Tour à 360°**, « autour de la maison », une photo de façade et 1 ou 2 photos du même bien (2 à 5 minutes).
   ⚠️ Cette étape utilise de **vrais crédits Seedance**, même en mode test Stripe.
6. **Mes vidéos** : la vidéo est là, téléchargeable. Si la génération dure plus de 30 secondes, la page continue
   de la suivre toute seule ; même si tu fermes la page, la vidéo sera récupérée à ton prochain passage.
7. **Abonnement → Gérer mon abonnement** → résilie → reviens : « Actif jusqu'à la fin de période ».
8. Reviens sur l'accueil, colle un lien d'annonce, laisse un **autre** email et une photo : tu reçois la vidéo gratuite,
   et un deuxième essai avec le même email doit être refusé poliment.

Côté coulisses, dans Supabase → **Table Editor** : la table `subscriptions` contient ta ligne (`status = active`),
la table `videos` ta vidéo. Dans Stripe → **Webhooks** → ton webhook → **Event deliveries** : les envois sont en `200`.

---

## 7. Passer aux vrais paiements

1. Dans Stripe, **active ton compte** (infos de l'entreprise, RIB) : obligatoire pour encaisser.
2. Sur la page du produit (mode test), clique **Copy to live mode**, puis passe en **mode live** et copie le nouvel identifiant `price_…`.
3. En mode live : refais **3b** (clé `sk_live_…`), **3c** (portail client) et **3d** (nouveau webhook → nouveau `whsec_…`).
4. Dans Vercel, remplace `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` et `STRIPE_WEBHOOK_SECRET` par les valeurs live → **Redeploy**.
5. `/api/config` doit afficher `"stripeMode": "live"`.

Les comptes clients créés pendant les tests restent valables, mais **un abonnement souscrit en mode test ne donne plus
accès une fois les vrais paiements activés** : ces comptes (toi compris) devront s'abonner pour de vrai. Leur fiche
Stripe de test est remplacée automatiquement à ce moment-là. Pense aussi à refaire le réglage « Limit customers to one
subscription » (3c) en mode live.

---

## Avant d'encaisser tes premiers clients

- **Obligations légales (France)** : mentions légales, conditions générales de vente (CGV) et politique de confidentialité
  (tu stockes des emails : RGPD) doivent être accessibles sur le site. Fais-les valider si besoin.
- **Emails** : branche un service SMTP (étape 2e), sinon tes clients ne reçoivent aucun email.
- **Vercel Pro** : l'offre gratuite de Vercel est réservée aux projets non commerciaux.
- **Supabase** : l'offre gratuite inclut 1 Go de stockage (quelques centaines de vidéos) et met le projet en pause
  après 7 jours sans activité. Passe à l'offre Pro quand tes premiers clients arrivent.
- **Budget Seedance** : surveille ta consommation de crédits dans BytePlus (un pack expire au bout d'environ 90 jours) et ajuste `MAX_VIDEOS_PER_MONTH` / `MAX_VIDEOS_PER_DAY`.
- **TVA** : Stripe peut la calculer (Stripe Tax) ; renseigne-toi selon ton statut.

---

## En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| L'espace client dit « pas encore prêt » | une variable manque ou est mal remplie | ouvre `/api/config`, corrige ce qui est à `false` ou en avertissement, **Redeploy** |
| « Le serveur ne répond pas » | le site n'est pas servi par Vercel, ou le dossier `api/` manque sur GitHub | vérifie que `api/` est bien sur GitHub et que le site est ouvert via l'adresse Vercel |
| Le lien de l'email mène à `localhost` | Site URL Supabase non réglée | étape 2d |
| Après paiement, l'abonnement ne s'active pas | webhook mal configuré | étape 3d ; dans Stripe, **Event deliveries** du webhook : une erreur `400` = mauvais `whsec_`, `500` = voir les logs Vercel |
| « Gérer mon abonnement » affiche une erreur Stripe | portail client pas enregistré | étape 3c (en test ET en live) |
| La génération échoue | photo refusée par Seedance (sa modération refuse certaines images), crédits épuisés, pack acheté pour un autre modèle, ou modèle non activé | essayer une autre photo (paysage, bien éclairée) ; vérifier dans BytePlus ModelArk que **les deux** modèles sont activés et que le pack correspond bien au modèle utilisé (étape 3bis) ; le message exact est dans les logs Vercel |
| Seuls les tours à 360° échouent | modèle des tours non activé, ou pack acheté pour un autre modèle | étape 3bis : activer Dreamina Seedance 2.0 Mini et acheter son pack ; ou choisir un autre modèle dans `SEEDANCE_TOUR_MODEL` |
| « Ce site ne laisse pas récupérer ses photos » | l'annonce (Airbnb, Leboncoin…) refuse les robots : c'est normal et prévu | enregistrer la photo depuis l'annonce (appui long → « Enregistrer l'image ») puis l'ajouter depuis l'appareil |
| Autre erreur | — | Vercel → **Deployments** → dernier déploiement → **Logs** : le message exact y est |
