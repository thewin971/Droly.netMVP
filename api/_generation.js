// Outils de génération partagés par /api/generate et /api/generation-status.
// (Le "_" empêche Vercel d'en faire une adresse publique.)
//
// Les vidéos sont fabriquées par les modèles Seedance (ByteDance), chez l'un
// de ces deux fournisseurs :
//  - fal.ai : utilisé dès que la variable FAL_KEY est renseignée dans Vercel
//    (pas de numéro de TVA demandé, tours à 360° moins chers) ;
//  - BytePlus ModelArk : utilisé sinon, avec la variable SEEDANCE_API_KEY.
// Une vidéo lancée chez l'un est toujours suivie chez le même, même si tu
// changes de fournisseur entre-temps (l'identifiant de tâche le mémorise).
//
// Principe : chaque vidéo demandée est inscrite dans la table "generations"
// AVANT d'appeler Seedance. Si la génération prend plus de temps que prévu
// (ou si le client ferme la page), elle n'est jamais perdue : la page
// redemande où elle en est via /api/generation-status, et la vidéo est rangée
// dans "Mes vidéos" dès qu'elle est prête.

import { env, supabaseAdmin } from './_shared.js';
import { editVideo } from './_video.js';

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

// Chez fal.ai (variables FAL_MODEL et FAL_TOUR_MODEL pour en changer) :
//  - plan drone : Seedance 1.0 Pro Fast (environ 0,11 $ la vidéo de 5 s en 720p) ;
//  - tour : Seedance 1.5 Pro sans son (environ 0,26 $ le tour de 10 s en 720p),
//    qui accepte une image de début ET de fin. Les photos de référence
//    supplémentaires ne sont pas utilisées chez ce fournisseur.
export const FAL_DEFAULT_MODEL = 'fal-ai/bytedance/seedance/v1/pro/fast/image-to-video';
export const FAL_DEFAULT_TOUR_MODEL = 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video';
const FAL_QUEUE = 'https://queue.fal.run/';
const FAL_PREFIX = 'fal:';

export function videoProvider() {
  return env('FAL_KEY') ? 'fal' : 'byteplus';
}

// Nom de la clé vidéo à exiger : celle qui est renseignée, sinon FAL_KEY
// (le fournisseur conseillé), pour que le message d'erreur soit clair.
export function videoKeyName() {
  if (env('FAL_KEY')) return 'FAL_KEY';
  if (env('SEEDANCE_API_KEY')) return 'SEEDANCE_API_KEY';
  return 'FAL_KEY';
}

export const DURATIONS = { travelling: 5, tour: 10 };
export const MAX_EXTRA_IMAGES = 3;

// Visite complète : une vidéo « plan drone » par photo, puis montage en une
// seule vidéo (voir _video.js). Entre 2 et 6 photos.
export const VISIT_MIN_IMAGES = 2;
export const VISIT_MAX_IMAGES = 6;

// Formats : paysage (16:9, par défaut) ou vertical (9:16 : Reels, TikTok, stories).
export const RATIOS = { landscape: '16:9', vertical: '9:16' };
export const cleanFormat = (format) => (format === 'vertical' ? 'vertical' : 'landscape');

// Logo de l'agence : un seul fichier par client, dans son dossier du stockage.
export const logoPath = (userId) => `${userId}/logo`;

// Consignes envoyées au modèle (en anglais : les modèles les suivent mieux).
// Plan drone : un vrai mouvement de caméra bien visible (et pas un simple
// zoom lent), qui marche aussi bien pour une façade que pour une pièce.
export const DEFAULT_PROMPT =
  'Cinematic real estate drone shot with clear, continuous camera motion from the first frame: ' +
  'the camera glides steadily forward into the scene while rising slightly and arcing to one side, ' +
  'creating strong parallax and depth, like a professional drone or gimbal fly-through. ' +
  'Smooth and stable, straight architecture, realistic, natural light, no people, no text, no logo.';

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
  if (videoProvider() === 'fal') {
    if (kind === 'tour') return env('FAL_TOUR_MODEL') || FAL_DEFAULT_TOUR_MODEL;
    return env('FAL_MODEL') || FAL_DEFAULT_MODEL;
  }
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

// Une photo venant d'une annonce est hébergée sur le site de l'annonce : on la
// télécharge nous-mêmes et on l'envoie directement à Seedance, sinon certains
// hébergeurs refusent la demande de Seedance et la vidéo échoue.
const MAX_REMOTE_IMAGE = 4 * 1024 * 1024;

