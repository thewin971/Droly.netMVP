// POST /api/sync-checkout   body : { sessionId }
// Appelé par l'espace client juste après le retour de la page de paiement
// Stripe : on vérifie le paiement directement auprès de Stripe et on active
// l'abonnement tout de suite, sans attendre le webhook (qui reste le
// mécanisme principal pour les renouvellements et résiliations).

import {
  configError, fail, getUser, handler, json, saveSubscription, stripe,
} from './_shared.js';

export default handler('sync-checkout', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const missing = configError([
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'STRIPE_SECRET_KEY',
  ]);
  if (missing) return missing;

  const user = await getUser(request);
  if (!user) return fail(401, 'unauthorized', 'Connectez-vous pour continuer.');

  const body = await request.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return fail(400, 'bad_request', 'Identifiant de paiement invalide.');
  }

  const session = await stripe().checkout.sessions.retrieve(sessionId);
  const owner = session.client_reference_id || (session.metadata && session.metadata.user_id);
  if (owner !== user.id) {
    return fail(403, 'forbidden', "Ce paiement n'appartient pas à ce compte.");
  }
  if (!session.subscription) {
    return json({ activated: false, status: session.status });
  }

  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  await saveSubscription(sub, user.id);
  return json({ activated: true, status: sub.status });
});
