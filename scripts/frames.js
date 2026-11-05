/**
 * Prepara le cornici in `assets/frames/` a partire da un foglio unico.
 *
 *   npm run frames                          # usa assets/frames/frames.png
 *   npm run frames -- --sheet cornici.png   # oppure il file che vuoi
 *   npm run frames -- --inset-x 6 --inset-y 4 --radius 3   # finestra più larga/stretta
 *   npm run frames -- --count 6             # forza il numero di cornici (divisione uguale)
 *   npm run frames -- --keep-alpha          # cornici già con il centro trasparente
 *
 * Scrive `frame-1.png` … `frame-N.png` (quante cornici ci sono nel foglio) e una
 * anteprima in `artifacts/frames-preview.png` per controllare il risultato.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { cutWindow, splitSheet } from '../src/frames.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const framesDir = join(root, 'assets', 'frames');
const artifactsDir = join(root, 'artifacts');
const SHEETS = ['frames.png', 'frames.webp', 'frames.jpg', 'cornici.png'];

const argv = process.argv.slice(2);
const numbered = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? Number.NaN : Number(argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
};
const sheetArg = argv.includes('--sheet') ? argv[argv.indexOf('--sheet') + 1] : null;
const keepAlpha = argv.includes('--keep-alpha');
const count = argv.includes('--count') ? numbered('count', undefined) : undefined;
const insets = {
  insetX: numbered('inset-x', 7.5),
  insetY: numbered('inset-y', 4.5),
  radius: numbered('radius', 2.5),
};

const sheet = sheetArg ? join(root, sheetArg) : SHEETS.map((name) => join(framesDir, name)).find(existsSync);
if (!sheet || !existsSync(sheet)) {
  console.error(
    `Nessun foglio di cornici trovato.\n` +
      `Metti il file in ${join('assets', 'frames', 'frames.png')} (o usa --sheet <file>):\n` +
      `deve avere le cornici affiancate (5, 6 o quante vuoi) su uno sfondo uniforme.`,
  );
  process.exit(1);
}

mkdirSync(framesDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });

const frames = keepAlpha
  ? await splitSheet(sheet, { targetDir: framesDir, count })
  : await splitSheet(sheet, { targetDir: framesDir, count, ...insets });

// Anteprima: cornici sopra uno sfondo colorato, così si vede se la finestra è
// davvero trasparente e quanto artwork resta scoperto. Le cornici riconosciute
// dai margini non hanno la stessa larghezza, quindi si allineano a quella più larga.
const metas = await Promise.all(frames.map((frame) => sharp(frame).metadata()));
const height = Math.max(...metas.map((meta) => meta.height));
const sliceWidth = Math.max(...metas.map((meta) => meta.width));
const totalWidth = sliceWidth * frames.length;
const background = Buffer.from(
  `<svg width="${totalWidth}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ff7a45"/><stop offset="0.5" stop-color="#4f9dff"/>
    <stop offset="1" stop-color="#8a5cff"/>
  </linearGradient></defs>
  <rect width="${totalWidth}" height="${height}" fill="url(#g)"/>
  <text x="${totalWidth / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif"
        font-size="${Math.round(height * 0.1)}" font-weight="bold" fill="#ffffff" opacity="0.85">ARTWORK</text>
</svg>`,
);
const layers = [];
for (const [index, frame] of frames.entries()) {
  const resized = await sharp(frame).resize(sliceWidth, height, { fit: 'fill' }).png().toBuffer();
  layers.push({ input: resized, left: index * sliceWidth, top: 0 });
}
const preview = await sharp(background).composite(layers).png({ compressionLevel: 9 }).toBuffer();
await writeFile(join(artifactsDir, 'frames-preview.png'), preview);

// Controllo veloce: un pixel al centro deve essere trasparente, uno sul bordo no.
const { data, info } = await sharp(frames[0]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
const center = alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2));
const edge = alphaAt(2, Math.floor(info.height / 2));

const cut = keepAlpha ? '' : ` · finestra trasparente ${insets.insetX}%×${insets.insetY}% (raggio ${insets.radius}%)`;
console.log(`🖼️  ${frames.length} cornici in assets/frames/ (frame-1 … frame-${frames.length})${cut}`);
console.log(`   centro alpha=${center} (0 = trasparente), bordo alpha=${edge} (255 = opaco)`);
console.log('   anteprima: artifacts/frames-preview.png');
console.log('   ora: npm run cards');

export { cutWindow };