export async function inlineRemoteImage(image) {
  if (typeof image !== 'string' || !/^https?:/i.test(image)) return image;
  try {
    const res = await fetch(image, {
      headers: { Accept: 'image/*', 'User-Agent': 'DrolyBot/1.0 (+https://droly.fr)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(type)) throw new Error('type ' + type);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_REMOTE_IMAGE) throw new Error('taille ' + bytes.length);
    return 'data:' + (type === 'image/jpg' ? 'image/jpeg' : type) + ';base64,' + Buffer.from(bytes).toString('base64');
  } catch (err) {
    // Tant pis : on laisse Seedance essayer de la télécharger lui-même.
    console.error('[droly-api] photo distante non récupérée :', err && err.message);
    return image;
  }
}

// ---------------------------------------------------------------------------
// fal.ai
// ---------------------------------------------------------------------------

// Appel à l'API fal.ai (file d'attente). En cas d'erreur, l'exception porte le
// code HTTP (err.status).
async function falFetch(url, init, timeoutMs) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + env('FAL_KEY') },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const detail = data && (data.detail || data.error || data.message);
    const info = typeof detail === 'string' ? detail : JSON.stringify(detail || text.slice(0, 200));
    const err = new Error('fal ' + res.status + ' ' + String(info).slice(0, 300));
    err.status = res.status;
    throw err;
  }
  return data;
}

// Prépare la demande envoyée à fal.ai.
export function buildFalBody({ model, kind, variant, image, format }) {
  const tour = kind === 'tour';
  const body = {
    prompt: tour ? TOUR_PROMPTS[variant] || TOUR_PROMPTS.exterior : DEFAULT_PROMPT,
    image_url: image,
    resolution: '720p',
    aspect_ratio: RATIOS[cleanFormat(format)],
    duration: String(tour ? DURATIONS.tour : DURATIONS.travelling),
    enable_safety_checker: true,
  };
  // Même photo au début et à la fin : la caméra fait le tour complet.
  if (tour) body.end_image_url = image;
  // Les modèles récents ajoutent du son par défaut (plus cher) : on le coupe.
  if (/v1\.5|seedance-2|seedance\/v2/.test(model)) body.generate_audio = false;
  return body;
}

// Adresse du résultat d'une tâche fal.ai (seules les adresses de fal.ai sont
// acceptées : la clé n'est jamais envoyée ailleurs).
function falResponseUrl(taskId) {
  const url = String(taskId).slice(FAL_PREFIX.length);
  return url.startsWith(FAL_QUEUE) && !/[\s?#]/.test(url) ? url.replace(/\/+$/, '') : null;
}

async function createFalTask(model, kind, variant, image, extraCount, format) {
  if (extraCount) console.error('[droly-api] fal.ai : photos de référence ignorées pour ce tour :', extraCount);
  const data = await falFetch(FAL_QUEUE + model, {
    method: 'POST', body: JSON.stringify(buildFalBody({ model, kind, variant, image, format })),
  }, 45000);
  let responseUrl = data && typeof data.response_url === 'string' ? data.response_url : '';
  if (!responseUrl && data && data.request_id) {
    const app = model.split('/').slice(0, 2).join('/');
    responseUrl = FAL_QUEUE + app + '/requests/' + encodeURIComponent(data.request_id);
  }
  const taskId = FAL_PREFIX + responseUrl;
  if (!responseUrl || !falResponseUrl(taskId)) throw new Error('Réponse fal.ai sans identifiant de tâche');
  return taskId;
}

async function falTaskState(taskId) {
  const responseUrl = falResponseUrl(taskId);
  if (!responseUrl) return { state: 'failed', reason: 'Identifiant de tâche fal.ai invalide' };
  let status;
  try {
    status = await falFetch(responseUrl + '/status', { method: 'GET' }, 20000);
  } catch (err) {
    if (err.status === 404) return { state: 'failed', reason: 'Tâche fal.ai introuvable' };
    throw err;
  }
  if (!status || status.status !== 'COMPLETED') return { state: 'pending' }; // IN_QUEUE / IN_PROGRESS
  if (status.error) return { state: 'failed', reason: String(status.error).slice(0, 300) };

  let result;
  try {
    result = await falFetch(responseUrl, { method: 'GET' }, 20000);
  } catch (err) {
    // La tâche est terminée : une erreur ici veut dire qu'elle a échoué
    // (sauf surcharge passagère ou coupure réseau, où l'on réessaiera).
    if (typeof err.status === 'number' && err.status !== 429) return { state: 'failed', reason: err.message };
    throw err;
  }
  const url = result && result.video && result.video.url;
  return url ? { state: 'succeeded', url } : { state: 'failed', reason: 'Réponse fal.ai sans vidéo' };
}

// ---------------------------------------------------------------------------
// BytePlus ModelArk
// ---------------------------------------------------------------------------

// Prépare la demande envoyée à BytePlus ModelArk.
export function buildTaskBody({ model, kind, variant, image, extraImages, format }) {
  const tour = kind === 'tour';
  const ratio = RATIOS[cleanFormat(format)];
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
        { type: 'text', text: text + ' --resolution 720p --ratio ' + ratio + ' --duration ' + duration + ' --watermark false' },
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
    ratio,
    duration,
    watermark: false,
    generate_audio: false,
  };
}

