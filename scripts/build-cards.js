/**
 * Genera le immagini delle carte in stile karuta in `assets/cards/`.
 *
 * Per ogni carta prende l'artwork da `assets/art/<id>.<png|jpg|jpeg|webp|avif>`
 * e ci disegna sopra cornice, targhetta col nome, serie, stelle di rarità e
 * numero di serie. Senza artwork usa un segnaposto con le iniziali, così il
 * drop funziona anche prima di avere le immagini.
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
const outDir = join(root, 'assets', 'cards');

const WIDTH = 480;
const HEIGHT = 672;
const FONT = 'Roboto, DejaVu Sans, Verdana, Helvetica, sans-serif';
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];

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

function findArt(id) {
  for (const ext of EXTENSIONS) {
    const candidate = join(artDir, `${id}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

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

/** Stelle di rarità disegnate come tracciati: nessuna dipendenza dai glifi del font. */
function starRow(count) {
  const marks = [];
  for (let i = 0; i < count; i += 1) {
    const cx = 48 + i * 30;
    const cy = 158;
    marks.push(
      `<path d="M${cx} ${cy - 11} L${cx + 3.4} ${cy - 3.4} L${cx + 11} ${cy - 3.4} ` +
        `L${cx + 4.9} ${cy + 1.6} L${cx + 7.4} ${cy + 9} L${cx} ${cy + 4.4} ` +
        `L${cx - 7.4} ${cy + 9} L${cx - 4.9} ${cy + 1.6} L${cx - 11} ${cy - 3.4} ` +
        `L${cx - 3.4} ${cy - 3.4} Z" fill="#ffd166" stroke="#8a6d1f" stroke-width="0.8"/>`,
    );
  }
  return marks.join('');
}

/** Numero di serie stabile, ricavato dall'id: sembra un catalogo, non cambia mai. */
function serial(id) {
  let hash = 7;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)) % 99999;
  return String(hash).padStart(5, '0');
}

function overlay(card) {
  const rarity = RARITIES[card.rarity] ?? RARITIES.common;
  const name = card.name;
  const series = card.series;
  const nameSize = fitFont(name, 372, 42, 20);
  const seriesSize = fitFont(series, 384, 26, 13);

  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#77808a"/>
      <stop offset="0.3" stop-color="#eef2f6"/>
      <stop offset="0.5" stop-color="#9aa4ae"/>
      <stop offset="0.75" stop-color="#dfe6ec"/>
      <stop offset="1" stop-color="#59626b"/>
    </linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7e6bb"/>
      <stop offset="1" stop-color="#d8ba80"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.45" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.72"/>
    </linearGradient>
  </defs>

  <rect x="9" y="9" width="${WIDTH - 18}" height="${HEIGHT - 18}" rx="21" fill="none"
        stroke="url(#metal)" stroke-width="11"/>
  <rect x="21" y="21" width="${WIDTH - 42}" height="${HEIGHT - 42}" rx="15" fill="none"
        stroke="#00000055" stroke-width="2"/>

  <rect x="0" y="${HEIGHT * 0.5}" width="${WIDTH}" height="${HEIGHT * 0.5}" fill="url(#shade)"/>

  <rect x="44" y="38" width="${WIDTH - 88}" height="88" rx="11" fill="url(#plate)"
        stroke="#6d5b33" stroke-width="3"/>
  <text x="${WIDTH / 2}" y="94" text-anchor="middle" font-family="${FONT}"
        font-size="${nameSize}" font-weight="bold" fill="#2a2116">${escapeXml(name)}</text>

  ${starRow(rarity.stars)}

  <rect x="38" y="${HEIGHT - 140}" width="${WIDTH - 76}" height="82" rx="11" fill="url(#plate)"
        stroke="#6d5b33" stroke-width="3"/>
  <text x="${WIDTH / 2}" y="${HEIGHT - 108}" text-anchor="middle" font-family="${FONT}"
        font-size="${seriesSize}" fill="#2a2116">${escapeXml(series)}</text>
  <text x="${WIDTH / 2}" y="${HEIGHT - 74}" text-anchor="middle" font-family="${FONT}"
        font-size="17" fill="#4a3a1f" opacity="0.85">${serial(card.id)} · 1</text>

  <path d="M26 132 L58 128 L54 160 Z" fill="#d5dde4" opacity="0.7"/>
  <path d="M${WIDTH - 26} 132 L${WIDTH - 58} 128 L${WIDTH - 54} 160 Z" fill="#d5dde4" opacity="0.7"/>
</svg>`;
}

/** Segnaposto quando manca l'artwork: gradiente + iniziali del personaggio. */
function placeholder(card) {
  const rarity = RARITIES[card.rarity] ?? RARITIES.common;
  const color = `#${(rarity.color & 0xffffff).toString(16).padStart(6, '0')}`;
  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b2f3a"/>
      <stop offset="1" stop-color="#12141a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0" stop-color="${color}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <text x="${WIDTH / 2}" y="${HEIGHT * 0.52}" text-anchor="middle" font-family="${FONT}"
        font-size="150" font-weight="bold" fill="#ffffff" opacity="0.3">${escapeXml(initials(card.name))}</text>
</svg>`;
}

/** Maschera arrotondata: l'artwork non deve sbordare oltre la cornice. */
function roundedMask() {
  return Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="22" fill="#ffffff"/></svg>`,
  );
}

async function buildCard(card) {
  const art = findArt(card.id);
  const raw = art
    ? await sharp(art).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' }).toBuffer()
    : Buffer.from(placeholder(card));

  // Ritaglio arrotondato dell'artwork, poi cornice e targhette sopra.
  const base = await sharp(raw)
    .resize(WIDTH, HEIGHT, { fit: 'cover' })
    .composite([{ input: roundedMask(), blend: 'dest-in' }])
    .png()
    .toBuffer();

  const out = join(outDir, `${card.id}.png`);
  await sharp(base)
    .composite([{ input: Buffer.from(overlay(card)) }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  return { id: card.id, art: Boolean(art), out };
}

const filter = (process.argv[2] ?? '').toLowerCase();
const targets = filter ? catalog.filter((card) => card.id.includes(filter)) : catalog;

if (!targets.length) {
  console.error(`Nessuna carta corrisponde a "${filter}".`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

let withArt = 0;
for (const card of targets) {
  const { art } = await buildCard(card);
  if (art) withArt += 1;
}

console.log(`🖼️  Generate ${targets.length} carte in assets/cards/ (${withArt} con artwork, ${targets.length - withArt} con segnaposto).`);
if (!withArt) {
  console.log('   Metti le immagini in assets/art/<id>.png (es. assets/art/satoru-gojo.png) e rilancia: npm run cards');
}
