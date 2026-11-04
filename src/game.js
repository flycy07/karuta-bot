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

/** Tentativi sbagliati prima di perdere il diritto al claim su un drop. */
export const MAX_STRIKES = 3;

function toRng(rng) {
  return typeof rng === 'function' ? rng : Math.random;
}

/** Minuscolo, senza accenti né punteggiatura: "Nozomi Kōri!" -> "nozomi kori". */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Il guess deve combaciare con il nome o con uno degli alias della carta. */
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
  const wanted = Math.max(1, count);
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
    strikes: new Map(),
    createdAt: now,
    expiresAt: now + durationMs,
    closed: false,
    noticesShown: new Set(),
  };
}

export function remainingCards(session) {
  const claimedIds = new Set(session.claimed.map((entry) => entry.card.id));
  return session.cards.filter((card) => !claimedIds.has(card.id));
}

/**
 * Valuta un tentativo di claim.
 *
 * Ritorna { result: 'claimed', card } | { result: 'wrong', ... } |
 * { result: 'cooldown', retryInMs } | { result: 'blocked' } | { result: 'closed' }.
 */
export function resolveClaim(session, { userId, guess, now = Date.now(), cooldownMs = 0, lastClaimAt = 0 }) {
  if (session.closed || now >= session.expiresAt) return { result: 'closed' };

  const remaining = remainingCards(session);
  if (remaining.length === 0) return { result: 'closed' };

  if (lastClaimAt && now - lastClaimAt < cooldownMs) {
    return { result: 'cooldown', retryInMs: cooldownMs - (now - lastClaimAt) };
  }

  const strikes = session.strikes.get(userId) ?? 0;
  if (strikes >= MAX_STRIKES) return { result: 'blocked' };

  const card = remaining.find((entry) => matchesCard(entry, guess));
  if (!card) {
    const next = strikes + 1;
    session.strikes.set(userId, next);
    return { result: 'wrong', strikes: next, remainingStrikes: Math.max(0, MAX_STRIKES - next) };
  }

  session.claimed.push({ userId, card, at: now });
  session.strikes.delete(userId);
  return { result: 'claimed', card };
}
