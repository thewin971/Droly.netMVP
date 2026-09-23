// POST /api/listing-photos   body : { url }
//
// Propose les photos publiques d'une page d'annonce : exactement celles qui
// s'affichent quand on partage le lien dans un message. Réservé aux clients
// connectés. Aucun contournement : si le site refuse (beaucoup d'annonces sont
// protégées), la réponse est vide et la page invite à ajouter la photo à la main.

import { fail, getUser, handler, json } from './_shared.js';
import { checkListingUrl, fetchListingPhotos } from './_listing.js';

export default handler('listing-photos', async (request) => {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Méthode non autorisée.');

  const user = await getUser(request);
  if (!user) return fail(401, 'unauthorized', 'Connectez-vous pour utiliser cette fonction.');

  const body = await request.json().catch(() => null);
  if (!body) return fail(400, 'bad_request', 'Requête invalide.');
  const checked = checkListingUrl(body.url);
  if (checked.error) return fail(400, 'bad_url', checked.error);

  const { photos, reason } = await fetchListingPhotos(body.url);
  return json({ photos, reason: reason || null });
});
