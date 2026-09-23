// POST /api/free-trial-status   body : { trialId }
//
// Suit la vidéo gratuite lancée depuis la page d'accueil, sans compte : la page
// rappelle toutes les 5 secondes jusqu'à ce que la vidéo soit prête. L'identifiant
// est tiré au hasard et impossible à deviner.

import { configError, fail, handler, json } from './_shared.js';
import { advanceTrial, getTrial, TRIAL_FAILED_MESSAGE } from './_trial.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Une tâche sans identifiant Seedance au bout de 3 minutes ne viendra plus.
const STUCK_MS = 3 * 60 * 1000;

export default handler('free-trial-status', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const missing = configError(['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SEEDANCE_API_KEY']);
  if (missing) return missing;

  const body = await request.json().catch(() => null);
  if (!body || !UUID.test(String(body.trialId || ''))) {
    return fail(400, 'bad_request', 'Demande invalide.');
  }

  const trial = await getTrial(body.trialId);
  if (!trial) return fail(404, 'not_found', 'Essai introuvable.');

  if (!trial.task_id && Date.parse(trial.created_at) < Date.now() - STUCK_MS) {
    return json({ failed: true, message: TRIAL_FAILED_MESSAGE });
  }

  const result = await advanceTrial(trial);
  if (result.state === 'succeeded') return json({ video: result.video });
  if (result.state === 'failed') return json({ failed: true, message: result.message });
  return json({ pending: true });
});
