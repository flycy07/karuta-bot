/**
 * Genera le immagini delle carte in `assets/cards/`.
 *
 * Con le cornici in `assets/frames/` l'artwork sta sotto la cornice e il nome e
 * la serie finiscono sulle due targhette. Le cornici sono **solo decorative**:
 * ogni carta ne riceve una, sempre la stessa per lei, senza legame con la rarità.
 * Cornici accettate:
 *   - `frame-1.png` … `frame-N.png` (PNG con il centro trasparente), oppure
 *   - `frames.png`: un foglio con le cornici affiancate, che viene diviso in
 *     automatico nei file qui sopra.
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

// Host gratuiti con poca RAM: senza cache di libvips e con un solo thread il
// picco di memoria resta basso e la generazione è prevedibile.
sharp.cache(false);
sharp.concurrency(1);

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

/** Le cornici disponibili: già separate oppure da ritagliare dal foglio. */
async function loadFrames() {
  if (!existsSync(framesDir)) return [];

  const separate = (n) => ['png', 'webp'].map((ext) => join(framesDir, `frame-${n}.${ext}`)).find(existsSync);

  // Qualsiasi numero di cornici: ci si ferma alla prima che manca.
  const numbered = [];
  for (let n = 1; n <= 20; n += 1) {
    const path = separate(n);
    if (!path) break;
    numbered.push(path);
  }
  if (numbered.length) return numbered;

  const sheet = FRAME_SHEETS.map((name) => join(framesDir, name)).find(existsSync);
  if (!sheet) return [];

  // Import dinamico: `src/frames.js` carica sharp, che deve partire dopo fontconfig.
  const { splitSheet } = await import('../src/frames.js');
  const frames = await splitSheet(sheet, { targetDir: framesDir });
  console.log(`✂️  Foglio cornici diviso in ${frames.length} cornici in assets/frames/ (finestra trasparente)`);
  return frames;
}

/**
 * Analizza la cornice (già ridimensionata alla carta) leggendo il canale alpha.
 *
 * - `outer`: pixel trasparenti collegati ai bordi dell'immagine, cioè fuori dalla
 *   sagoma della cornice (angoli arrotondati, corna del drago, margini).
 * - `inner`: pixel trasparenti collegati al centro, cioè la finestra.
 *
 * L'artwork va tenuto solo dove NON è `outer`: così sta dentro la finestra e sotto
 * il bordo, ma non sborda fuori dalla cornice. Le targhette di nome e serie vanno
 * dentro la finestra (`inner`), non sopra teschi, gemme e decori.
 */
async function analyzeFrame(frameBuffer, width, height) {
  const { data } = await sharp(frameBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const transparent = (x, y) => data[(y * width + x) * 4 + 3] < 24;

  const flood = (seeds) => {
    const mark = new Uint8Array(width * height);
    const stack = [];
    for (const [x, y] of seeds) {
      if (transparent(x, y) && !mark[y * width + x]) {
        mark[y * width + x] = 1;
        stack.push(y * width + x);
      }
    }
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p - x) / width;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (mark[q] || !transparent(nx, ny)) continue;
        mark[q] = 1;
        stack.push(q);
      }
    }
    return mark;
  };

  const edgeSeeds = [];
  for (let x = 0; x < width; x += 1) edgeSeeds.push([x, 0], [x, height - 1]);
  for (let y = 0; y < height; y += 1) edgeSeeds.push([0, y], [width - 1, y]);
  const outer = flood(edgeSeeds);
  const inner = flood([[Math.floor(width / 2), Math.floor(height / 2)]]);

  // Maschera dell'artwork: opaca ovunque tranne fuori dalla cornice. Si restringe
  // di 1px l'esterno così il bordo antialiased della cornice copre l'artwork.
  const mask = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i += 1) mask[i * 4 + 3] = outer[i] ? 0 : 255;
  const artMask = await sharp(mask, { raw: { width, height, channels: 4 } }).png().toBuffer();

  // Estensione orizzontale della finestra riga per riga.
  const spans = new Array(height).fill(null);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      if (!inner[y * width + x]) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left >= 0) {
      spans[y] = { left, right };
      if (top < 0) top = y;
      bottom = y;
    }
  }
  const filled = spans.filter(Boolean);
  const left = filled.length ? Math.min(...filled.map((span) => span.left)) : 0;
  const right = filled.length ? Math.max(...filled.map((span) => span.right)) : width - 1;
  return { artMask, spans, top, bottom, left, right, hasWindow: top >= 0 };
}

