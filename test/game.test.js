import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from '../src/cards.js';
import {
  MAX_CARDS_PER_DROP,
  RARITIES,
  claimCard,
  createDropSession,
  findCardsByName,
  normalizeName,
  pickRarity,
  remainingCards,
  rollDrop,
} from '../src/game.js';

const cards = [
  { id: 'anya', name: 'Anya Forger', series: 'Spy x Family', rarity: 'legendary', emoji: '🥜' },
  { id: 'levi', name: 'Levi Ackerman', series: 'Attack on Titan', rarity: 'rare', emoji: '🪃' },
  { id: 'saitama', name: 'Saitama', series: 'One Punch Man', rarity: 'epic', emoji: '👊' },
];

function newSession(now = 0) {
  return createDropSession({ cards, now, durationMs: 60_000 });
}

test('normalizeName toglie accenti, maiuscole e punteggiatura', () => {
  assert.equal(normalizeName('  Ryōmen SUKUNA! '), 'ryomen sukuna');
  assert.equal(normalizeName("Speed-o'-Sound Sonic"), 'speed o sound sonic');
  assert.equal(normalizeName(''), '');
});

test('findCardsByName cerca per nome parziale e per id', () => {
  assert.equal(findCardsByName(catalog, 'gojo').length, 1);
  assert.equal(findCardsByName(catalog, 'gojo')[0].name, 'Satoru Gojo');
  assert.equal(findCardsByName(catalog, 'anya')[0].id, 'anya-forger');
  assert.deepEqual(findCardsByName(catalog, ''), []);
});

test('pickRarity rispetta i pesi', () => {
  assert.equal(pickRarity(() => 0), 'common');
  assert.equal(pickRarity(() => 0.99), 'legendary');
});

test('rollDrop non ripete carte e rispetta il massimo di pulsanti', () => {
  const picked = rollDrop(catalog, 5, () => 0.1);
  assert.equal(picked.length, MAX_CARDS_PER_DROP);
  assert.equal(new Set(picked.map((card) => card.id)).size, picked.length);
  assert.equal(rollDrop(catalog, 99, () => 0.3).length, MAX_CARDS_PER_DROP);
});

test('il primo click prende la carta', () => {
  const session = newSession();
  const outcome = claimCard(session, { userId: 'u1', index: 1, now: 10 });
  assert.equal(outcome.result, 'claimed');
  assert.equal(outcome.card.id, 'levi');
  assert.equal(session.claimed.length, 1);
  assert.equal(remainingCards(session).length, 2);
});

test('la stessa carta non si può prendere due volte', () => {
  const session = newSession();
  claimCard(session, { userId: 'u1', index: 0, now: 10 });
  const second = claimCard(session, { userId: 'u2', index: 0, now: 20 });
  assert.equal(second.result, 'taken');
  assert.equal(second.owner, 'u1');
});

test('una carta a testa per drop', () => {
  const session = newSession();
  claimCard(session, { userId: 'u1', index: 0, now: 10 });
  const second = claimCard(session, { userId: 'u1', index: 2, now: 20 });
  assert.equal(second.result, 'already');
  assert.equal(second.card.id, 'anya');
});

test('il cooldown blocca il claim senza consumare la carta', () => {
  const session = newSession();
  const outcome = claimCard(session, {
    userId: 'u1',
    index: 2,
    now: 5_000,
    cooldownMs: 20_000,
    lastClaimAt: 4_000,
  });
  assert.equal(outcome.result, 'cooldown');
  assert.equal(outcome.retryInMs, 19_000);
  assert.equal(session.claimed.length, 0);
});

test('indice inesistente e drop scaduto', () => {
  const session = newSession();
  assert.equal(claimCard(session, { userId: 'u1', index: 9, now: 10 }).result, 'invalid');
  assert.equal(claimCard(session, { userId: 'u1', index: 0, now: 60_001 }).result, 'closed');
  session.closed = true;
  assert.equal(claimCard(session, { userId: 'u1', index: 0, now: 20 }).result, 'closed');
});

test('il catalogo è coerente: id unici, rarità valide, campi pieni', () => {
  const ids = new Set();
  for (const card of catalog) {
    assert.ok(card.id && card.name && card.series && card.emoji, `carta incompleta: ${JSON.stringify(card)}`);
    assert.ok(RARITIES[card.rarity], `rarità non valida per ${card.id}: ${card.rarity}`);
    assert.ok(!ids.has(card.id), `id duplicato: ${card.id}`);
    ids.add(card.id);
  }
  const series = new Set(catalog.map((card) => card.series));
  assert.ok(series.size >= 10, `poche serie: ${series.size}`);
  assert.ok(catalog.length >= 100, `poche carte: ${catalog.length}`);
});
