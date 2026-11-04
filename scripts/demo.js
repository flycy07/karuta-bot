/**
 * Demo da terminale: simula un drop con i pulsanti numerati, senza Discord né token.
 * Utile per verificare il motore di gioco: `npm run demo`.
 */
import { catalog } from '../src/cards.js';
import {
  RARITIES,
  claimCard,
  createDropSession,
  remainingCards,
  rollDrop,
} from '../src/game.js';

const NOW = 1_700_000_000_000;
const COOLDOWN = 20_000;

const cards = rollDrop(catalog, 3, () => 0.5);
const session = createDropSession({ cards, now: NOW, durationMs: 60_000 });

const rarity = (card) => `${RARITIES[card.rarity].label} ${'★'.repeat(RARITIES[card.rarity].stars)}`;
console.log('🎴 DROP — 3 carte coperte, pulsanti [1] [2] [3]');
for (const card of cards) console.log(`   ${card.emoji} ??? · ${card.series} · ${rarity(card)}`);
console.log('');

function click({ userId, index, at, lastClaimAt = 0 }) {
  const outcome = claimCard(session, { userId, index, now: at, cooldownMs: COOLDOWN, lastClaimAt });
  const label = `${userId} preme [${index + 1}]`;
  switch (outcome.result) {
    case 'claimed':
      console.log(`✅ ${label} -> prende ${outcome.card.emoji} ${outcome.card.name} (${outcome.card.series})`);
      return outcome;
    case 'taken':
      console.log(`🚫 ${label} -> già presa da ${outcome.owner}`);
      return outcome;
    case 'already':
      console.log(`🚫 ${label} -> ${userId} ha già preso ${outcome.card.name} in questo drop`);
      return outcome;
    case 'cooldown':
      console.log(`⏳ ${label} -> cooldown per altri ${Math.ceil(outcome.retryInMs / 1000)}s`);
      return outcome;
    case 'invalid':
      console.log(`❔ ${label} -> carta inesistente`);
      return outcome;
    default:
      console.log(`⌛ ${label} -> drop chiuso`);
      return outcome;
  }
}

const first = click({ userId: 'luca', index: 0, at: NOW + 1_000 });
click({ userId: 'giulia', index: 0, at: NOW + 2_000 });
click({ userId: 'luca', index: 1, at: NOW + 3_000 });
click({ userId: 'giulia', index: 1, at: NOW + 4_000 });
click({ userId: 'marco', index: 1, at: NOW + 5_000, lastClaimAt: NOW + 1_000 });
click({ userId: 'marco', index: 2, at: NOW + 6_000 });
click({ userId: 'sara', index: 3, at: NOW + 7_000 });

console.log('');
console.log(`Carte rimaste nel drop: ${remainingCards(session).length}`);
console.log(`Claim registrati: ${session.claimed.map((entry) => `${entry.userId}->[${entry.index + 1}] ${entry.card.name}`).join(', ')}`);
console.log(first.result === 'claimed' ? '\n✔ Motore di gioco funzionante.' : '\n✘ Qualcosa non torna nel motore.');
