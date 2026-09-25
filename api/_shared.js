// Outils partagés par les fonctions de l'API.
// Le "_" au début du nom empêche Vercel d'en faire une adresse publique :
// ce fichier est seulement importé par les autres fonctions.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function fail(status, code, message) {
  return json({ error: code, message }, status);
}

// Filet de sécurité commun : toute erreur inattendue devient une réponse
// propre (500) sans détail technique pour le client ; le détail complet part
// dans les logs Vercel (Deployments → ton déploiement → Logs).
export function handler(name, fn) {
  return {
    async fetch(request) {
      try {
        return await fn(request);
      } catch (err) {
        console.error(`[droly-api:${name}]`, err);
        return fail(500, 'server_error', 'Erreur interne. Réessayez dans un instant.');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Configuration (variables d'environnement Vercel)
// ---------------------------------------------------------------------------

export function env(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function missingEnv(names) {
  return names.filter((name) => !env(name));
}

export function configError(names) {
  const missing = missingEnv(names);
  if (!missing.length) return null;
  console.error('[droly-api] Variables manquantes :', missing.join(', '));
  return fail(
    500,
    'config_missing',
    'Configuration incomplète : ajoute ' + missing.join(', ') +
      ' dans Vercel → Settings → Environment Variables, puis redéploie.'
  );
}

function intEnv(name, fallback) {
  const raw = env(name);
  if (raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Limites de génération (0 = pas de limite). Les tours à 360° comptent dans
// perDay / perMonth ET dans toursPerMonth (ils coûtent plus cher).
export function limits() {
  return {
    perDay: intEnv('MAX_VIDEOS_PER_DAY', 10),
    perMonth: intEnv('MAX_VIDEOS_PER_MONTH', 30),
    toursPerMonth: intEnv('MAX_TOURS_PER_MONTH', 5),
    visitsPerMonth: intEnv('MAX_VISITS_PER_MONTH', 5),
    freeTrialsPerDay: intEnv('FREE_TRIALS_PER_DAY', 20),
  };
}

// ---------------------------------------------------------------------------
// Photos envoyées par les visiteurs
// ---------------------------------------------------------------------------

const DATA_URI = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_DATA_URI_LENGTH = 5 * 1024 * 1024; // la page compresse les photos avant l'envoi

export function checkImage(image) {
  if (typeof image !== 'string' || !image) return 'Ajoutez une photo ou un lien vers une photo.';
  if (image.startsWith('data:')) {
    if (image.length > MAX_DATA_URI_LENGTH) return 'Photo trop lourde (5 Mo maximum).';
    if (!DATA_URI.test(image)) return 'Format de photo non pris en charge (JPEG, PNG ou WebP).';
    return null;
  }
  let url;
  try { url = new URL(image); } catch { return "Le lien de la photo n'est pas valide."; }
  if (url.protocol !== 'https:') return 'Le lien de la photo doit commencer par https://';
  if (image.length > 2048) return 'Le lien de la photo est trop long.';
  return null;
}

// Empreinte de la connexion du visiteur : sert à limiter les essais gratuits
// sans jamais conserver l'adresse IP elle-même (calcul à sens unique, salé avec
// une clé secrète : impossible de retrouver l'adresse à partir de l'empreinte).
export async function ipFingerprint(request) {
  const forwarded = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const raw = forwarded || (request.headers.get('x-real-ip') || '').trim();
  if (!raw) return null;
  const bytes = new TextEncoder().encode(env('SUPABASE_SECRET_KEY') + '|ip|' + raw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

// Paiements réels (clé sk_live_ / rk_live_) ou mode test ?
export function stripeLive() {
  return /_live_/.test(env('STRIPE_SECRET_KEY'));
}

// Adresse du site, pour les retours depuis Stripe. SITE_URL (optionnel)
// permet de forcer un nom de domaine personnalisé.
export function siteOrigin(request) {
  const forced = env('SITE_URL').replace(/\/+$/, '');
  if (forced) return forced;
  return new URL(request.url).origin;
}

// ---------------------------------------------------------------------------
// Clients Supabase / Stripe
// ---------------------------------------------------------------------------

let adminClient = null;
export function supabaseAdmin() {
  if (!adminClient) {
    adminClient = createClient(env('SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return adminClient;
}

let stripeClient = null;
export function stripe() {
  if (!stripeClient) stripeClient = new Stripe(env('STRIPE_SECRET_KEY'));
  return stripeClient;
}

export function isMissingStripeObject(err) {
  return !!err && err.code === 'resource_missing';
}

// ---------------------------------------------------------------------------
// Qui fait la demande ? (jeton de connexion envoyé par la page)
// ---------------------------------------------------------------------------

export async function getUser(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;

  const base = env('SUPABASE_URL').replace(/\/+$/, '');
  const res = await fetch(base + '/auth/v1/user', {
    headers: {
      apikey: env('SUPABASE_PUBLISHABLE_KEY'),
      Authorization: 'Bearer ' + match[1],
    },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user && user.id ? user : null;
}

// ---------------------------------------------------------------------------
// Abonnements
// ---------------------------------------------------------------------------

export const ACTIVE_STATUSES = ['active', 'trialing'];
// Abonnements encore "en cours" chez Stripe (même si un paiement bloque) :
// on n'en crée jamais un deuxième par-dessus.
export const OPEN_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'paused'];

// Actif = statut OK ET même mode Stripe que le site. Un abonnement souscrit
// en mode test ne donne donc jamais accès une fois le site en paiements réels.
export function isActive(row) {
  return !!row && ACTIVE_STATUSES.includes(row.status) && row.livemode === stripeLive();
}

export async function getSubscriptionRow(userId) {
  const { data, error } = await supabaseAdmin()
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('Lecture abonnement impossible : ' + error.message);
  return data;
}

// Comme getSubscriptionRow, mais si la date de fin de période est dépassée
// (webhook manqué, par exemple), on redemande l'état réel à Stripe.
export async function getFreshSubscriptionRow(userId) {
  const row = await getSubscriptionRow(userId);
  if (!row || !row.stripe_subscription_id) return row;
  const unknownMode = row.livemode === null || row.livemode === undefined; // ligne d'avant la colonne livemode
  const expired = row.current_period_end && Date.parse(row.current_period_end) < Date.now() - 60 * 1000;
  if (!unknownMode && (!expired || row.livemode !== stripeLive())) return row;
  try {
    const sub = await stripe().subscriptions.retrieve(row.stripe_subscription_id);
    await saveSubscription(sub, userId);
    return await getSubscriptionRow(userId);
  } catch (err) {
    console.error('[droly-api] Rafraîchissement abonnement impossible :', err && err.message);
    return row;
  }
}

// Traduit un abonnement Stripe en ligne pour la table "subscriptions".
// Compatible avec les anciennes et nouvelles versions de l'API Stripe
// (la date de fin de période a changé de place en 2025).
export function subscriptionToRow(sub) {
  const item = sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const periodEnd = sub.current_period_end || (item && item.current_period_end) || null;
  const scheduledCancel = !!sub.cancel_at_period_end || !!sub.cancel_at;
  const accessEnd = sub.cancel_at || periodEnd;
  return {
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: item && item.price ? item.price.id : null,
    current_period_end: accessEnd ? new Date(accessEnd * 1000).toISOString() : null,
    cancel_at_period_end: scheduledCancel && sub.status !== 'canceled',
    livemode: !!sub.livemode,
    updated_at: new Date().toISOString(),
  };
}

function rank(sub) {
  if (ACTIVE_STATUSES.includes(sub.status)) return 3;
  if (OPEN_STATUSES.includes(sub.status)) return 2;
  if (sub.status === 'incomplete') return 1;
  return 0;
}

// Parmi tous les abonnements d'un client Stripe, garde le plus pertinent :
// un actif avant un impayé, avant un annulé ; à égalité, le plus récent.
export function pickBestSubscription(subs) {
  return subs.slice().sort((a, b) => rank(b) - rank(a) || (b.created || 0) - (a.created || 0))[0] || null;
}

export async function listCustomerSubscriptions(customerId) {
  const page = await stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  return (page && page.data) || [];
}

// Enregistre l'état d'abonnement d'un client à partir de Stripe.
// Renvoie true si la ligne a été écrite.
export async function saveSubscription(sub, userIdHint) {
  const db = supabaseAdmin();
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;

  let userId = userIdHint || (sub.metadata && sub.metadata.user_id) || null;
  if (!userId && customerId) {
    const { data, error } = await db
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (error) throw new Error('Recherche client impossible : ' + error.message);
    userId = data && data.user_id;
  }
  if (!userId) {
    console.warn('[droly-api] Abonnement Stripe sans client Droly associé :', sub.id);
    return false;
  }

  // Si le client a plusieurs abonnements (ancien annulé + nouveau, par
  // exemple), on enregistre toujours le meilleur, quel que soit l'ordre
  // d'arrivée des événements.
  let best = sub;
  if (customerId) {
    const all = await listCustomerSubscriptions(customerId);
    if (!all.some((s) => s.id === sub.id)) all.push(sub);
    best = pickBestSubscription(all) || sub;
  }

  const { error } = await db
    .from('subscriptions')
    .upsert({ user_id: userId, ...subscriptionToRow(best) }, { onConflict: 'user_id' });
  if (error) throw new Error('Enregistrement abonnement impossible : ' + error.message);
  return true;
}