/** Rettangolo (x, w) che sta dentro la finestra per tutte le righe di [y, y + h]. */
function windowSpan(window, y, h) {
  let left = 0;
  let right = Infinity;
  for (let row = y; row <= y + h; row += 1) {
    const span = window.spans[Math.min(Math.max(row, 0), window.spans.length - 1)];
    if (!span) return null;
    left = Math.max(left, span.left);
    right = Math.min(right, span.right);
  }
  return right > left ? { x: left, w: right - left } : null;
}

/**
 * Nome sulla targhetta in alto, serie su quella in basso, dentro la finestra.
 *
 * Le targhette sono semitrasparenti: senza cornice propria il testo finirebbe
 * direttamente sull'artwork e sui disegni chiari sarebbe illeggibile.
 */
function platesOverlay(card, width, height, window) {
  const baseH = Math.round(height * 0.064);
  const margin = Math.round(width * 0.015);
  const fallback = { x: Math.round(width * 0.12), w: Math.round(width * 0.76) };

  // Le finestre ad arco sono strette in alto e in basso: la targhetta si ferma
  // dove la finestra è larga almeno l'82% del suo punto più largo.
  const maxWidth = Math.max(...window.spans.filter(Boolean).map((span) => span.right - span.left));
  const availW = Math.max(40, maxWidth * 0.82 - margin * 2);

  // Testo lungo = carattere minuscolo: in quel caso va su due righe, con la
  // targhetta più alta, così resta leggibile anche nelle finestre strette.
  const layout = (text, base, bold) => {
    const single = fitFont(text, availW * 0.94, base, 8);
    const words = text.split(/\s+/).filter(Boolean);
    if (single >= 19 || words.length < 2) {
      return { lines: [text], size: Math.max(single, 11), h: baseH };
    }
    let best = null;
    for (let i = 1; i < words.length; i += 1) {
      const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const longest = Math.max(lines[0].length, lines[1].length);
      if (!best || longest < best.longest) best = { lines, longest };
    }
    const size = Math.max(fitFont('x'.repeat(best.longest), availW * 0.94, base, 11), 11);
    return { lines: best.lines, size, h: Math.round(baseH * 1.7) };
  };
  const name = layout(card.name, Math.round(width * 0.082));
  const series = layout(card.series, Math.round(width * 0.062));

  const enough = (y, h) => (windowSpan(window, y, h)?.w ?? 0) >= maxWidth * 0.82;
  let topY = window.top + margin;
  while (topY < window.bottom - name.h * 3 && !enough(topY, name.h)) topY += 2;
  let bottomY = window.bottom - margin - series.h;
  while (bottomY > topY + series.h * 3 && !enough(bottomY, series.h)) bottomY -= 2;

  const place = (y, h) => {
    const span = windowSpan(window, y, h) ?? fallback;
    return { x: span.x + margin, w: Math.max(40, span.w - margin * 2) };
  };
  const top = place(topY, name.h);
  const bottom = place(bottomY, series.h);

  const rx = Math.round(baseH * 0.32);
  const plate = (box, y, h) =>
    `<rect x="${box.x}" y="${y}" width="${box.w}" height="${h}" rx="${rx}"
        fill="#08080c" fill-opacity="0.84" stroke="#d9b877" stroke-opacity="0.9" stroke-width="1.5"/>`;
  const label = (box, y, item, weight, fill, stroke) => {
    const lineH = Math.round(item.size * 1.12);
    const first = y + Math.round((item.h - lineH * (item.lines.length - 1)) / 2 + item.size * 0.36);
    return item.lines
      .map(
        (line, i) => `<text x="${box.x + box.w / 2}" y="${first + i * lineH}" text-anchor="middle" font-family="${FONT}"
        font-size="${item.size}" font-weight="${weight}" fill="${fill}"
        stroke="#000000" stroke-width="${stroke}" paint-order="stroke" stroke-linejoin="round">${escapeXml(line)}</text>`,
      )
      .join('\n  ');
  };
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${plate(top, topY, name.h)}
  ${label(top, topY, name, 'bold', '#fff4d6', 2.4)}
  ${plate(bottom, bottomY, series.h)}
  ${label(bottom, bottomY, series, 'bold', '#f6e6c2', 2)}
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

/**
 * Cornice della carta: solo decorativa, non legata alla rarità.
 *
 * L'assegnazione dipende dall'id della carta, quindi è sempre la stessa per la
 * stessa carta (le immagini non cambiano a ogni ricostruzione) ma si distribuisce
 * su tutte le cornici disponibili.
 */
function frameFor(card, frames) {
  if (!frames.length) return null;
  let hash = 0;
  for (const char of card.id) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return frames[hash % frames.length];
}

async function buildCard(card, frames) {
  const framePath = frameFor(card, frames);
  const frameMeta = framePath ? await sharp(framePath).metadata() : null;
  const width = frameMeta ? Math.round((frameMeta.width / frameMeta.height) * HEIGHT) : 500;
  const height = HEIGHT;

  const art = findArt(card);
  const raw = art
    ? await sharp(art).resize(width, height, { fit: 'cover', position: 'attention' }).toBuffer()
    : Buffer.from(placeholder(card, width, height));

  const out = join(outDir, `${card.id}.png`);

  if (!framePath) {
    await sharp(raw)
      .composite([{ input: Buffer.from(drawnFrame(card, width, height)) }])
      .png({ compressionLevel: 9 })
      .toFile(out);
    return { art: Boolean(art), frame: false };
  }

  // La cornice resta a dimensione piena (mai rimpicciolita) e ha il centro
  // trasparente: l'artwork passa sotto, ma solo dentro la sagoma della cornice.
  const frameBuffer = await sharp(framePath).resize(width, height, { fit: 'fill' }).png().toBuffer();
  const window = await analyzeFrame(frameBuffer, width, height);
  // L'artwork va adattato alla FINESTRA, non a tutta la carta: la cornice copre
  // i bordi e il personaggio finirebbe tagliato. Sotto il bordo resta una copia
  // a carta intera, così non si vede mai vuoto fra finestra e cornice.
  let artBase = await sharp(raw).resize(width, height, { fit: 'cover' }).ensureAlpha().png().toBuffer();
  if (art && window.hasWindow) {
    const pad = Math.round(width * 0.05);
    const x = Math.max(0, window.left - pad);
    const y = Math.max(0, window.top - pad);
    const w = Math.min(width, window.right + pad + 1) - x;
    const h = Math.min(height, window.bottom + pad + 1) - y;
    const fitted = await sharp(art).resize(w, h, { fit: 'cover', position: 'attention' }).png().toBuffer();
    artBase = await sharp(artBase).composite([{ input: fitted, left: x, top: y }]).png().toBuffer();
  }
  const maskedArt = await sharp(artBase)
    .composite([{ input: window.artMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const layers = [{ input: frameBuffer }];
  if (window.hasWindow) layers.push({ input: Buffer.from(platesOverlay(card, width, height, window)) });
  await sharp(maskedArt).composite(layers).png({ compressionLevel: 9 }).toFile(out);
  return { art: Boolean(art), frame: true };
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
