// Lecture des photos publiques d'une page d'annonce (les mêmes que celles
// affichées quand on partage le lien dans un message). Partagé par
// /api/listing-photos et /api/free-trial. Le "_" empêche Vercel d'en faire une adresse.

const TIMEOUT_MS = 9000;
const MAX_HTML = 1200 * 1024;   // on ne lit que le début de la page
const MAX_PHOTOS = 8;
const USER_AGENT = 'DrolyBot/1.0 (+https://droly.fr ; recuperation des photos d une annonce a la demande de son proprietaire)';

// Adresses internes : jamais appelées (sécurité).
const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0\.)/i;

export function checkListingUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { error: "Collez le lien de l'annonce." };
  let url;
  try { url = new URL(raw.trim()); } catch { return { error: "Ce lien n'est pas valide." }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Le lien doit commencer par https://' };
  if (!url.hostname.includes('.') || PRIVATE_HOST.test(url.hostname)) return { error: "Ce lien n'est pas valide." };
  if (raw.length > 2048) return { error: 'Ce lien est trop long.' };
  return { url };
}

// Images manifestement décoratives (logos, icônes, pixels de suivi…).
const IGNORED = /(sprite|logo|icon|favicon|avatar|placeholder|pixel|blank|1x1|badge|flag|\.svg($|\?)|\.gif($|\?))/i;

function absolute(src, base) {
  try {
    const u = new URL(src, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.href;
  } catch { return null; }
}

// Récupère les photos dans l'ordre : aperçu officiel, données structurées, puis
// les grandes images de la page.
export function extractPhotos(html, baseUrl) {
  const found = [];
  const add = (src) => {
    const href = absolute(src, baseUrl);
    if (!href || IGNORED.test(href)) return;
    if (!found.includes(href)) found.push(href);
  };

  const metas = html.match(/<meta[^>]+>/gi) || [];
  for (const tag of metas) {
    const key = (tag.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!key || !content) continue;
    if (/^(og:image(:secure_url|:url)?|twitter:image(:src)?|image)$/i.test(key)) add(content);
  }

  const linkImage = html.match(/<link[^>]+rel\s*=\s*["']image_src["'][^>]*>/i);
  if (linkImage) {
    const href = (linkImage[0].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (href) add(href);
  }

  const jsonLd = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLd) {
    const urls = block.match(/https?:\/\/[^"'\\\s]+\.(?:jpe?g|png|webp)(?:\?[^"'\\\s]*)?/gi) || [];
    urls.forEach(add);
  }

  if (found.length < MAX_PHOTOS) {
    const imgs = html.match(/<img[^>]+>/gi) || [];
    for (const tag of imgs) {
      if (found.length >= MAX_PHOTOS) break;
      const srcset = (tag.match(/srcset\s*=\s*["']([^"']+)["']/i) || [])[1];
      const src = srcset
        ? srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop()
        : (tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (src) add(src);
    }
  }

  return found.slice(0, MAX_PHOTOS);
}


// Va chercher la page et renvoie ses photos publiques.
// Ne contourne rien : si le site refuse, on renvoie une liste vide avec la raison.
export async function fetchListingPhotos(rawUrl) {
  const checked = checkListingUrl(rawUrl);
  if (checked.error) return { photos: [], reason: 'bad_url', error: checked.error };

  let response;
  try {
    response = await fetch(checked.url.href, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[droly-api] annonce injoignable :', checked.url.hostname, err && err.message);
    return { photos: [], reason: 'unreachable' };
  }

  const finalCheck = checkListingUrl(response.url || checked.url.href);
  if (finalCheck.error) return { photos: [], reason: 'blocked' };
  if (!response.ok) {
    console.error('[droly-api] refus du site :', checked.url.hostname, response.status);
    return { photos: [], reason: response.status === 404 ? 'not_found' : 'blocked' };
  }
  if (!/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '')) {
    return { photos: [], reason: 'not_a_page' };
  }

  const reader = response.body && response.body.getReader ? response.body.getReader() : null;
  let html = '';
  if (reader) {
    const decoder = new TextDecoder('utf-8');
    let size = 0;
    while (size < MAX_HTML) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      html += decoder.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch {}
  } else {
    html = (await response.text()).slice(0, MAX_HTML);
  }

  const photos = extractPhotos(html, response.url || checked.url.href);
  if (!photos.length) console.error('[droly-api] aucune photo trouvée :', checked.url.hostname);
  return { photos, reason: photos.length ? null : 'no_photo' };
}
