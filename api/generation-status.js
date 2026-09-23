// POST /api/generation-status   body : { generationId }
// Où en est une vidéo ? Appelé par la page toutes les 5 secondes pendant une
// génération, et au chargement de l'espace client pour reprendre les
// générations laissées en cours (page fermée, réseau coupé…).
// Réponses : { video } | { failed: true, message } | { pending: true }

import { configError, fail, getUser, handler, json, supabaseAdmin } from './_shared.js';
import { advance, FAILED_MESSAGE, markFailed } from './_generation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_RESERVATION_MS = 3 * 60 * 1000;

export default handler('generation-status', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const missing = configError([
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SEEDANCE_API_KEY',
  ]);
  if (missing) return missing;

  const user = await getUser(request);
  if (!user) return fail(401, 'unauthorized', 'Connectez-vous pour continuer.');

  const body = await request.json().catch(() => ({}));
  const id = body && typeof body.generationId === 'string' ? body.generationId : '';
  if (!UUID.test(id)) return fail(400, 'bad_request', 'Identifiant invalide.');

  const db = supabaseAdmin();
  const { data: generation, error } = await db
    .from('generations')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id) // uniquement ses propres générations
    .maybeSingle();
  if (error) throw new Error('Lecture génération impossible : ' + error.message);
  if (!generation) return fail(404, 'not_found', 'Génération introuvable.');

  if (generation.status === 'succeeded') {
    const { data: video } = await db.from('videos').select('*').eq('id', generation.video_id).maybeSingle();
    return video ? json({ video }) : json({ gone: true }); // vidéo supprimée depuis
  }
  if (generation.status === 'failed') return json({ failed: true, message: FAILED_MESSAGE });

  if (!generation.runway_task_id) {
    // Réservée mais jamais envoyée à Seedance (coupure au mauvais moment).
    if (Date.now() - Date.parse(generation.created_at) > STALE_RESERVATION_MS) {
      await markFailed(generation.id, 'Jamais envoyée à Seedance');
      return json({ failed: true, message: FAILED_MESSAGE });
    }
    return json({ pending: true });
  }

  const result = await advance(generation);
  if (result.state === 'succeeded') return json({ video: result.video });
  if (result.state === 'failed') return json({ failed: true, message: result.message });
  return json({ pending: true });
});
