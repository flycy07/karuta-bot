/**
 * Cornici delle carte: divisione del foglio e finestra trasparente.
 *
 * Le cornici arrivano spesso come un'unica immagine con le 5 cornici affiancate
 * e con il centro **opaco** (uno screenshot, un'immagine esportata da un editor).
 * Usata così la cornice coprirebbe il personaggio, quindi qui la finestra
 * centrale viene ritagliata via lasciando il canale alpha.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Quanto stringe la finestra rispetto ai bordi della cornice, in percentuale. */
export const DEFAULT_INSETS = { insetX: 7.5, insetY: 4.5, radius: 2.5 };

/**
 * Maschera bianca con il buco della finestra al centro: usata con `dest-in`
 * lascia la cornice opaca e rende trasparente tutto quello che sta dentro.
 */
export function windowMask(width, height, { insetX, insetY, radius } = DEFAULT_INSETS) {
  const x = Math.round((width * insetX) / 100);
  const y = Math.round((height * insetY) / 100);
  const rx = Math.round((Math.min(width, height) * radius) / 100);
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs><mask id="hole">
    <rect width="${width}" height="${height}" fill="#ffffff"/>
    <rect x="${x}" y="${y}" width="${width - 2 * x}" height="${height - 2 * y}" rx="${rx}" fill="#000000"/>
  </mask></defs>
  <rect width="${width}" height="${height}" fill="#ffffff" mask="url(#hole)"/>
</svg>`,
  );
}

/** Applica la finestra trasparente a una cornice (buffer PNG in ingresso). */
export async function cutWindow(buffer, options = DEFAULT_INSETS) {
  const { width, height } = await sharp(buffer).metadata();
  return sharp(buffer)
    .ensureAlpha()
    .composite([{ input: windowMask(width, height, options), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Divide il foglio in `count` cornici e ne rende trasparente la finestra.
 *
 * @param {string} sheet percorso del foglio con le cornici affiancate
 * @param {{targetDir?: string, count?: number, insetX?: number, insetY?: number, radius?: number}} options
 * @returns {Promise<string[]>} percorsi dei PNG scritti (o buffer, senza `targetDir`)
 */
export async function splitSheet(sheet, { targetDir, count = 5, ...options } = {}) {
  const meta = await sharp(sheet).metadata();
  const sliceWidth = Math.floor(meta.width / count);
  if (!sliceWidth) {
    throw new Error(`"${sheet}" è largo ${meta.width}px: non ci stanno ${count} cornici affiancate.`);
  }

  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const sliced = await sharp(sheet)
      .extract({ left: i * sliceWidth, top: 0, width: sliceWidth, height: meta.height })
      .png()
      .toBuffer();
    const cut = await cutWindow(sliced, options);

    if (!targetDir) {
      frames.push(cut);
      continue;
    }
    const target = join(targetDir, `frame-${i + 1}.png`);
    await writeFile(target, cut);
    frames.push(target);
  }
  return frames;
}
