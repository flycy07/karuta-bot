/**
 * Genera le immagini delle carte in `assets/cards/`.
 *
 * Con le cornici in `assets/frames/` l'artwork sta sotto la cornice e il nome e
 * la serie finiscono sulle due targhette. Cornici accettate:
 *   - `frame-1.png` … `frame-5.png` (PNG con il centro trasparente), ordinate
 *     dalla rarità più bassa alla più alta, oppure
 *   - `frames.png`: un foglio con le 5 cornici in fila, che viene diviso in
 *     automatico nei 5 file qui sopra.
 * Senza cornici lo script disegna una cornice sobria da sé, così il drop
 * funziona comunque.
 *
 *   npm run cards              # tutte le carte
 *   npm run cards -- gojo      # solo le carte il cui id contiene "gojo"
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog } from '../src/cards.js';
import { RARITIES } from '../src/game.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const artDir = join(root, 'assets', 'art');
const framesDir = join(root, 'assets', 'frames');
const outDir = join(root, 'assets', 'cards');

const HEIGHT = 700;
const FONT = 'Roboto, DejaVu Sans, Verdana, Helvetica, sans-serif';
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];
const FRAME_SHEETS = ['frames.png', 'frames.webp', 'cornici.png'];

/**
 * Font: su un container senza fontconfig il testo diventa quadratini. Se il
 * sistema non ha una configurazione, ne creiamo una temporanea che punta ai TTF
 * installati con npm (o a `assets/fonts/`), così il risultato è identico ovunque.
 */
function ensureFonts() {
  if (process.env.FONTCONFIG_FILE) return;
  const dirs = [
    join(root, 'node_modules', '@expo-google-fonts', 'roboto'),
    join(root, 'assets', 'fonts'),
  ].filter((dir) => existsSync(dir));
  if (!dirs.length) return;

  const cache = join(tmpdir(), 'yomi-fontcache');
  mkdirSync(cache, { recursive: true });
  const conf = join(tmpdir(), 'yomi-fonts.conf');
  writeFileSync(
    conf,
    `<?xml version="1.0"?>\n<fontconfig>\n${dirs.map((dir) => `  <dir>${dir}</dir>`).join('\n')}\n  <cachedir>${cache}</cachedir>\n</fontconfig>\n`,
  );
  process.env.FONTCONFIG_FILE = conf;
}

ensureFonts();

// Import dinamico: fontconfig va configurato prima che libvips si inizializzi.
const sharp = (await import('sharp')).default;

function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char],
  );
}

