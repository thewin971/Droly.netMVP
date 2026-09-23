// POST /api/free-trial   body : { email, image? , listingUrl? }
//
// La vidéo gratuite de la page d'accueil : une vraie vidéo « Plan drone » de 5 s,
// sans compte et sans carte bancaire. Les garde-fous (un essai par email, un par
// connexion et par jour, plafond quotidien pour tout le site) sont décrits dans
// _trial.js et appliqués par la base de données, donc impossibles à contourner.

import {
  checkImage, configError, fail, handler, ipFingerprint, json, limits, supabaseAdmin,
} from './_shared.js';
import { createVideoTask, POLL_INTERVAL_MS, sleep } from './_generation.js';
import { advanceTrial, markTrialFailed, updateTrial } from './_trial.js';
import { fetchListingPhotos } from './_listing.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const WAIT_BEFORE_HANDOFF_MS = 30000;

export default handler('free-trial', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const missing = configError(['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SEEDANCE_API_KEY']);
  if (missing) return missing;

  const { freeTrialsPerDay } = limits();
  if (!freeTrialsPerDay) {
    return fail(403, 'trial_closed', 'L’essai gratuit n’est pas disponible pour le moment. Créez votre compte pour générer vos vidéos.');
  }

  const body = await request.json().catch(() => null);
  if (!body) return fail(400, 'bad_request', 'Requête invalide.');

  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 160) : '';
  if (!EMAIL.test(email)) return fail(400, 'bad_email', 'Indiquez une adresse email valide.');

  // La photo vient du visiteur ; à défaut, on essaie de la trouver sur la page
  // de l'annonce (beaucoup de sites l'interdisent : on le dit alors clairement).
  let image = typeof body.image === 'string' && body.image ? body.image : '';
  if (image) {
    const imageError = checkImage(image);
    if (imageError) return fail(400, 'bad_image', imageError);
  } else if (typeof body.listingUrl === 'string' && body.listingUrl.trim()) {
    const found = await fetchListingPhotos(body.listingUrl.trim());
    image = found.photos[0] || '';
    if (!image) {
      return fail(400, 'no_photo',
        'Ce site ne laisse pas récupérer ses photos automatiquement. Ajoutez une photo de votre annonce (elle reste sur votre téléphone jusqu’à l’envoi).');
    }
  }
  if (!image) return fail(400, 'bad_image', 'Ajoutez une photo de votre annonce.');

  const ipHash = await ipFingerprint(request);
  const { data: reservation, error: reserveError } = await supabaseAdmin().rpc('reserve_free_trial', {
    p_email: email, p_email_key: email.toLowerCase(), p_ip_hash: ipHash, p_daily_total: freeTrialsPerDay,
  });
  if (reserveError) throw new Error('Réservation impossible : ' + reserveError.message);
  if (reservation && reservation.error === 'email_used') {
    return fail(429, 'email_used',
      'Cette adresse a déjà reçu sa vidéo gratuite. Créez votre compte pour en générer autant que vous voulez.');
  }
  if (reservation && reservation.error === 'ip_used') {
    return fail(429, 'ip_used',
      'Une vidéo gratuite a déjà été créée depuis cette connexion aujourd’hui. Créez votre compte pour continuer.');
  }
  if (reservation && reservation.error === 'daily_full') {
    return fail(429, 'daily_full',
      'Les vidéos gratuites du jour sont toutes prises. Revenez demain, ou créez votre compte pour générer tout de suite.');
  }
  if (!reservation || !reservation.id) throw new Error('Réservation sans identifiant');
  const trialId = reservation.id;

  let taskId;
  try {
    taskId = await createVideoTask(image, { kind: 'travelling' });
  } catch (err) {
    await markTrialFailed(trialId, err && err.message);
    const status = err && typeof err.status === 'number' ? err.status : null;
    console.error('[droly-api:free-trial] Création Seedance refusée :', status, err && err.message);
    if (status === 400 || status === 422) {
      return fail(400, 'generation_rejected',
        'Cette photo a été refusée (votre essai gratuit reste disponible). Essayez une autre photo, au format paysage.');
    }
    if (status === 429) return fail(503, 'busy', 'Le service est très sollicité. Réessayez dans une minute.');
    throw err;
  }
  await updateTrial(trialId, { status: 'pending', task_id: taskId });

  const trial = { id: trialId, status: 'pending', task_id: taskId };
  const deadline = Date.now() + WAIT_BEFORE_HANDOFF_MS;
  while (Date.now() + POLL_INTERVAL_MS < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let result;
    try {
      result = await advanceTrial(trial);
    } catch (err) {
      console.error('[droly-api:free-trial] Suivi Seedance :', err && err.message);
      break; // la page reprendra le suivi
    }
    if (result.state === 'succeeded') return json({ video: result.video });
    if (result.state === 'failed') return fail(502, 'generation_failed', result.message);
  }

  return json({ pending: true, trialId }, 202);
});
