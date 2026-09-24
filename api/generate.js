// POST /api/generate   body : { image, title?, kind?, variant?, extraImages? }
//   image       : lien direct https vers une photo, OU photo envoyée depuis
//                 l'appareil (data:image/jpeg;base64,...)
//   kind        : 'travelling' = plan drone (5 s, par défaut), ou 'tour' (tour complet à 360°, 10 s)
//   variant     : pour un tour, 'exterior' (autour de la maison) ou 'interior' (dans une pièce)
//   extraImages : pour un tour, jusqu'à 3 autres photos du même endroit (rendu plus fidèle)
//
// Réservé aux clients connectés ET abonnés : sinon n'importe qui pourrait
// générer des vidéos à tes frais. Étapes :
//   1. vérifie le compte, l'abonnement et les limites (table "generations")
//   2. lance la vidéo chez Seedance (fal.ai ou BytePlus ModelArk)
//   3. attend jusqu'à ~30 s ; si elle est prête, la range dans "Mes vidéos"
//   4. sinon répond "en cours" : la page prend le relais avec
//      /api/generation-status (rien n'est perdu, même si la page est fermée)

import {
  checkImage, configError, fail, getFreshSubscriptionRow, getUser, handler, isActive,
  json, limits, supabaseAdmin,
} from './_shared.js';
import {
  advance, createVideoTask, markFailed, MAX_EXTRA_IMAGES, POLL_INTERVAL_MS, sleep, updateGeneration,
  videoKeyName,
} from './_generation.js';

// Doit rester bien en dessous de la durée maximale d'une fonction (60 s,
// réglée dans vercel.json) pour laisser le temps de ranger la vidéo.
const WAIT_BEFORE_HANDOFF_MS = 30000;

export default handler('generate', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const missing = configError([
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
    'STRIPE_SECRET_KEY', videoKeyName(),
  ]);
  if (missing) return missing;

  // 1. Compte + abonnement
  const user = await getUser(request);
  if (!user) return fail(401, 'unauthorized', 'Connectez-vous pour générer une vidéo.');

  const sub = await getFreshSubscriptionRow(user.id);
  if (!isActive(sub)) {
    return fail(402, 'subscription_required', 'Un abonnement actif est nécessaire pour générer des vidéos.');
  }

  const body = await request.json().catch(() => null);
  if (!body) return fail(400, 'bad_request', 'Requête invalide.');
  const imageError = checkImage(body.image);
  if (imageError) return fail(400, 'bad_image', imageError);

  const kind = body.kind === undefined || body.kind === null || body.kind === '' ? 'travelling' : body.kind;
  if (kind !== 'travelling' && kind !== 'tour') return fail(400, 'bad_kind', 'Type de vidéo inconnu.');
  const variant = body.variant === 'interior' ? 'interior' : 'exterior';
  let extraImages = [];
  if (kind === 'tour' && body.extraImages !== undefined && body.extraImages !== null) {
    if (!Array.isArray(body.extraImages)) return fail(400, 'bad_image', 'Photos supplémentaires invalides.');
    if (body.extraImages.length > MAX_EXTRA_IMAGES) {
      return fail(400, 'too_many_images', `${MAX_EXTRA_IMAGES} photos supplémentaires au maximum.`);
    }
    for (const extra of body.extraImages) {
      const extraError = checkImage(extra);
      if (extraError) return fail(400, 'bad_image', 'Photo supplémentaire : ' + extraError);
    }
    extraImages = body.extraImages;
  }

  const day = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  const title =
    (typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '') ||
    (kind === 'tour' ? 'Tour 360° du ' : 'Vidéo du ') + day;

  // Réservation atomique : impossible de dépasser les limites, même avec
  // plusieurs demandes simultanées.
  const { perDay, perMonth, toursPerMonth } = limits();
  const { data: reservation, error: reserveError } = await supabaseAdmin().rpc('reserve_generation', {
    p_user: user.id, p_title: title, p_daily: perDay, p_monthly: perMonth,
    p_kind: kind, p_tour_monthly: toursPerMonth,
  });
  if (reserveError) throw new Error('Réservation impossible : ' + reserveError.message);
  if (reservation && reservation.error === 'daily_limit') {
    return fail(429, 'daily_limit', `Limite de ${perDay} vidéos par 24 h atteinte. Réessayez plus tard.`);
  }
  if (reservation && reservation.error === 'monthly_limit') {
    return fail(429, 'monthly_limit', `Limite de ${perMonth} vidéos sur 30 jours atteinte.`);
  }
  if (reservation && reservation.error === 'tour_limit') {
    return fail(429, 'tour_limit',
      `Limite de ${toursPerMonth} tours à 360° sur 30 jours atteinte. Vous pouvez encore créer des vidéos « Plan drone ».`);
  }
  if (!reservation || !reservation.id) throw new Error('Réservation sans identifiant');
  const generationId = reservation.id;

  // 2. Lancement chez Seedance
  let taskId;
  try {
    taskId = await createVideoTask(body.image, { kind, variant, extraImages });
  } catch (err) {
    await markFailed(generationId, err && err.message);
    const status = err && typeof err.status === 'number' ? err.status : null;
    console.error('[droly-api:generate] Création de la vidéo refusée :', status, err && err.message);
    if (status === 400 || status === 422) {
      return fail(400, 'generation_rejected',
        'Cette photo a été refusée. Essayez une autre photo (JPEG ou PNG, format paysage).');
    }
    if (status === 429) {
      return fail(503, 'busy', 'Le service est très sollicité. Réessayez dans une minute.');
    }
    if (status === 401 || status === 403 || status === 404) {
      // Clé refusée, crédit épuisé ou modèle non activé chez le fournisseur :
      // le détail est dans les journaux Vercel (ligne ci-dessus).
      return fail(503, 'provider_unavailable',
        'Le service vidéo n’est pas disponible pour le moment (cette vidéo n’est pas décomptée). Réessayez un peu plus tard.');
    }
    throw err;
  }
  await updateGeneration(generationId, { status: 'pending', runway_task_id: taskId });

  // 3. Attente courte : la plupart des vidéos arrivent pendant ce temps.
  const generation = { id: generationId, user_id: user.id, title, kind, runway_task_id: taskId };
  const deadline = Date.now() + WAIT_BEFORE_HANDOFF_MS;
  while (Date.now() + POLL_INTERVAL_MS < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let result;
    try {
      result = await advance(generation);
    } catch (err) {
      console.error('[droly-api:generate] Suivi Seedance :', err && err.message);
      break; // la page reprendra le suivi
    }
    if (result.state === 'succeeded') return json({ video: result.video });
    if (result.state === 'failed') return fail(502, 'generation_failed', result.message);
  }

  // 4. Toujours en cours : la page continue le suivi.
  return json({ pending: true, generationId }, 202);
});
