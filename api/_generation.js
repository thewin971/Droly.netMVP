// Outils de génération partagés par /api/generate et /api/generation-status.
// (Le "_" empêche Vercel d'en faire une adresse publique.)
//
// Les vidéos sont fabriquées par Dreamina Seedance (ByteDance), via l'API
// BytePlus ModelArk.
//
// Principe : chaque vidéo demandée est inscrite dans la table "generations"
// AVANT d'appeler Seedance. Si la génération prend plus de temps que prévu
// (ou si le client ferme la page), elle n'est jamais perdue : la page
// redemande où elle en est via /api/generation-status, et la vidéo est rangée
// dans "Mes vidéos" dès qu'elle est prête.

import { env, supabaseAdmin } from './_shared.js';

// Deux types de vidéo :
//  - "travelling" (« Plan drone » côté client) : la caméra avance doucement
//    vers le bien ou dans la pièce (5 s) ;
//  - "tour" : la caméra fait un tour complet à 360° (10 s), autour de la maison
//    ou sur elle-même au milieu d'une pièce.
//
// Modèles par défaut (les moins chers avec un bon rendu en 720p) :
//  - plan drone : Seedance 1.0 Pro Fast (environ 0,10 $ la vidéo) ;
//  - tour : Dreamina Seedance 2.0 Mini (environ 0,75 $ le tour), car il accepte
//    une image de début ET de fin, plus des photos de référence.
// Pour en changer : variables SEEDANCE_MODEL et SEEDANCE_TOUR_MODEL dans Vercel
// (voir SETUP.md). Chez BytePlus, un pack de crédits ne sert qu'à SON modèle.
export const DEFAULT_MODEL = 'seedance-1-0-pro-fast-251015';
export const DEFAULT_TOUR_MODEL = 'dreamina-seedance-2-0-mini-260615';
const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

export const DURATIONS = { travelling: 5, tour: 10 };
export const MAX_EXTRA_IMAGES = 3;

// Consignes envoyées au modèle (en anglais : les modèles les suivent mieux).
export const DEFAULT_PROMPT =
  'Slow, smooth cinematic real estate camera movement gently moving forward through the room, ' +
  'stable and realistic, natural light, no people, no text, no logo.';

// Pour un tour, la même photo sert d'image de début ET de fin : la caméra doit
// donc faire le tour complet et revenir exactement à son point de départ.
export const TOUR_PROMPTS = {
  exterior:
    'Smooth, slow, continuous 360-degree drone orbit around the property: the building stays centered in the frame, ' +
    'the camera circles all the way around it and comes back exactly to the starting viewpoint. ' +
    'Stable and realistic, natural daylight, no people, no text, no logo.',
  interior:
    'Smooth, slow, continuous 360-degree camera rotation from the middle of the room, revealing the whole room: ' +
    'the camera turns all the way around and comes back exactly to the starting viewpoint. ' +
    'Stable and realistic, natural light, no people, no text, no logo.',
};
const REFERENCE_HINT =
  ' The reference photos show other views of the same place: keep every part of the scene consistent with them.';

export const POLL_INTERVAL_MS = 5000;
export const FAILED_MESSAGE =
  "La génération n'a pas abouti (elle n'est pas décomptée de votre quota). " +
  'Essayez avec une autre photo : bien éclairée, au format paysage.';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function videoModel(kind) {
  if (kind === 'tour') return env('SEEDANCE_TOUR_MODEL') || DEFAULT_TOUR_MODEL;
  return env('SEEDANCE_MODEL') || DEFAULT_MODEL;
}

// Anciens modèles 1.x : réglages écrits à la fin du texte (--resolution …).
const isLegacy = (model) => /^seedance-1/.test(model);

