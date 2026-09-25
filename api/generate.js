// POST /api/generate   body : { image, title?, kind?, variant?, extraImages?, images?, format?, logo? }
//   image       : lien direct https vers une photo, OU photo envoyée depuis
//                 l'appareil (data:image/jpeg;base64,...)
//   kind        : 'travelling' = plan drone (5 s, par défaut), 'tour' (tour complet à 360°, 10 s)
//                 ou 'visit' (visite complète : un plan par photo, enchaînés en une vidéo)
//   variant     : pour un tour, 'exterior' (autour de la maison) ou 'interior' (dans une pièce)
//   extraImages : pour un tour, jusqu'à 3 autres photos du même endroit (rendu plus fidèle)
//   images      : pour une visite complète, 2 à 6 photos dans l'ordre de la visite
//   format      : 'landscape' (16:9, par défaut) ou 'vertical' (9:16 : Reels, TikTok)
//   logo        : true pour incruster le logo de l'agence (déposé via /api/logo)
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
  advance, cleanFormat, createVideoTask, createVisitTasks, loadLogo, markFailed, MAX_EXTRA_IMAGES,
  POLL_INTERVAL_MS, sleep, updateGeneration, VIDEO_KINDS, videoKeyName, VISIT_MAX_IMAGES, VISIT_MIN_IMAGES,
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

  const kind = body.kind === undefined || body.kind === null || body.kind === '' ? 'travelling' : body.kind;
  if (!VIDEO_KINDS.includes(kind)) return fail(400, 'bad_kind', 'Type de vidéo inconnu.');
  if (body.format !== undefined && body.format !== null && body.format !== ''
      && body.format !== 'landscape' && body.format !== 'vertical') {
    return fail(400, 'bad_format', 'Format inconnu (paysage ou vertical).');
  }
  const format = cleanFormat(body.format);
  const withLogo = body.logo === true;

  let visitImages = [];
  if (kind === 'visit') {
    if (!Array.isArray(body.images) || body.images.length < VISIT_MIN_IMAGES) {
      return fail(400, 'bad_image', `Ajoutez au moins ${VISIT_MIN_IMAGES} photos pour une visite complète.`);
    }
    if (body.images.length > VISIT_MAX_IMAGES) {
      return fail(400, 'too_many_images', `${VISIT_MAX_IMAGES} photos au maximum pour une visite complète.`);
    }
    for (let i = 0; i < body.images.length; i++) {
      const err = checkImage(body.images[i]);
      if (err) return fail(400, 'bad_image', `Photo ${i + 1} : ${err}`);
    }
    visitImages = body.images;
  } else {
    const imageError = checkImage(body.image);
    if (imageError) return fail(400, 'bad_image', imageError);
  }
  if (withLogo && !(await loadLogo(user.id).catch(() => null))) {
    return fail(400, 'no_logo', 'Ajoutez d’abord le logo de votre agence (bouton « Ajouter un logo »).');
  }
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
    ({ tour: 'Tour 360° du ', visit: 'Visite complète du ' }[kind] || 'Vidéo du ') + day;

  // Réservation atomique : impossible de dépasser les limites, même avec
  // plusieurs demandes simultanées.
  const { perDay, perMonth, toursPerMonth, visitsPerMonth } = limits();
  const options = { format, logo: withLogo };
  if (kind === 'visit') options.photos = visitImages.length;
  const { data: reservation, error: reserveError } = await supabaseAdmin().rpc('reserve_generation', {
    p_user: user.id, p_title: title, p_daily: perDay, p_monthly: perMonth,
    p_kind: kind, p_tour_monthly: toursPerMonth, p_visit_monthly: visitsPerMonth, p_options: options,
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
  if (reservation && reservation.error === 'visit_limit') {
    return fail(429, 'visit_limit',
      `Limite de ${visitsPerMonth} visites complètes sur 30 jours atteinte. Vous pouvez encore créer des vidéos « Plan drone ».`);
  }
  if (!reservation || !reservation.id) throw new Error('Réservation sans identifiant');
  const generationId = reservation.id;

  // 2. Lancement chez Seedance
  let taskId;
  try {
    taskId = kind === 'visit'
      ? await createVisitTasks(visitImages, { format })
      : await createVideoTask(body.image, { kind, variant, extraImages, format });
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
  // Une visite complète (plusieurs plans + montage) prend plusieurs minutes :
  // la page prend le relais tout de suite.
  const deadline = Date.now() + (kind === 'visit' ? 0 : WAIT_BEFORE_HANDOFF_MS);
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