/** Font che rimpicciolisce quando il testo è lungo, così non esce dalla targhetta. */
function fitFont(text, max, base, minimum) {
  const size = Math.floor(max / Math.max(1, text.length) / 0.56);
  return Math.max(minimum, Math.min(base, size));
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/** Artwork della carta: prima per id, poi per nome normalizzato. */
function findArt(card) {
  const bases = [
    card.id,
    card.name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  ];
  for (const base of bases) {
    for (const ext of EXTENSIONS) {
      const candidate = join(artDir, `${base}.${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Le 5 cornici, in ordine di rarità crescente. Le trova o le ritaglia dal foglio. */
async function loadFrames() {
  if (!existsSync(framesDir)) return [];

  const separate = (n) => ['png', 'webp'].map((ext) => join(framesDir, `frame-${n}.${ext}`)).find(existsSync);

  if ([1, 2, 3, 4, 5].every((n) => separate(n))) {
    return [1, 2, 3, 4, 5].map(separate);
  }

  const sheet = FRAME_SHEETS.map((name) => join(framesDir, name)).find(existsSync);
  if (!sheet) return [];

  const meta = await sharp(sheet).metadata();
  const sliceWidth = Math.floor(meta.width / 5);
  if (!sliceWidth) return [];

  const frames = [];
  for (let i = 0; i < 5; i += 1) {
    const target = join(framesDir, `frame-${i + 1}.png`);
    await sharp(sheet)
      .extract({ left: i * sliceWidth, top: 0, width: sliceWidth, height: meta.height })
      .png()
      .toFile(target);
    frames.push(target);
  }
  console.log('✂️  Foglio cornici diviso in assets/frames/frame-1.png … frame-5.png');
  return frames;
}

/** Nome sulla targhetta in alto, serie su quella in basso. */
function platesOverlay(card, width, height) {
  const nameSize = fitFont(card.name, width * 0.34, Math.round(width * 0.075), 12);
  const seriesSize = fitFont(card.series, width * 0.38, Math.round(width * 0.058), 10);
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${width / 2}" y="${height * 0.068}" text-anchor="middle" font-family="${FONT}"
        font-size="${nameSize}" font-weight="bold" fill="#f8e3ba"
        stroke="#1a1208" stroke-width="0.8">${escapeXml(card.name)}</text>
  <text x="${width / 2}" y="${height * 0.972}" text-anchor="middle" font-family="${FONT}"
        font-size="${seriesSize}" fill="#f3ddb4"
        stroke="#1a1208" stroke-width="0.6">${escapeXml(card.series)}</text>
</svg>`;
}

/** Stelle di rarità disegnate come tracciati: nessuna dipendenza dai glifi del font. */
function starRow(count, width) {
  const marks = [];
  const step = width * 0.062;
  for (let i = 0; i < count; i += 1) {
    const cx = width * 0.1 + i * step;
    const cy = width * 0.33;
    const r = width * 0.023;
    marks.push(
      `<path d="M${cx} ${cy - r} L${cx + r * 0.31} ${cy - r * 0.31} L${cx + r} ${cy - r * 0.31} ` +
        `L${cx + r * 0.45} ${cy + r * 0.15} L${cx + r * 0.67} ${cy + r * 0.82} L${cx} ${cy + r * 0.4} ` +
        `L${cx - r * 0.67} ${cy + r * 0.82} L${cx - r * 0.45} ${cy + r * 0.15} L${cx - r} ${cy - r * 0.31} ` +
        `L${cx - r * 0.31} ${cy - r * 0.31} Z" fill="#ffd166" stroke="#8a6d1f" stroke-width="0.6"/>`,
    );
  }
  return marks.join('');
}

/** Cornice disegnata dallo script, usata solo quando `assets/frames/` è vuota. */
function drawnFrame(card, width, height) {
  const rarity = RARITIES[card.rarity] ?? RARITIES.common;
  const nameSize = fitFont(card.name, width * 0.78, Math.round(width * 0.088), 16);
  const seriesSize = fitFont(card.series, width * 0.8, Math.round(width * 0.055), 12);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#77808a"/><stop offset="0.3" stop-color="#eef2f6"/>
      <stop offset="0.5" stop-color="#9aa4ae"/><stop offset="0.75" stop-color="#dfe6ec"/>
      <stop offset="1" stop-color="#59626b"/>
    </linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7e6bb"/><stop offset="1" stop-color="#d8ba80"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.5" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.7"/>
    </linearGradient>
  </defs>
  <rect x="9" y="9" width="${width - 18}" height="${height - 18}" rx="21" fill="none"
        stroke="url(#metal)" stroke-width="11"/>
  <rect x="0" y="${height * 0.5}" width="${width}" height="${height * 0.5}" fill="url(#shade)"/>
  <rect x="${width * 0.09}" y="${height * 0.055}" width="${width * 0.82}" height="${height * 0.13}" rx="11"
        fill="url(#plate)" stroke="#6d5b33" stroke-width="3"/>
  <text x="${width / 2}" y="${height * 0.148}" text-anchor="middle" font-family="${FONT}"
        font-size="${nameSize}" font-weight="bold" fill="#2a2116">${escapeXml(card.name)}</text>
  ${starRow(rarity.stars, width)}
  <rect x="${width * 0.08}" y="${height * 0.79}" width="${width * 0.84}" height="${height * 0.12}" rx="11"
        fill="url(#plate)" stroke="#6d5b33" stroke-width="3"/>
  <text x="${width / 2}" y="${height * 0.838}" text-anchor="middle" font-family="${FONT}"
        font-size="${seriesSize}" fill="#2a2116">${escapeXml(card.series)}</text>
  <text x="${width / 2}" y="${height * 0.885}" text-anchor="middle" font-family="${FONT}"
        font-size="${Math.round(width * 0.036)}" fill="#4a3a1f" opacity="0.85">${rarity.label}</text>
</svg>`;
}

/** Segnaposto quando manca l'artwork: gradiente + iniziali del personaggio. */
function placeholder(card, width, height) {
  const rarity = RARITIES[card.rarity] ?? RARITIES.common;
  const color = `#${(rarity.color & 0xffffff).toString(16).padStart(6, '0')}`;
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b2f3a"/><stop offset="1" stop-color="#12141a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0" stop-color="${color}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <text x="${width / 2}" y="${height * 0.55}" text-anchor="middle" font-family="${FONT}"
        font-size="${Math.round(width * 0.32)}" font-weight="bold" fill="#ffffff"
        opacity="0.28">${escapeXml(initials(card.name))}</text>
</svg>`;
}

async function buildCard(card, frames) {
  const framePath = frames[(RARITIES[card.rarity]?.stars ?? 1) - 1] ?? null;
  const frameMeta = framePath ? await sharp(framePath).metadata() : null;
  const width = frameMeta ? Math.round((frameMeta.width / frameMeta.height) * HEIGHT) : 500;
  const height = HEIGHT;

  const art = findArt(card);
  const raw = art
    ? await sharp(art).resize(width, height, { fit: 'cover', position: 'attention' }).toBuffer()
    : Buffer.from(placeholder(card, width, height));

  const layers = [];
  if (framePath) {
    // La cornice ha il centro trasparente: l'artwork passa sotto e resta visibile.
    layers.push({ input: await sharp(framePath).resize(width, height, { fit: 'fill' }).png().toBuffer() });
    layers.push({ input: Buffer.from(platesOverlay(card, width, height)) });
  } else {
    layers.push({ input: Buffer.from(drawnFrame(card, width, height)) });
  }

  const out = join(outDir, `${card.id}.png`);
  await sharp(raw).composite(layers).png({ compressionLevel: 9 }).toFile(out);
  return { art: Boolean(art), frame: Boolean(framePath) };
}

const filter = (process.argv[2] ?? '').toLowerCase();
const targets = filter ? catalog.filter((card) => card.id.includes(filter)) : catalog;

if (!targets.length) {
  console.error(`Nessuna carta corrisponde a "${filter}".`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const frames = await loadFrames();

let withArt = 0;
for (const card of targets) {
  const { art } = await buildCard(card, frames);
  if (art) withArt += 1;
}

console.log(
  `🖼️  ${targets.length} carte in assets/cards/ · ${withArt} con artwork · ` +
    `${frames.length ? `cornici: ${frames.length}` : 'cornice disegnata (metti i PNG in assets/frames/)'}`,
);
if (!withArt) {
  console.log('   Metti gli artwork in assets/art/<id>.png (es. assets/art/satoru-gojo.png) e rilancia: npm run cards');
}
