// Montage des vidéos (le "_" empêche Vercel d'en faire une adresse publique).
//
// Sert à deux choses, avec ffmpeg (fourni par le paquet ffmpeg-static et
// embarqué dans les fonctions grâce à vercel.json) :
//  - la « visite complète » : plusieurs plans (un par photo) enchaînés en une
//    seule vidéo, avec un fondu entre chaque pièce ;
//  - le logo de l'agence, incrusté en bas à droite.
// Tout se passe dans un dossier temporaire, effacé à la fin.

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

// Taille finale des vidéos montées, selon le format choisi.
export const SIZES = { landscape: [1280, 720], vertical: [720, 1280] };
export const FPS = 24;
export const TRANSITION_S = 0.4; // fondu entre deux pièces
const EDIT_TIMEOUT_MS = 45000;

export async function videoEditingAvailable() {
  if (!ffmpegPath) return false;
  try {
    await access(ffmpegPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function run(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL',
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stderr }));
  });
}

// Durée d'une vidéo en secondes (lue dans ce qu'affiche ffmpeg).
async function duration(file) {
  const { stderr } = await run(['-hide_banner', '-i', file], 15000);
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Construit la chaîne de filtres ffmpeg. Exportée pour les tests.
export function buildFilter({ durations, format, withLogo }) {
  const [W, H] = SIZES[format] || SIZES.landscape;
  const n = durations.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `setsar=1,fps=${FPS},format=yuv420p,settb=AVTB[v${i}]`
    );
  }
  let last = 'v0';
  let offset = 0;
  for (let i = 1; i < n; i++) {
    // Chaque plan doit durer plus longtemps que le fondu.
    const d = Math.max(durations[i - 1] || 5, TRANSITION_S + 0.5);
    offset += d - TRANSITION_S;
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${TRANSITION_S}:offset=${offset.toFixed(3)}[x${i}]`);
    last = 'x' + i;
  }
  if (withLogo) {
    const short = Math.min(W, H);
    const logoW = Math.round(short * 0.32);
    const logoH = Math.round(short * 0.14);
    const margin = Math.round(short * 0.04);
    parts.push(
      `[${n}:v]scale=${logoW}:${logoH}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=0.92[logo]`
    );
    parts.push(`[${last}][logo]overlay=x=main_w-overlay_w-${margin}:y=main_h-overlay_h-${margin}:format=auto[out]`);
  } else {
    parts.push(`[${last}]null[out]`);
  }
  return parts.join(';');
}

// Monte une vidéo : clips (dans l'ordre) + logo facultatif → MP4 (octets).
// clips : tableaux d'octets (Uint8Array) ; logo : octets d'une image, ou null.
export async function editVideo({ clips, logo = null, format = 'landscape' }) {
  if (!Array.isArray(clips) || !clips.length) throw new Error('Aucun plan à monter');
  if (!(await videoEditingAvailable())) throw new Error('Outil de montage (ffmpeg) indisponible');

  const dir = await mkdtemp(path.join(tmpdir(), 'droly-'));
  try {
    const inputs = [];
    for (let i = 0; i < clips.length; i++) {
      const file = path.join(dir, `clip-${i}.mp4`);
      await writeFile(file, clips[i]);
      inputs.push(file);
    }
    const durations = [];
    for (const file of inputs) durations.push((await duration(file)) || 5);

    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    for (const file of inputs) args.push('-i', file);
    if (logo) {
      const logoFile = path.join(dir, 'logo');
      await writeFile(logoFile, logo);
      args.push('-i', logoFile);
    }
    const out = path.join(dir, 'out.mp4');
    args.push(
      '-filter_complex', buildFilter({ durations, format, withLogo: !!logo }),
      '-map', '[out]', '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      out
    );
    const result = await run(args, EDIT_TIMEOUT_MS);
    if (result.code !== 0) {
      const why = result.signal ? 'temps dépassé' : result.stderr.trim().split('\n').slice(-3).join(' ');
      throw new Error('Montage impossible : ' + why.slice(0, 400));
    }
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