function baseUrl() {
  return (env('SEEDANCE_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

// Appel à l'API BytePlus ModelArk. En cas d'erreur, l'exception porte le
// code HTTP (err.status) et le code d'erreur BytePlus (err.code).
async function ark(path, init, timeoutMs) {
  const res = await fetch(baseUrl() + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env('SEEDANCE_API_KEY'),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const info = (data && data.error) || {};
    const err = new Error('Seedance ' + res.status + ' ' + (info.code || '') + ' ' + (info.message || text.slice(0, 200)));
    err.status = res.status;
    err.code = info.code || null;
    throw err;
  }
  return data;
}

// Prépare la demande envoyée à BytePlus ModelArk.
export function buildTaskBody({ model, kind, variant, image, extraImages }) {
  const tour = kind === 'tour';
  const legacy = isLegacy(model);
  const duration = tour ? DURATIONS.tour : DURATIONS.travelling;
  const refs = tour && !legacy ? (extraImages || []) : [];
  const text = (tour ? TOUR_PROMPTS[variant] || TOUR_PROMPTS.exterior : DEFAULT_PROMPT) + (refs.length ? REFERENCE_HINT : '');
  const photo = (role) => (role
    ? { type: 'image_url', image_url: { url: image }, role }
    : { type: 'image_url', image_url: { url: image } });
  const frames = tour
    ? [photo('first_frame'), photo('last_frame')]
    : [legacy ? photo(null) : photo('first_frame')];

  if (legacy) {
    return {
      model,
      content: [
        { type: 'text', text: text + ' --resolution 720p --ratio 16:9 --duration ' + duration + ' --watermark false' },
        ...frames,
      ],
    };
  }
  // Modèles Dreamina Seedance 2.x : réglages en champs séparés.
  return {
    model,
    content: [
      { type: 'text', text },
      ...frames,
      ...refs.map((url) => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })),
    ],
    resolution: '720p',
    ratio: '16:9',
    duration,
    watermark: false,
    generate_audio: false,
  };
}

// Lance une vidéo (720p, sans filigrane ni son) à partir d'une photo.
// options : { kind: 'travelling' | 'tour', variant: 'exterior' | 'interior', extraImages: [] }
// Renvoie l'identifiant de la tâche.
export async function createVideoTask(image, options = {}) {
  const kind = options.kind === 'tour' ? 'tour' : 'travelling';
  const variant = options.variant === 'interior' ? 'interior' : 'exterior';
  const extraImages = kind === 'tour' && Array.isArray(options.extraImages) ? options.extraImages : [];
  const model = videoModel(kind);
  const send = (refs) => ark(
    '/contents/generations/tasks',
    { method: 'POST', body: JSON.stringify(buildTaskBody({ model, kind, variant, image, extraImages: refs })) },
    45000
  );

  let data;
  try {
    data = await send(extraImages);
  } catch (err) {
    // Si le modèle refuse les photos de référence en plus des images de début
    // et de fin, on relance le tour avec la photo principale seule.
    if (err.status === 400 && extraImages.length && !isLegacy(model)) {
      console.error('[droly-api] Photos de référence refusées, nouvel essai sans elles :', err.message);
      data = await send([]);
    } else {
      throw err;
    }
  }
  if (!data || !data.id) throw new Error('Réponse Seedance sans identifiant de tâche');
  return data.id;
}

async function getVideoTask(id) {
  return ark('/contents/generations/tasks/' + encodeURIComponent(id), { method: 'GET' }, 20000);
}

export async function updateGeneration(id, fields) {
  const { error } = await supabaseAdmin()
    .from('generations')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error('Mise à jour génération impossible : ' + error.message);
}

export async function markFailed(id, reason) {
  try {
    await updateGeneration(id, { status: 'failed', error: String(reason || 'échec').slice(0, 500) });
  } catch (err) {
    console.error('[droly-api] markFailed :', err && err.message);
  }
}

async function claim(id) {
  const { data, error } = await supabaseAdmin().rpc('claim_generation', { p_id: id });
  if (error) throw new Error('Réservation de finalisation impossible : ' + error.message);
  return Array.isArray(data) ? data[0] || null : data || null;
}

// Vidéo terminée → fichier dans le stockage privé du client → entrée dans
// "Mes vidéos". Peut être relancée sans créer de doublon.
async function finalize(generation, videoUrl) {
  const db = supabaseAdmin();
  const download = await fetch(videoUrl, { signal: AbortSignal.timeout(25000) });
  if (!download.ok) {
    const err = new Error('Téléchargement de la vidéo impossible (' + download.status + ')');
    err.permanent = [403, 404, 410].includes(download.status); // lien expiré
    throw err;
  }
  const bytes = new Uint8Array(await download.arrayBuffer());
  const storagePath = `${generation.user_id}/${generation.id}.mp4`;

  const upload = await db.storage
    .from('videos')
    .upload(storagePath, bytes, { contentType: 'video/mp4', upsert: true });
  if (upload.error) throw new Error('Enregistrement du fichier impossible : ' + upload.error.message);

  const { data: video, error } = await db
    .from('videos')
    .upsert(
      {
        id: generation.id, user_id: generation.user_id, title: generation.title,
        storage_path: storagePath, kind: generation.kind === 'tour' ? 'tour' : 'travelling',
      },
      { onConflict: 'id' }
    )
    .select()
    .single();
  if (error) throw new Error('Enregistrement de la vidéo impossible : ' + error.message);

  await updateGeneration(generation.id, { status: 'succeeded', video_id: video.id, error: null });
  return video;
}

// Fait avancer une génération dont la tâche Seedance existe.
// (La colonne s'appelle runway_task_id pour rester compatible avec les bases
// déjà créées ; elle contient l'identifiant de la tâche Seedance.)
// Renvoie { state: 'succeeded', video } | { state: 'failed', message } | { state: 'pending' }
export async function advance(generation) {
  let task;
  try {
    task = await getVideoTask(generation.runway_task_id);
  } catch (err) {
    if (err.status === 404) {
      await markFailed(generation.id, 'Tâche Seedance introuvable');
      return { state: 'failed', message: FAILED_MESSAGE };
    }
    throw err;
  }

  if (task.status === 'succeeded') {
    const url = task.content && task.content.video_url;
    if (!url) {
      await markFailed(generation.id, 'Réponse Seedance sans vidéo');
      return { state: 'failed', message: FAILED_MESSAGE };
    }
    const claimed = await claim(generation.id);
    if (!claimed) return { state: 'pending' }; // une autre requête s'en occupe déjà
    try {
      return { state: 'succeeded', video: await finalize(claimed, url) };
    } catch (err) {
      if (err.permanent) {
        await markFailed(generation.id, err.message);
        return { state: 'failed', message: FAILED_MESSAGE };
      }
      await updateGeneration(generation.id, { status: 'pending' }).catch(() => {});
      throw err;
    }
  }

  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
    console.error('[droly-api] Seedance a échoué :', task.status, JSON.stringify(task.error || null));
    await markFailed(generation.id, (task.error && task.error.message) || task.status);
    return { state: 'failed', message: FAILED_MESSAGE };
  }

  return { state: 'pending' }; // queued / running
}
