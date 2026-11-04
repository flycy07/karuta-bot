/**
 * Catalogo delle carte.
 *
 * Per aggiungere carte basta modificare `cards.json`: ogni voce ha
 * { id, name, series, rarity, emoji, aliases?, image? }.
 * Se `image` è un URL, gli embed mostrano quell'immagine come artwork.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cardsPath = fileURLToPath(new URL('./data/cards.json', import.meta.url));
const raw = JSON.parse(readFileSync(cardsPath, 'utf8'));

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** @type {Array<{id:string,name:string,series:string,rarity:string,emoji:string,aliases?:string[],image?:string}>} */
export const catalog = Array.isArray(raw) ? raw : raw.cards;

const byId = new Map(catalog.map((card) => [card.id, card]));

export function getCard(id) {
  return byId.get(id) ?? null;
}

export function cardsBySeries(series) {
  const needle = series.toLowerCase();
  return catalog.filter((card) => card.series.toLowerCase().includes(needle));
}

export function seriesList() {
  return [...new Set(catalog.map((card) => card.series))].sort((a, b) => a.localeCompare(b));
}

export function rarityRank(rarity) {
  const index = RARITY_ORDER.indexOf(rarity);
  return index === -1 ? 0 : index;
}
