/**
 * Motore di gioco: logica pura, senza Discord e senza database.
 * Tutto qui dentro è testabile e deterministico (rng iniettabile).
 */

export const RARITIES = {
  common: { label: 'Common', weight: 60, stars: 1, color: 0x95a5a6 },
  uncommon: { label: 'Uncommon', weight: 25, stars: 2, color: 0x2ecc71 },
  rare: { label: 'Rare', weight: 10, stars: 3, color: 0x3498db },
  epic: { label: 'Epic', weight: 4, stars: 4, color: 0x9b59b6 },
  legendary: { label: 'Legendary', weight: 1, stars: 5, color: 0xf1c40f },
};

/** Massimo di carte per drop (una fila di pulsanti Discord sono 5). */
export const MAX_CARDS_PER_DROP = 5;

function toRng(rng) {
  return typeof rng === 'function' ? rng : Math.random;
}

/** Minuscolo, senza accenti né punteggiatura: usato per cercare carte e serie. */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Carte il cui nome (o id) contiene il testo cercato: lookup admin e autocomplete. */
export function findCardsByName(pool, query) {
  const q = normalizeName(query);
  if (!q) return [];
  return pool.filter((card) => normalizeName(card.name).includes(q) || card.id === q);
}

/** Corrispondenza esatta (normalizzata) con il nome o con uno degli alias della carta. */
export function matchesCard(card, guess) {
  const target = normalizeName(guess);
  if (!target) return false;
  const accepted = [card.name, ...(card.aliases ?? [])].map(normalizeName);
  return accepted.includes(target);
}

export function pickRarity(rng = Math.random) {
  const entries = Object.entries(RARITIES);
  const total = entries.reduce((sum, [, rarity]) => sum + rarity.weight, 0);
  let roll = toRng(rng)() * total;
  for (const [key, rarity] of entries) {
    roll -= rarity.weight;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1][0];
}

export function rollCard(pool, rng = Math.random) {
  if (!pool.length) throw new Error('Catalogo vuoto: impossibile pescare una carta.');
  const rarity = pickRarity(rng);
  const filtered = pool.filter((card) => card.rarity === rarity);
  const candidates = filtered.length ? filtered : pool;
  const index = Math.min(candidates.length - 1, Math.floor(toRng(rng)() * candidates.length));
  return candidates[index];
}

/** Pesca `count` carte, evitando duplicati finché il catalogo lo permette. */
export function rollDrop(pool, count, rng = Math.random) {
  const picked = [];
  const available = [...pool];
  const wanted = Math.min(MAX_CARDS_PER_DROP, Math.max(1, count));
  for (let i = 0; i < wanted && available.length; i += 1) {
    const card = rollCard(available, rng);
    picked.push(card);
    const index = available.findIndex((entry) => entry.id === card.id);
    if (index >= 0) available.splice(index, 1);
  }
  return picked;
}

export function createDropSession({ cards, now = Date.now(), durationMs = 60_000, ...rest }) {
  return {
    ...rest,
    cards: [...cards],
    claimed: [],
    createdAt: now,
    expiresAt: now + durationMs,
    closed: false,
  };
}

export function isClaimed(session, index) {
  return session.claimed.some((entry) => entry.index === index);
}

export function remainingCards(session) {
  return session.cards.filter((card, index) => !isClaimed(session, index));
}

/** Quanto manca alla fine di un cooldown: 0 se è già scaduto. */
export function cooldownRemaining(expiresAt, now = Date.now()) {
  return Math.max(0, (expiresAt ?? 0) - now);
}

/** Durata breve e leggibile: "45s", "12 min 5s", "1 h 20 min". */
export function formatWait(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${minutes} min ${seconds}s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * Claim tramite pulsante numerato.
 *
 * Ritorna { result: 'claimed', card } | { result: 'taken', card, owner } |
 * { result: 'already', card } | { result: 'cooldown', retryInMs } |
 * { result: 'closed' } | { result: 'invalid' }.
 */
export function claimCard(session, { userId, index, now = Date.now(), cooldownMs = 0, lastClaimAt = 0 }) {
  if (session.closed || now >= session.expiresAt) return { result: 'closed' };

  const card = session.cards[index];
  if (!card) return { result: 'invalid' };

  const owner = session.claimed.find((entry) => entry.index === index);
  if (owner) return { result: 'taken', card, owner: owner.userId };

  const mine = session.claimed.find((entry) => entry.userId === userId);
  if (mine) return { result: 'already', card: mine.card };

  if (lastClaimAt && now - lastClaimAt < cooldownMs) {
    return { result: 'cooldown', retryInMs: cooldownMs - (now - lastClaimAt) };
  }

  session.claimed.push({ index, card, userId, at: now });
  return { result: 'claimed', card };
}
