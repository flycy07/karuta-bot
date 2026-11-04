/**
 * Demo da terminale: simula un drop completo senza Discord né token.
 * Utile per verificare il motore di gioco: `npm run demo`.
 */
import { catalog } from '../src/cards.js';
import { MAX_STRIKES, RARITIES, createDropSession, remainingCards, resolveClaim, rollDrop } from '../src/game.js';

const NOW = 1_700_000_000_000;
const COOLDOWN = 20_000;

const cards = rollDrop(catalog, 3, () => 0.5);
const session = createDropSession({ cards, now: NOW, durationMs: 60_000 });

const rarity = (card) => `${RARITIES[card.rarity].label} ${'★'.repeat(RARITIES[card.rarity].stars)}`;
console.log('🎴 DROP — 3 carte coperte');
for (const card of cards) console.log(`   ${card.emoji} ??? · ${card.series} · ${rarity(card)}`);
console.log('');

function attempt({ userId, guess, at, lastClaimAt = 0 }) {
  const outcome = resolveClaim(session, { userId, guess, now: at, cooldownMs: COOLDOWN, lastClaimAt });
  const label = `${userId} scrive "${guess}"`;
  switch (outcome.result) {
    case 'claimed':
      console.log(`✅ ${label} -> prende ${outcome.card.emoji} ${outcome.card.name}`);
      return outcome;
    case 'wrong':
      console.log(`❌ ${label} -> sbagliato (${outcome.remainingStrikes} tentativi rimasti)`);
      return outcome;
    case 'blocked':
      console.log(`🚫 ${label} -> bloccato: ${MAX_STRIKES} errori`);
      return outcome;
    case 'cooldown':
      console.log(`⏳ ${label} -> in cooldown per altri ${Math.ceil(outcome.retryInMs / 1000)}s`);
      return outcome;
    default:
      console.log(`⌛ ${label} -> drop chiuso`);
      return outcome;
  }
}

attempt({ userId: 'luca', guess: 'Naruto', at: NOW + 1_000 });
attempt({ userId: 'luca', guess: 'asuka', at: NOW + 2_000 });
const first = attempt({ userId: 'luca', guess: cards[0].name, at: NOW + 3_000 });
attempt({ userId: 'luca', guess: cards[1].name, at: NOW + 4_000, lastClaimAt: NOW + 3_000 });
attempt({ userId: 'giulia', guess: cards[1].series, at: NOW + 5_000 });
attempt({ userId: 'giulia', guess: cards[1].name.toUpperCase(), at: NOW + 6_000 });
attempt({ userId: 'marco', guess: cards[2].name, at: NOW + 7_000 });
attempt({ userId: 'marco', guess: cards[2].name, at: NOW + 8_000 });
attempt({ userId: 'marco', guess: 'x', at: NOW + 9_000 });
attempt({ userId: 'marco', guess: 'y', at: NOW + 10_000 });

console.log('');
console.log(`Carte rimaste nel drop: ${remainingCards(session).length}`);
console.log(`Claim registrati: ${session.claimed.map((entry) => `${entry.userId}->${entry.card.name}`).join(', ')}`);
console.log(first.result === 'claimed' ? '\n✔ Motore di gioco funzionante.' : '\n✘ Qualcosa non torna nel motore.');
