// Essai gratuit de la page d'accueil : une vraie vidéo, offerte une fois.
// Le "_" empêche Vercel d'en faire une adresse publique.
//
// Garde-fous (tous côté serveur, impossibles à contourner depuis le navigateur) :
//   1. une seule vidéo par adresse email ;
//   2. une seule par connexion (empreinte de l'adresse IP) toutes les 24 h ;
//   3. un plafond pour tout le site (FREE_TRIALS_PER_DAY, 20 par défaut) :
//      quoi qu'il arrive, la dépense d'une journée est connue d'avance.

import { supabaseAdmin } from './_shared.js';
import { signedVideoUrl, storeVideo, taskState } from './_generation.js';

export const TRIAL_FAILED_MESSAGE =
  "La vidéo n'a pas pu être créée avec cette photo (votre essai gratuit reste disponible). " +
  'Réessayez avec une autre photo : bien éclairée, au format paysage.';

export const trialPath = (id) => `free/${id}.mp4`;

export async function getTrial(id) {
  const { data, error } = await supabaseAdmin()
    .from('free_trials')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Essai introuvable : ' + error.message);
  return data;
}

export async function updateTrial(id, fields) {
  const { error } = await supabaseAdmin()
    .from('free_trials')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error('Mise à jour de l’essai impossible : ' + error.message);
}

// Un essai raté est marqué "failed" : il ne compte ni dans le plafond du jour,
// ni contre le visiteur, qui peut donc réessayer.
export async function markTrialFailed(id, reason) {
  try {
    await updateTrial(id, { status: 'failed', error: String(reason || 'échec').slice(0, 500) });
  } catch (err) {
    console.error('[droly-api] markTrialFailed :', err && err.message);
  }
}

export async function trialVideoLinks(id) {
  const path = trialPath(id);
  return {
    url: await signedVideoUrl(path, 3600),
    downloadUrl: await signedVideoUrl(path, 3600, 'droly-essai-gratuit.mp4'),
  };
}

// Où en est l'essai ? Range la vidéo dès qu'elle est prête.
// { state: 'succeeded', video } | { state: 'failed', message } | { state: 'pending' }
export async function advanceTrial(trial) {
  if (trial.status === 'succeeded') return { state: 'succeeded', video: await trialVideoLinks(trial.id) };
  if (trial.status === 'failed') return { state: 'failed', message: TRIAL_FAILED_MESSAGE };
  if (!trial.task_id) return { state: 'pending' };

  const result = await taskState(trial.task_id);
  if (result.state === 'pending') return { state: 'pending' };
  if (result.state === 'failed') {
    console.error('[droly-api] essai gratuit échoué :', result.reason);
    await markTrialFailed(trial.id, result.reason);
    return { state: 'failed', message: TRIAL_FAILED_MESSAGE };
  }

  const path = trialPath(trial.id);
  try {
    await storeVideo(path, result.url);
  } catch (err) {
    if (err.permanent) {
      await markTrialFailed(trial.id, err.message);
      return { state: 'failed', message: TRIAL_FAILED_MESSAGE };
    }
    throw err;
  }
  await updateTrial(trial.id, { status: 'succeeded', storage_path: path, error: null });
  return { state: 'succeeded', video: await trialVideoLinks(trial.id) };
}
