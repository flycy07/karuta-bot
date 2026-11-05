/**
 * Cornici delle carte: divisione del foglio e finestra trasparente.
 *
 * Le cornici arrivano spesso come un'unica immagine con le cornici affiancate e
 * con il centro **opaco** (uno screenshot, un'immagine esportata da un editor).
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
export function windowMask(width, height, options = {}) {
  const { insetX, insetY, radius } = { ...DEFAULT_INSETS, ...options };
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

/**
 * Rende trasparente l'interno bianco della cornice, partendo dal centro.
 *
 * Molte cornici hanno la finestra **bianca** invece che trasparente: bucarla con
 * un rettangolo taglierebbe i decori che sporgono verso l'interno (archi, gemme).
 * Qui si toglie solo il bianco collegato al centro, quindi i decori colorati
 * restano intatti e la cornice resta identica a com'era stata disegnata.
 *
 * @returns {Promise<Buffer|null>} PNG con l'interno trasparente, o `null` se il
 * centro non è bianco (in quel caso vale la finestra rettangolare).
 */
export async function keyWhiteInterior(buffer, { tolerance = 26 } = {}) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const at = (x, y) => (y * width + x) * channels;
  const isWhite = (x, y) => {
    const i = at(x, y);
    return (
      data[i + 3] > 0 &&
      data[i] >= 255 - tolerance &&
      data[i + 1] >= 255 - tolerance &&
      data[i + 2] >= 255 - tolerance
    );
  };

  const startX = Math.floor(width / 2);
  const startY = Math.floor(height / 2);
  if (!isWhite(startX, startY)) return null;

  const seen = new Uint8Array(width * height);
  const stack = [startY * width + startX];
  seen[stack[0]] = 1;
  while (stack.length) {
    const point = stack.pop();
    const x = point % width;
    const y = (point - x) / width;
    if (!isWhite(x, y)) continue;
    data[at(x, y) + 3] = 0;
    if (x > 0 && !seen[point - 1]) {
      seen[point - 1] = 1;
      stack.push(point - 1);
    }
    if (x + 1 < width && !seen[point + 1]) {
      seen[point + 1] = 1;
      stack.push(point + 1);
    }
    if (y > 0 && !seen[point - width]) {
      seen[point - width] = 1;
      stack.push(point - width);
    }
    if (y + 1 < height && !seen[point + width]) {
      seen[point + width] = 1;
      stack.push(point + width);
    }
  }

  return sharp(data, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Applica la finestra trasparente a una cornice (buffer PNG in ingresso).
 *
 * Se l'interno è bianco viene svuotato seguendo il disegno; altrimenti si usa la
 * finestra rettangolare con gli inset indicati.
 */
export async function cutWindow(buffer, options = {}) {
  // Cornice già trasparente al centro: non si tocca niente. Applicare comunque la
  // finestra rettangolare taglia via bordi, teschi, gemme e ogni decoro che
  // sporge verso l'interno, lasciando solo due strisce laterali.
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const centre = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  if (data[centre + 3] < 10) {
    return sharp(buffer).ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
  }

  const insets = { ...DEFAULT_INSETS, ...options };
  const keyed = await keyWhiteInterior(buffer, insets);
  if (keyed) return keyed;

  const { width, height } = await sharp(buffer).metadata();
  return sharp(buffer)
    .ensureAlpha()
    .composite([{ input: windowMask(width, height, insets), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Colore dello sfondo: mediana dei quattro angoli del foglio. */
function backgroundColour(data, info, patch = 6) {
  const { width, height, channels } = info;
  const corners = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];
  const values = [[], [], []];
  for (const [cx, cy] of corners) {
    for (let y = cy; y < Math.min(cy + patch, height); y += 1) {
      for (let x = cx; x < Math.min(cx + patch, width); x += 1) {
        const i = (y * width + x) * channels;
        if (data[i + 3] <= 8) continue;
        values[0].push(data[i]);
        values[1].push(data[i + 1]);
        values[2].push(data[i + 2]);
      }
    }
  }
  return values.map((list) => {
    if (!list.length) return 0;
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
}

/**
 * Trova le cornici dentro un foglio, senza sapere quante sono.
 *
 * Le cornici non sono quasi mai larghe uguali né distanziate allo stesso modo:
 * dividere la larghezza per il numero di cornici taglierebbe i bordi. Qui si
 * cerca il *contenuto*: una colonna appartiene a una cornice se contiene pixel
 * che non sono né trasparenti né del colore dello sfondo. Lo sfondo fra due
 * cornici invece non ha contenuto. Non si può guardare solo se una colonna è
 * "liscia", perché anche l'interno di una cornice è liscio.
 *
 * @param {string|Buffer} sheet foglio con le cornici affiancate
 * @returns {Promise<{left: number, width: number}[]>}
 */
export async function detectSlices(sheet, { tolerance = 28, minWidthRatio = 0.03, mergeGapRatio = 0.004 } = {}) {
  const { data, info } = await sharp(sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const background = backgroundColour(data, info);
  const minContent = Math.max(2, Math.round(height * 0.02));

  const filled = new Array(width).fill(false);
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * channels;
      if (data[i + 3] <= 8) continue;
      const distance = Math.max(
        Math.abs(data[i] - background[0]),
        Math.abs(data[i + 1] - background[1]),
        Math.abs(data[i + 2] - background[2]),
      );
      if (distance > tolerance) {
        count += 1;
        if (count >= minContent) break;
      }
    }
    filled[x] = count >= minContent;
  }

  const minWidth = Math.max(8, Math.round(width * minWidthRatio));
  const mergeGap = Math.max(1, Math.round(width * mergeGapRatio));
  const slices = [];
  for (let x = 0; x < width; x += 1) {
    if (!filled[x]) continue;
    const start = x;
    while (x < width && filled[x]) x += 1;
    const run = { left: start, width: x - start };
    const previous = slices[slices.length - 1];
    // Un bordo può sembrare interrotto per un pixel: due gruppi quasi attaccati
    // sono la stessa cornice.
    if (previous && run.left - (previous.left + previous.width) <= mergeGap) {
      previous.width = run.left + run.width - previous.left;
      continue;
    }
    slices.push(run);
  }
  return slices.filter((slice) => slice.width >= minWidth);
}

function equalSlices(width, count) {
  const sliceWidth = Math.floor(width / count);
  if (!sliceWidth) {
    throw new Error(`Il foglio è largo ${width}px: non ci stanno ${count} cornici affiancate.`);
  }
  return Array.from({ length: count }, (_, i) => ({ left: i * sliceWidth, width: sliceWidth }));
}

/**
 * Divide il foglio nelle cornici e ne rende trasparente la finestra.
 *
 * Senza `count` le cornici vengono riconosciute dai margini, quindi va bene
 * qualsiasi numero di cornici (5, 6…) e qualsiasi spaziatura.
 *
 * @param {string} sheet percorso del foglio con le cornici affiancate
 * @param {{targetDir?: string, count?: number, insetX?: number, insetY?: number, radius?: number}} options
 * @returns {Promise<string[]>} percorsi dei PNG scritti (o buffer, senza `targetDir`)
 */
export async function splitSheet(sheet, { targetDir, count, ...options } = {}) {
  const meta = await sharp(sheet).metadata();
  const slices = count ? equalSlices(meta.width, count) : await detectSlices(sheet);
  if (!slices.length) {
    throw new Error(`Nessuna cornice riconosciuta in "${sheet}": controlla che ci sia uno sfondo uniforme fra le cornici.`);
  }

  const frames = [];
  for (const [i, slice] of slices.entries()) {
    const sliced = await sharp(sheet)
      .extract({ left: slice.left, top: 0, width: slice.width, height: meta.height })
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
