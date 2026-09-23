// POST /api/create-checkout
// Le client connecté clique "S'abonner" : on crée (une seule fois) sa fiche
// client chez Stripe, puis une page de paiement Stripe sécurisée, et on
// renvoie son adresse. La carte bancaire est saisie chez Stripe, jamais ici.

import {
  configError, env, fail, getFreshSubscriptionRow, getUser, handler, isActive,
  isMissingStripeObject, json, listCustomerSubscriptions, OPEN_STATUSES,
  pickBestSubscription, saveSubscription, siteOrigin, stripe, supabaseAdmin,
} from './_shared.js';

async function createCustomer(user) {
  const customer = await stripe().customers.create({
    email: user.email,
    metadata: { user_id: user.id },
  });
  const { error } = await supabaseAdmin()
    .from('subscriptions')
    .upsert(
      { user_id: user.id, stripe_customer_id: customer.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) throw new Error('Enregistrement client impossible : ' + error.message);
  return customer.id;
}

export default handler('create-checkout', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const missing = configError([
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
    'STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID',
  ]);
  if (missing) return missing;

  const user = await getUser(request);
  if (!user) return fail(401, 'unauthorized', 'Connectez-vous pour continuer.');

  const existing = await getFreshSubscriptionRow(user.id);
  if (isActive(existing)) {
    return fail(409, 'already_subscribed', 'Vous avez déjà un abonnement actif.');
  }

  // Fiche client Stripe : on réutilise celle du client si elle existe dans le
  // mode Stripe actuel (test ou réel), sinon on en crée une.
  let customerId = existing && existing.stripe_customer_id;
  if (customerId) {
    let subs = null;
    try {
      subs = await listCustomerSubscriptions(customerId);
    } catch (err) {
      if (!isMissingStripeObject(err)) throw err;
      customerId = null; // fiche de l'autre mode (test ↔ réel)
    }
    // Jamais deux abonnements en même temps (double onglet, ancien lien de
    // paiement réglé plus tard…).
    const open = (subs || []).filter((s) => OPEN_STATUSES.includes(s.status));
    if (open.length) {
      const best = pickBestSubscription(open);
      await saveSubscription(best, user.id);
      if (best.status === 'active' || best.status === 'trialing') {
        return fail(409, 'already_subscribed', 'Vous avez déjà un abonnement actif.');
      }
      return fail(409, 'payment_issue',
        'Votre abonnement existe déjà mais un paiement est en attente : mettez à jour votre moyen de paiement.');
    }
  }
  if (!customerId) {
    customerId = await createCustomer(user);
  } else {
    // Une ancienne page de paiement encore ouverte (autre onglet, lien
    // gardé de côté…) ne doit pas pouvoir être payée en plus de la nouvelle.
    const open = await stripe().checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 });
    for (const old of (open && open.data) || []) {
      await stripe().checkout.sessions.expire(old.id).catch((err) => {
        console.warn('[droly-api:create-checkout] Expiration impossible :', old.id, err && err.message);
      });
    }
  }

  const origin = siteOrigin(request);
  const createSession = (customer) => stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: env('STRIPE_PRICE_ID'), quantity: 1 }],
    client_reference_id: user.id,
    metadata: { user_id: user.id },
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: true,
    locale: 'fr',
    success_url: origin + '/app.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/app.html?checkout=cancel',
  });

  let session;
  try {
    session = await createSession(customerId);
  } catch (err) {
    // Fiche client introuvable dans ce mode Stripe : on la recrée une fois.
    if (!isMissingStripeObject(err) || err.param !== 'customer') throw err;
    session = await createSession(await createCustomer(user));
  }

  return json({ url: session.url });
});