// Lance une vidéo (720p, sans filigrane ni son) à partir d'une photo.
// options : { kind: 'travelling' | 'tour', variant: 'exterior' | 'interior',
//             extraImages: [], format: 'landscape' | 'vertical' }
// Renvoie l'identifiant de la tâche.
export async function createVideoTask(rawImage, options = {}) {
  const kind = options.kind === 'tour' ? 'tour' : 'travelling';
  const variant = options.variant === 'interior' ? 'interior' : 'exterior';
  const format = cleanFormat(options.format);
  const rawExtras = kind === 'tour' && Array.isArray(options.extraImages) ? options.extraImages : [];
  const [image, ...extraImages] = await Promise.all([rawImage, ...rawExtras].map(inlineRemoteImage));
  const model = videoModel(kind);
  if (videoProvider() === 'fal') return createFalTask(model, kind, variant, image, extraImages.length, format);
  const send = (refs) => ark(
    '/contents/generations/tasks',
    { method: 'POST', body: JSON.stringify(buildTaskBody({ model, kind, variant, image, extraImages: refs, format })) },
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

// Visite complète : un plan drone par photo, lancés tous en même temps.
// Une photo refusée est simplement sautée ; si toutes le sont, l'erreur de la
// première remonte (même traitement qu'une vidéo simple).
// Renvoie un identifiant groupé : "multi:" + la liste des tâches, dans l'ordre.
const MULTI_PREFIX = 'multi:';

export async function createVisitTasks(images, options = {}) {
  const format = cleanFormat(options.format);
  const results = await Promise.allSettled(
    images.map((image) => createVideoTask(image, { kind: 'travelling', format }))
  );
  const ids = [];
  let firstError = null;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ids.push(r.value);
    else {
      firstError = firstError || r.reason;
      console.error('[droly-api] Visite : photo ' + (i + 1) + ' refusée :', r.reason && r.reason.message);
    }
  });
  if (!ids.length) throw firstError || new Error('Aucune vidéo lancée');
  return MULTI_PREFIX + JSON.stringify(ids);
}

function multiIds(taskId) {
  try {
    const ids = JSON.parse(String(taskId).slice(MULTI_PREFIX.length));
    return Array.isArray(ids) && ids.length && ids.every((id) => typeof id === 'string') ? ids : null;
  } catch {
    return null;
  }
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

// Où en est une tâche Seedance ? (utilisé par les vidéos des abonnés et par
// les essais gratuits de la page d'accueil)
// Renvoie { state: 'succeeded', url } | { state: 'failed', reason } | { state: 'pending' }
export async function taskState(taskId) {
  if (String(taskId).startsWith(MULTI_PREFIX)) {
    // Visite complète : prête quand tous les plans sont terminés ; les plans
    // ratés sont laissés de côté, la visite n'échoue que s'ils ratent tous.
    const ids = multiIds(taskId);
    if (!ids) return { state: 'failed', reason: 'Identifiant de visite invalide' };
    const states = await Promise.all(ids.map((id) => taskState(id)));
    if (states.some((st) => st.state === 'pending')) return { state: 'pending' };
    const urls = states.filter((st) => st.state === 'succeeded').map((st) => st.url);
    if (!urls.length) return { state: 'failed', reason: states[0].reason || 'Tous les plans ont échoué' };
    if (urls.length < ids.length) console.error('[droly-api] Visite : ' + (ids.length - urls.length) + ' plan(s) raté(s), montage avec les autres');
    return { state: 'succeeded', url: urls[0], urls };
  }
  if (String(taskId).startsWith(FAL_PREFIX)) return falTaskState(taskId);
  let task;
  try {
    task = await getVideoTask(taskId);
  } catch (err) {
    if (err.status === 404) return { state: 'failed', reason: 'Tâche Seedance introuvable' };
    throw err;
  }
  if (task.status === 'succeeded') {
    const url = task.content && task.content.video_url;
    return url ? { state: 'succeeded', url } : { state: 'failed', reason: 'Réponse Seedance sans vidéo' };
  }
  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
    return { state: 'failed', reason: (task.error && task.error.message) || task.status };
  }
  return { state: 'pending' };
}

