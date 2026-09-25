// /api/logo : le logo de l'agence, incrusté en bas à droite des vidéos.
//   GET    → { logo: { url } } (lien temporaire pour l'aperçu) ou { logo: null }
//   POST   body : { image: "data:image/png;base64,..." } → enregistre (remplace) le logo
//   DELETE → retire le logo
// Réservé aux clients connectés. Le fichier est rangé dans le dossier privé du
// client (stockage "videos"), jamais visible par les autres.

import { configError, fail, getUser, handler, json, supabaseAdmin } from './_shared.js';
import { logoPath } from './_generation.js';

const LOGO_DATA_URI = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_LOGO_BYTES = 1.5 * 1024 * 1024;

// Premiers octets attendus pour chaque format (évite d'enregistrer n'importe quoi).
function looksLikeImage(bytes, type) {
  if (type === 'png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === 'jpeg' || type === 'jpg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (type === 'webp') return String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

export default handler('logo', async (request) => {
  const missing = configError(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']);
  if (missing) return missing;

  const user = await getUser(request);
  if (!user) return fail(401, 'unauthorized', 'Connectez-vous pour continuer.');
  const bucket = supabaseAdmin().storage.from('videos');
  const path = logoPath(user.id);

  if (request.method === 'GET') {
    const { data, error } = await bucket.createSignedUrl(path, 3600);
    return json({ logo: error || !data ? null : { url: data.signedUrl } });
  }

  if (request.method === 'DELETE') {
    const { error } = await bucket.remove([path]);
    if (error) throw new Error('Suppression du logo impossible : ' + error.message);
    return json({ logo: null });
  }

  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const body = await request.json().catch(() => null);
  const match = body && typeof body.image === 'string' ? LOGO_DATA_URI.exec(body.image) : null;
  if (!match) return fail(400, 'bad_logo', 'Format de logo non pris en charge : utilisez une image PNG, JPEG ou WebP.');
  const bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) {
    return fail(400, 'bad_logo', 'Logo trop lourd (1,5 Mo maximum).');
  }
  if (!looksLikeImage(bytes, match[1])) return fail(400, 'bad_logo', 'Ce fichier n’est pas une image valide.');

  const type = match[1] === 'jpg' ? 'jpeg' : match[1];
  const { error } = await bucket.upload(path, bytes, { contentType: 'image/' + type, upsert: true });
  if (error) throw new Error('Enregistrement du logo impossible : ' + error.message);
  const { data } = await bucket.createSignedUrl(path, 3600);
  return json({ logo: { url: data ? data.signedUrl : null } });
});
