import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_STRIKES,
  createDropSession,
  matchesCard,
  normalizeName,
  pickRarity,
  remainingCards,
  resolveClaim,
  rollCard,
  rollDrop,
} from '../src/game.js';

const card = {
  id: 'nozomi-kori',
  name: 'Nozomi Kōri',
  series: 'Yuki no Kuni',
  rarity: 'epic',
  emoji: '💠',
  aliases: ['Nozomi Kori', 'Nozomi'],
};

const pool = [
  { id: 'a', name: 'Aoi Mizuno', series: 'S', rarity: 'common', emoji: '🌊' },
  { id: 'b', name: 'Rin Takara', series: 'S', rarity: 'uncommon', emoji: '🎀' },
  { id: 'c', name: 'Mio Hoshino', series: 'S', rarity: 'legendary', emoji: '🌟' },
];

test('normalizeName toglie accenti, maiuscole e punteggiatura', () => {
  assert.equal(normalizeName('  Nozomi KŌRI! '), 'nozomi kori');
  assert.equal(normalizeName('Sakura-9'), 'sakura 9');
  assert.equal(normalizeName(''), '');
});

test('matchesCard accetta nome e alias, rifiuta parziali', () => {
  assert.ok(matchesCard(card, 'nozomi kori'));
  assert.ok(matchesCard(card, 'Nozomi Kōri'));
  assert.ok(matchesCard(card, 'NOZOMI'));
  assert.ok(!matchesCard(card, 'nozo'));
  assert.ok(!matchesCard(card, 'Yuki no Kuni'));
});

test('pickRarity rispetta i pesi', () => {
  assert.equal(pickRarity(() => 0), 'common');
  assert.equal(pickRarity(() => 0.99), 'legendary');
});

test('rollCard è deterministico con un rng fissato', () => {
  const sequence = [0.5, 0]; // rarità common (0.5 * 100 = 50) -> prima carta common
  let i = 0;
  const rolled = rollCard(pool, () => sequence[i++ % sequence.length]);
  assert.equal(rolled.id, 'a');
});

test('rollDrop non ripete carte finché può', () => {
  const cards = rollDrop(pool, 3, () => 0.1);
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map((entry) => entry.id)).size, 3);
});

test('rollDrop non supera la dimensione del catalogo', () => {
  assert.equal(rollDrop(pool, 10, () => 0.2).length, 3);
});

test('resolveClaim: errore incrementa gli strike, il nome giusto vince', () => {
  const session = createDropSession({ cards: [card], now: 0, durationMs: 1000 });

  const wrong = resolveClaim(session, { userId: 'u1', guess: 'nozo', now: 10 });
  assert.equal(wrong.result, 'wrong');
  assert.equal(wrong.remainingStrikes, MAX_STRIKES - 1);

  const right = resolveClaim(session, { userId: 'u1', guess: 'Nozomi Kori', now: 20 });
  assert.equal(right.result, 'claimed');
  assert.equal(right.card.id, card.id);
  assert.equal(session.strikes.get('u1'), undefined);
  assert.equal(remainingCards(session).length, 0);
});

test('resolveClaim blocca dopo il terzo errore', () => {
  const session = createDropSession({ cards: [card], now: 0, durationMs: 1000 });
  for (let i = 0; i < MAX_STRIKES; i += 1) {
    resolveClaim(session, { userId: 'u1', guess: 'boh', now: i });
  }
  const blocked = resolveClaim(session, { userId: 'u1', guess: card.name, now: 100 });
  assert.equal(blocked.result, 'blocked');
});

test('resolveClaim rispetta il cooldown senza consumare tentativi', () => {
  const session = createDropSession({ cards: [card], now: 0, durationMs: 10_000 });
  const outcome = resolveClaim(session, {
    userId: 'u1',
    guess: card.name,
    now: 5_000,
    cooldownMs: 20_000,
    lastClaimAt: 4_000,
  });
  assert.equal(outcome.result, 'cooldown');
  assert.equal(outcome.retryInMs, 19_000);
  assert.equal(session.strikes.get('u1'), undefined);
});

test('resolveClaim chiude il drop scaduto e le carte già prese sono fuori gioco', () => {
  const session = createDropSession({ cards: [card], now: 0, durationMs: 1000 });
  assert.equal(resolveClaim(session, { userId: 'u1', guess: card.name, now: 500 }).result, 'claimed');
  assert.equal(resolveClaim(session, { userId: 'u2', guess: card.name, now: 600 }).result, 'closed');
  assert.equal(resolveClaim(session, { userId: 'u2', guess: card.name, now: 9999 }).result, 'closed');
});
