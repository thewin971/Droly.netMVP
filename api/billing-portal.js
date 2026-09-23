// POST /api/billing-portal
// Ouvre l'espace de facturation Stripe du client : factures, changement de
// carte bancaire, résiliation. Stripe gère tout, on renvoie juste l'adresse.

import {
  configError, fail, getSubscriptionRow, getUser, handler, isMissingStripeObject,
  json, siteOrigin, stripe,
} from './_shared.js';

const NO_CUSTOMER = "Aucun abonnement n'est encore associé à ce compte.";

export default handler('billing-portal', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const missing = configError([
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'STRIPE_SECRET_KEY',
  ]);
  if (missing) return missing;

  const user = await getUser(request);
  if (!user) return fail(401, 'unauthorized', 'Connectez-vous pour continuer.');

  const row = await getSubscriptionRow(user.id);
  if (!row || !row.stripe_customer_id) return fail(400, 'no_customer', NO_CUSTOMER);

  let session;
  try {
    session = await stripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: siteOrigin(request) + '/app.html?tab=abonnement',
      locale: 'fr',
    });
  } catch (err) {
    // Fiche client créée dans l'autre mode Stripe (test ↔ réel).
    if (isMissingStripeObject(err)) return fail(400, 'no_customer', NO_CUSTOMER);
    throw err;
  }
  return json({ url: session.url });
});
