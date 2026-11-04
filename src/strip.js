/**
 * Unisce le immagini di un drop in una sola striscia orizzontale.
 *
 * Discord impila verticalmente gli embed che contengono un'immagine, quindi con
 * una carta per embed finiscono una sotto l'altra. Un'unica immagine con le
 * carte affiancate dà invece la fila orizzontale tipica dei drop.
 */
import sharp from 'sharp';

/** Nome dell'allegato: l'embed lo referenzia come `attachment://drop.png`. */
export const STRIP_NAME = 'drop.png';

/**
 * @param {string[]} files percorsi dei PNG delle carte, nell'ordine dei pulsanti
 * @param {{height?: number, gap?: number}} options altezza comune e spazio tra le carte
 * @returns {Promise<Buffer>} PNG con le carte affiancate
 */
export async function cardStrip(files, { height = 700, gap = 12 } = {}) {
  const pieces = [];
  for (const file of files) {
    const data = await sharp(file).resize({ height, fit: 'inside' }).png().toBuffer();
    const { width, height: pieceHeight } = await sharp(data).metadata();
    pieces.push({ data, width, height: pieceHeight });
  }

  const width = pieces.reduce((sum, piece) => sum + piece.width, 0) + gap * (pieces.length - 1);
  const tallest = Math.max(...pieces.map((piece) => piece.height));

  let left = 0;
  const composites = pieces.map((piece) => {
    const entry = { input: piece.data, left, top: Math.round((tallest - piece.height) / 2) };
    left += piece.width + gap;
    return entry;
  });

  return sharp({
    create: { width, height: tallest, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
