import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dueDropCooldowns,
  getDropCooldown,
  markDropCooldownNotified,
  openDatabase,
  setDropCooldown,
} from '../src/db.js';
import { DropManager } from '../src/drops.js';
import { cooldownRemaining, formatWait } from '../src/game.js';

const HALF_HOUR = 30 * 60_000;

function manager(db, client = null) {
  return new DropManager({
    db,
    config: { dropCooldownMs: HALF_HOUR, dropNotifyIntervalMs: 30_000 },
    catalog: [],
    client,
  });
}

function fakeClient(onSend) {
  return {
    users: {
      fetch: async (id) => ({
        send: async (payload) => {
          onSend(id, payload);
        },
      }),
    },
  };
}

test('cooldownRemaining conta alla rovescia e si ferma a zero', () => {
  assert.equal(cooldownRemaining(1_000, 0), 1_000);
  assert.equal(cooldownRemaining(1_000, 600), 400);
  assert.equal(cooldownRemaining(1_000, 1_000), 0);
  assert.equal(cooldownRemaining(1_000, 5_000), 0);
  assert.equal(cooldownRemaining(null, 5_000), 0);
});

test('formatWait scrive attese leggibili', () => {
  assert.equal(formatWait(0), '0s');
  assert.equal(formatWait(1_000), '1s');
  assert.equal(formatWait(HALF_HOUR), '30 min');
  assert.equal(formatWait(12 * 60_000 + 5_000), '12 min 5s');
  assert.equal(formatWait(90 * 60_000), '1 h 30 min');
});

test('il cooldown di /drop è salvato e scade dopo 30 minuti', () => {
  const db = openDatabase(':memory:');
  const start = 1_000;
  const expires = start + HALF_HOUR;

  setDropCooldown(db, 'u1', expires, { guildId: 'g1', channelId: 'c1' });
  const row = getDropCooldown(db, 'u1');
  assert.equal(row.expires_at, expires);
  assert.equal(row.guild_id, 'g1');

  assert.equal(manager(db).cooldownRemaining('u1', start), HALF_HOUR);
  assert.equal(manager(db).cooldownRemaining('u1', expires), 0);
  assert.equal(manager(db).cooldownRemaining('sconosciuto', start), 0);

  assert.equal(dueDropCooldowns(db, start).length, 0);
  assert.equal(dueDropCooldowns(db, expires).length, 1);
  markDropCooldownNotified(db, 'u1', expires);
  assert.equal(dueDropCooldowns(db, expires + 1).length, 0);
});

test('un nuovo drop riparte col cooldown pieno e il DM da inviare di nuovo', () => {
  const db = openDatabase(':memory:');
  setDropCooldown(db, 'u1', 1_000);
  markDropCooldownNotified(db, 'u1', 1_000);
  setDropCooldown(db, 'u1', 5_000);

  assert.equal(dueDropCooldowns(db, 4_000).length, 0);
  assert.equal(dueDropCooldowns(db, 5_000).length, 1);
});

test('a cooldown scaduto il bot manda un DM, una volta sola', async () => {
  const db = openDatabase(':memory:');
  const sent = [];
  const drops = manager(db, fakeClient((id, payload) => sent.push({ id, payload })));

  setDropCooldown(db, 'u1', 1_000);

  assert.equal(await drops.notifyDueCooldowns(500), 0, 'prima della scadenza nessun DM');
  assert.equal(await drops.notifyDueCooldowns(2_000), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 'u1');
  assert.match(sent[0].payload.content, /30 min/);
  assert.match(sent[0].payload.content, /\/drop/);

  assert.equal(await drops.notifyDueCooldowns(3_000), 0, 'non ripete il DM');
  assert.equal(sent.length, 1);
});

test('se i DM sono chiusi il cooldown non resta in coda per sempre', async () => {
  const db = openDatabase(':memory:');
  const drops = manager(db, {
    users: {
      fetch: async () => {
        throw new Error('Cannot send messages to this user');
      },
    },
  });

  setDropCooldown(db, 'u1', 1_000);
  assert.equal(await drops.notifyDueCooldowns(2_000), 0);
  assert.equal(dueDropCooldowns(db, 10_000).length, 0);
});
