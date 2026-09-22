// Droly — fonction Supabase Edge (Deno) qui fait le pont entre la page Droly
// et l'API Runway pour générer une vraie vidéo à partir d'une photo.
//
// Équivalent de ../../../api/server.js, mais pour héberger sur Supabase au
// lieu de Render. Les deux sont fournis : n'utilise que celui que tu déploies
// réellement, l'autre dossier ne sert à rien tant qu'il n'est pas déployé.
//
// Pourquoi une fonction séparée, et pas juste du code dans la page ?
// La page Droly (index.html) est un fichier public : n'importe qui peut voir
// son code source. Si la clé secrète Runway était écrite dedans, n'importe
// qui pourrait la copier et l'utiliser à tes frais. Cette fonction garde la
// clé cachée côté serveur (secret Supabase), et c'est elle qui parle à
// Runway — la page ne fait que l'appeler.

import RunwayML, { TaskFailedError } from 'npm:@runwayml/sdk';

// MVP : ouvert à tous les domaines. À restreindre plus tard si besoin
// (remplace '*' par ton propre nom de domaine une fois le site en ligne).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // Pré-vol CORS : le navigateur l'envoie automatiquement avant le vrai
  // appel POST depuis un autre domaine. Il faut répondre OK sans rien faire
  // d'autre, sinon le vrai appel qui suit est bloqué par le navigateur.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let payload: { imageUrl?: string; promptText?: string; ratio?: string; duration?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad_request', message: 'Corps JSON invalide.' }, 400);
  }

  const { imageUrl, promptText, ratio, duration } = payload || {};

  if (!imageUrl || typeof imageUrl !== 'string') {
    return json({ error: 'bad_request', message: 'imageUrl (lien direct vers une image) est requis.' }, 400);
  }

  const apiKey = Deno.env.get('RUNWAYML_API_SECRET');
  if (!apiKey) {
    console.warn('[droly-generate] RUNWAYML_API_SECRET manquant — vérifie les secrets de la fonction.');
    return json({ error: 'server_error', message: 'RUNWAYML_API_SECRET non configuré côté serveur.' }, 500);
  }

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.imageToVideo
      .create({
        model: 'gen4.5',
        promptImage: imageUrl,
        promptText: promptText || 'Mouvement de caméra immobilier, travelling lent et cinématique, style visite virtuelle',
        ratio: ratio || '1280:720',
        duration: duration || 5,
      })
      .waitForTaskOutput();

    // Le champ exact qui contient l'URL vidéo peut varier selon la version de
    // l'API — on log la réponse complète (visible dans Functions > Logs sur
    // le dashboard Supabase) et on essaie les formes les plus courantes.
    console.log('[droly-generate] task output brut:', JSON.stringify(task.output ?? task));

    let videoUrl: string | null = null;
    if (Array.isArray(task.output) && task.output.length > 0) {
      videoUrl = typeof task.output[0] === 'string' ? task.output[0] : (task.output[0] as { url?: string })?.url ?? null;
    } else if ((task.output as { url?: string })?.url) {
      videoUrl = (task.output as { url?: string }).url ?? null;
    }

    return json({ videoUrl, raw: task });
  } catch (err) {
    if (err instanceof TaskFailedError) {
      console.error('[droly-generate] Runway a échoué à générer la vidéo:', err.taskDetails);
      return json({ error: 'generation_failed', message: "Runway n'a pas réussi à générer la vidéo.", details: err.taskDetails }, 502);
    }
    console.error('[droly-generate] Erreur serveur:', err);
    return json({ error: 'server_error', message: String((err as Error)?.message ?? err) }, 500);
  }
});