async function downloadVideo(videoUrl) {
  const download = await fetch(videoUrl, { signal: AbortSignal.timeout(25000) });
  if (!download.ok) {
    const err = new Error('Téléchargement de la vidéo impossible (' + download.status + ')');
    err.permanent = [403, 404, 410].includes(download.status); // lien expiré
    throw err;
  }
  return new Uint8Array(await download.arrayBuffer());
}

async function uploadVideo(storagePath, bytes) {
  const upload = await supabaseAdmin().storage
    .from('videos')
    .upload(storagePath, bytes, { contentType: 'video/mp4', upsert: true });
  if (upload.error) throw new Error('Enregistrement du fichier impossible : ' + upload.error.message);
}

// Télécharge la vidéo finie et la range dans le stockage privé.
export async function storeVideo(storagePath, videoUrl) {
  await uploadVideo(storagePath, await downloadVideo(videoUrl));
}

// Logo du client (octets), ou null s'il n'en a pas.
export async function loadLogo(userId) {
  const { data, error } = await supabaseAdmin().storage.from('videos').download(logoPath(userId));
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  return bytes.length ? bytes : null;
}

// Monte puis range une vidéo : plusieurs plans (visite complète) et/ou logo.
// Si seul le logo pose problème, la vidéo est rangée sans lui plutôt que perdue.
export async function storeEditedVideo(storagePath, videoUrls, { format, userId, withLogo }) {
  const clips = [];
  for (const url of videoUrls) clips.push(await downloadVideo(url));
  const logo = withLogo ? await loadLogo(userId).catch(() => null) : null;
  if (clips.length === 1 && !logo) return uploadVideo(storagePath, clips[0]);
  let edited;
  try {
    edited = await editVideo({ clips, logo, format: cleanFormat(format) });
  } catch (err) {
    console.error('[droly-api] Montage :', err && err.message);
    if (clips.length === 1) return uploadVideo(storagePath, clips[0]); // sans le logo
    err.permanent = true; // un montage impossible le restera : pas de boucle infinie
    throw err;
  }
  return uploadVideo(storagePath, edited);
}

// Lien de lecture (ou de téléchargement) temporaire vers une vidéo rangée.
export async function signedVideoUrl(storagePath, seconds = 3600, downloadName) {
  const { data, error } = await supabaseAdmin().storage
    .from('videos')
    .createSignedUrl(storagePath, seconds, downloadName ? { download: downloadName } : undefined);
  if (error) throw new Error('Lien de la vidéo impossible : ' + error.message);
  return data.signedUrl;
}

// Vidéo terminée → fichier dans le stockage privé du client → entrée dans
// "Mes vidéos". Peut être relancée sans créer de doublon.
export const VIDEO_KINDS = ['travelling', 'tour', 'visit'];
const cleanKind = (kind) => (VIDEO_KINDS.includes(kind) ? kind : 'travelling');

async function finalize(generation, result) {
  const db = supabaseAdmin();
  const storagePath = `${generation.user_id}/${generation.id}.mp4`;
  const options = generation.options && typeof generation.options === 'object' ? generation.options : {};
  const urls = result.urls && result.urls.length ? result.urls : [result.url];
  if (urls.length === 1 && !options.logo) {
    await storeVideo(storagePath, urls[0]);
  } else {
    await storeEditedVideo(storagePath, urls, { format: options.format, userId: generation.user_id, withLogo: !!options.logo });
  }

  const { data: video, error } = await db
    .from('videos')
    .upsert(
      {
        id: generation.id, user_id: generation.user_id, title: generation.title,
        storage_path: storagePath, kind: cleanKind(generation.kind),
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
  const result = await taskState(generation.runway_task_id);
  if (result.state === 'pending') return { state: 'pending' }; // en file d'attente / en cours

  if (result.state === 'failed') {
    console.error('[droly-api] La vidéo a échoué :', result.reason);
    await markFailed(generation.id, result.reason);
    return { state: 'failed', message: FAILED_MESSAGE };
  }

  const claimed = await claim(generation.id);
  if (!claimed) return { state: 'pending' }; // une autre requête s'en occupe déjà
  try {
    return { state: 'succeeded', video: await finalize(claimed, result) };
  } catch (err) {
    if (err.permanent) {
      await markFailed(generation.id, err.message);
      return { state: 'failed', message: FAILED_MESSAGE };
    }
    await updateGeneration(generation.id, { status: 'pending' }).catch(() => {});
    throw err;
  }
}
