// Droly API — fonction serverless Vercel qui fait le pont entre la page
// Droly et l'API Runway (génération vidéo à partir d'une photo).
//
// Convention Vercel : chaque fichier posé directement dans le dossier
// api/ à la racine du repo devient automatiquement une route. Ce fichier
// devient donc l'adresse /api/generate — pas de serveur à faire tourner,
// pas de app.listen(), Vercel s'occupe de tout.
//
// La clé secrète Runway ne doit JAMAIS être écrite dans index.html : n'importe
// qui peut lire le code source d'une page web et la voler. Elle vit ici,
// côté serveur, dans la variable d'environnement RUNWAYML_API_SECRET
// (Vercel → Settings → Environment Variables).

import RunwayML, { TaskFailedError } from '@runwayml/sdk';

const client = new RunwayML(); // lit RUNWAYML_API_SECRET automatiquement dans l'environnement

export default async function handler(req, res) {
  // CORS — laissé ouvert par souplesse (le site et l'API sont sur le même
  // domaine Vercel donc ce n'est pas strictement nécessaire, mais ça ne
  // coûte rien de le garder si tu appelles cette route d'ailleurs plus tard).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // body attendu : { imageUrl: string, promptText?: string, ratio?: string, duration?: number }
  // imageUrl DOIT être un lien direct vers une image (jpg/png/webp), pas un
  // lien vers une page d'annonce Airbnb/Leboncoin (voir README).
  const { imageUrl, promptText, ratio, duration } = req.body || {};

  if (!imageUrl || typeof imageUrl !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'imageUrl (lien direct vers une image) est requis.' });
  }

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
    // l'API — on log la réponse complète (visible dans Vercel → Deployments →
    // ton déploiement → Functions → generate → Logs) et on essaie les formes
    // les plus courantes.
    console.log('[droly-api] task output brut:', JSON.stringify(task.output ?? task, null, 2));

    let videoUrl = null;
    if (Array.isArray(task.output) && task.output.length > 0) {
      videoUrl = typeof task.output[0] === 'string' ? task.output[0] : task.output[0]?.url;
    } else if (task.output?.url) {
      videoUrl = task.output.url;
    }

    return res.status(200).json({ videoUrl, raw: task });
  } catch (err) {
    if (err instanceof TaskFailedError) {
      console.error('[droly-api] Runway a échoué à générer la vidéo:', err.taskDetails);
      return res.status(502).json({ error: 'generation_failed', message: "Runway n'a pas réussi à générer la vidéo.", details: err.taskDetails });
    }
    console.error('[droly-api] Erreur serveur:', err);
    return res.status(500).json({ error: 'server_error', message: String(err?.message || err) });
  }
}
