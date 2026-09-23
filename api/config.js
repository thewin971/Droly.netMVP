// GET /api/config
// Donne à la page les informations PUBLIQUES dont elle a besoin (adresse et
// clé publique Supabase), et un petit bilan de configuration : ouvre
// https://ton-site.vercel.app/api/config dans ton navigateur pour vérifier
// que toutes les variables sont bien en place. Aucune valeur secrète n'est
// jamais renvoyée, seulement "true" / "false".

import { env, handler, json, limits } from './_shared.js';
import { videoModel } from './_generation.js';

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET',
  'SEEDANCE_API_KEY',
];

function warnings() {
  const list = [];
  const url = env('SUPABASE_URL');
  const pub = env('SUPABASE_PUBLISHABLE_KEY');
  const secret = env('SUPABASE_SECRET_KEY');
  const sk = env('STRIPE_SECRET_KEY');
  const price = env('STRIPE_PRICE_ID');
  const whsec = env('STRIPE_WEBHOOK_SECRET');

  if (url && !/^https:\/\/[^/]+$/.test(url.replace(/\/+$/, ''))) {
    list.push("SUPABASE_URL doit ressembler à https://xxxx.supabase.co (sans rien après).");
  }
  if (pub && /^sb_secret_/.test(pub)) {
    list.push('SUPABASE_PUBLISHABLE_KEY contient une clé SECRÈTE : mets-y la clé "publishable" (sb_publishable_...).');
  }
  if (secret && /^sb_publishable_/.test(secret)) {
    list.push('SUPABASE_SECRET_KEY contient la clé publique : mets-y la clé "secret" (sb_secret_...).');
  }
  if (sk && /^pk_/.test(sk)) {
    list.push('STRIPE_SECRET_KEY contient la clé PUBLIQUE Stripe (pk_...) : il faut la clé secrète (sk_...).');
  }
  if (price && /^prod_/.test(price)) {
    list.push("STRIPE_PRICE_ID contient l'identifiant du PRODUIT (prod_...) : il faut celui du PRIX (price_...).");
  }
  if (price && !/^price_/.test(price) && !/^prod_/.test(price)) {
    list.push('STRIPE_PRICE_ID doit commencer par price_.');
  }
  if (whsec && !/^whsec_/.test(whsec)) {
    list.push('STRIPE_WEBHOOK_SECRET doit commencer par whsec_.');
  }
  return list;
}

export default handler('config', async () => {
  const checks = {};
  for (const name of REQUIRED) checks[name] = !!env(name);
  const sk = env('STRIPE_SECRET_KEY');

  return json({
    supabaseUrl: env('SUPABASE_URL').replace(/\/+$/, ''),
    supabasePublishableKey: env('SUPABASE_PUBLISHABLE_KEY'),
    ready: REQUIRED.every((name) => checks[name]) && warnings().length === 0,
    stripeMode: sk ? (/_live_/.test(sk) ? 'live' : 'test') : null,
    limits: limits(),
    videoModel: videoModel('travelling'),
    tourModel: videoModel('tour'),
    checks,
    warnings: warnings(),
  });
});
