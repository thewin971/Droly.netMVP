// POST /api/stripe-webhook
// Stripe appelle cette adresse à chaque événement d'abonnement (paiement,
// renouvellement, échec de paiement, résiliation…). On vérifie la signature
// pour être sûr que c'est bien Stripe, puis on met à jour la base.
//
// À déclarer dans Stripe (voir SETUP.md) avec ces 4 événements :
//   checkout.session.completed
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted

import { configError, env, fail, handler, json, saveSubscription, stripe } from './_shared.js';

async function latest(subscriptionId, fallback) {
  try {
    return await stripe().subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (fallback) return fallback;
    throw err;
  }
}

export default handler('stripe-webhook', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const missing = configError([
    'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  ]);
  if (missing) return missing;

  // La signature se vérifie sur le texte EXACT reçu : on le lit tel quel.
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature') || '';

  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      rawBody, signature, env('STRIPE_WEBHOOK_SECRET')
    );
  } catch (err) {
    console.error('[droly-api:stripe-webhook] Signature invalide :', err && err.message);
    return fail(400, 'bad_signature', 'Signature Stripe invalide.');
  }

  const object = event.data && event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      if (object.mode === 'subscription' && object.subscription) {
        const id = typeof object.subscription === 'string' ? object.subscription : object.subscription.id;
        const sub = await latest(id);
        await saveSubscription(sub, object.client_reference_id || (object.metadata && object.metadata.user_id));
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // On relit l'abonnement chez Stripe pour avoir son état le plus récent,
      // même si les événements arrivent dans le désordre.
      const sub = await latest(object.id, object);
      await saveSubscription(sub);
      break;
    }
    default:
      // Autres événements : rien à faire.
      break;
  }

  return json({ received: true });
});
