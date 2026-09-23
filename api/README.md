# Fonctions serveur (Vercel)

Chaque fichier de ce dossier devient automatiquement une adresse de ton site :
`api/generate.js` → `https://ton-site.vercel.app/api/generate`. Les fichiers `_shared.js`
et `_generation.js` (qui commencent par `_`) sont seulement importés par les autres : ce ne sont pas des adresses.

Aucune installation ni commande à lancer : Vercel lit `package.json` à la racine du repo
et installe Stripe et Supabase à chaque déploiement (Seedance est appelé directement, sans bibliothèque).

| Adresse | Qui l'appelle | Rôle |
|---|---|---|
| `GET /api/config` | l'espace client, et toi pour vérifier | adresse + clé **publique** Supabase, et bilan des réglages (jamais les secrets) |
| `POST /api/create-checkout` | bouton « S'abonner » | crée la fiche client Stripe puis la page de paiement |
| `POST /api/sync-checkout` | retour du paiement | vérifie le paiement auprès de Stripe et active l'abonnement immédiatement |
| `POST /api/stripe-webhook` | Stripe | renouvellements, échecs de paiement, résiliations (signature vérifiée) |
| `POST /api/billing-portal` | bouton « Gérer mon abonnement » | ouvre l'espace de facturation Stripe du client |
| `POST /api/listing-photos` | bouton « Chercher les photos de l'annonce » | lit les photos publiques d'une page d'annonce (og:image, données de la page) ; ne contourne rien : si le site refuse, la réponse est vide |
| `POST /api/generate` | bouton « Générer la vidéo » | abonnés uniquement : réserve dans les limites (plan drone ou tour à 360°), lance Dreamina Seedance, attend ~30 s |
| `POST /api/generation-status` | la page, toutes les 5 s | suit une vidéo encore en cours ; dès qu'elle est prête : stockage privé → « Mes vidéos » |

Toutes les adresses sauf `config` et `stripe-webhook` exigent un client connecté
(jeton de connexion Supabase envoyé par la page).

Les variables d'environnement à renseigner dans Vercel sont listées dans `../.env.example`
et expliquées dans `../SETUP.md`.

## Où voir les erreurs

Vercel → ton projet → **Deployments** → le déploiement actif → **Logs**.
Chaque message est préfixé par le nom de la fonction, par ex. `[droly-api:generate]`.
