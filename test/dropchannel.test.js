import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { PermissionFlagsBits } from 'discord.js';
import { commands } from '../src/commands.js';
import {
  clearDropChannel,
  getCollection,
  getDropChannel,
  grantCard,
  openDatabase,
  setDropChannel,
} from '../src/db.js';

const dropCommand = commands.find((entry) => entry.builder.name === 'drop');
const channelCommand = commands.find((entry) => entry.builder.name === 'dropchannel');

test('un database creato prima di /dropchannel conserva le collezioni e prende la nuova tabella', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yomi-'));
  const file = join(dir, 'old.db');
  try {
    // Schema "vecchio": nessuna tabella guild_settings.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, claims INTEGER NOT NULL DEFAULT 0, last_claim_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE inventory (user_id TEXT NOT NULL, card_id TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1, first_obtained INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, card_id));
      INSERT INTO users (id, username, claims) VALUES ('u1', 'mario', 2);
      INSERT INTO inventory (user_id, card_id, qty, first_obtained) VALUES ('u1', 'naruto-uzumaki', 2, 111), ('u1', 'gaara', 1, 222);
    `);
    old.close();

    const db = openDatabase(file);
    assert.deepEqual(
      getCollection(db, 'u1').map((row) => [row.card_id, row.qty, row.first_obtained]).sort(),
      [['gaara', 1, 222], ['naruto-uzumaki', 2, 111]],
    );
    assert.equal(db.prepare('SELECT claims FROM users WHERE id = ?').get('u1').claims, 2);

    assert.equal(getDropChannel(db, 'g1'), null);
    setDropChannel(db, 'g1', 'c1');
    assert.equal(getDropChannel(db, 'g1'), 'c1');
    db.close();

    // Riaprendo il file (come dopo un riavvio) tutto è ancora lì.
    const again = openDatabase(file);
    assert.equal(getDropChannel(again, 'g1'), 'c1');
    assert.equal(getCollection(again, 'u1').length, 2);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il canale dei drop è per server e si può togliere', () => {
  const db = openDatabase(':memory:');
  setDropChannel(db, 'g1', 'c1');
  setDropChannel(db, 'g2', 'c9');
  setDropChannel(db, 'g1', 'c2');
  assert.equal(getDropChannel(db, 'g1'), 'c2');
  assert.equal(getDropChannel(db, 'g2'), 'c9');
  clearDropChannel(db, 'g1');
  assert.equal(getDropChannel(db, 'g1'), null);
  assert.equal(getDropChannel(db, 'g2'), 'c9');
});

/** Interazione finta con le sole parti che i comandi toccano. */
function fakeInteraction({ guildId = 'g1', channelId = 'c1', channels = {}, admin = false, sub = null, options = {} } = {}) {
  const replies = [];
  const interaction = {
    guildId,
    channelId,
    user: { id: 'u1', username: 'mario' },
    memberPermissions: { has: (flag) => admin && flag === PermissionFlagsBits.ManageGuild },
    member: null,
    channel: channels[channelId] ?? { id: channelId, isSendable: () => true },
    guild: guildId
      ? {
          channels: {
            fetch: async (id) => {
              if (channels[id]) return channels[id];
              throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
            },
          },
          members: { me: { id: 'bot' } },
        }
      : null,
    options: {
      getInteger: () => null,
      getString: () => null,
      getChannel: () => options.channel ?? null,
      getSubcommand: () => sub,
    },
    replies,
    reply: async (payload) => replies.push(payload),
    deferReply: async () => {},
    editReply: async (payload) => replies.push(payload),
  };
  return interaction;
}

function textChannel(id, { missing = [] } = {}) {
  return {
    id,
    isSendable: () => true,
    isTextBased: () => true,
    isThread: () => false,
    isVoiceBased: () => false,
    permissionsFor: () => ({ has: (flag) => !missing.includes(flag) }),
  };
}

function context(db) {
  const started = [];
  return {
    started,
    db,
    config: { adminRoleId: null, dropCooldownMs: 30 * 60_000 },
    drops: {
      cooldownRemaining: () => 0,
      start: async (args) => started.push(args),
    },
  };
}

test('/drop senza canale impostato funziona dove capita', async () => {
  const db = openDatabase(':memory:');
  const ctx = context(db);
  const interaction = fakeInteraction({ channels: { c1: textChannel('c1') } });
  await dropCommand.run(interaction, ctx);
  assert.equal(ctx.started.length, 1);
});

test('/drop nel canale sbagliato viene rifiutato e indica quello giusto', async () => {
  const db = openDatabase(':memory:');
  setDropChannel(db, 'g1', 'c-drop');
  const ctx = context(db);
  const interaction = fakeInteraction({
    channelId: 'c-chat',
    channels: { 'c-chat': textChannel('c-chat'), 'c-drop': textChannel('c-drop') },
  });
  await dropCommand.run(interaction, ctx);
  assert.equal(ctx.started.length, 0);
  assert.match(interaction.replies[0].content, /<#c-drop>/);
});

test('/drop nel canale giusto parte', async () => {
  const db = openDatabase(':memory:');
  setDropChannel(db, 'g1', 'c-drop');
  const ctx = context(db);
  const interaction = fakeInteraction({
    channelId: 'c-drop',
    channels: { 'c-drop': textChannel('c-drop') },
  });
  await dropCommand.run(interaction, ctx);
  assert.equal(ctx.started.length, 1);
});

test('se il canale dei drop è stato cancellato la restrizione cade da sola', async () => {
  const db = openDatabase(':memory:');
  setDropChannel(db, 'g1', 'c-cancellato');
  const ctx = context(db);
  const interaction = fakeInteraction({ channelId: 'c-chat', channels: { 'c-chat': textChannel('c-chat') } });
  await dropCommand.run(interaction, ctx);
  assert.equal(ctx.started.length, 1);
  assert.equal(getDropChannel(db, 'g1'), null);
});

test('la restrizione vale solo nel server in cui è stata impostata', async () => {
  const db = openDatabase(':memory:');
  setDropChannel(db, 'g-altro', 'c-drop');
  const ctx = context(db);
  const interaction = fakeInteraction({ channels: { c1: textChannel('c1') } });
  await dropCommand.run(interaction, ctx);
  assert.equal(ctx.started.length, 1);
});

test('/dropchannel set: solo admin', async () => {
  const db = openDatabase(':memory:');
  const ctx = context(db);
  const interaction = fakeInteraction({
    sub: 'set',
    admin: false,
    channels: { c1: textChannel('c1') },
    options: { channel: textChannel('c1') },
  });
  await channelCommand.run(interaction, ctx);
  assert.equal(getDropChannel(db, 'g1'), null);
  assert.match(interaction.replies[0].content, /Solo chi ha/);
});

test('/dropchannel set salva il canale scelto, o quello corrente se non ne scegli uno', async () => {
  const db = openDatabase(':memory:');
  const ctx = context(db);

  const picked = fakeInteraction({
    sub: 'set',
    admin: true,
    channels: { c1: textChannel('c1'), 'c-drop': textChannel('c-drop') },
    options: { channel: textChannel('c-drop') },
  });
  await channelCommand.run(picked, ctx);
  assert.equal(getDropChannel(db, 'g1'), 'c-drop');

  const current = fakeInteraction({ sub: 'set', admin: true, channelId: 'c1', channels: { c1: textChannel('c1') } });
  await channelCommand.run(current, ctx);
  assert.equal(getDropChannel(db, 'g1'), 'c1');
  assert.match(current.replies[0].content, /Prima era <#c-drop>/);
});

test('/dropchannel set rifiuta un canale dove il bot non può scrivere', async () => {
  const db = openDatabase(':memory:');
  const ctx = context(db);
  const blocked = textChannel('c-drop', { missing: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] });
  const interaction = fakeInteraction({
    sub: 'set',
    admin: true,
    channels: { c1: textChannel('c1'), 'c-drop': blocked },
    options: { channel: blocked },
  });
  await channelCommand.run(interaction, ctx);
  assert.equal(getDropChannel(db, 'g1'), null);
  assert.match(interaction.replies[0].content, /Inviare messaggi/);
  assert.match(interaction.replies[0].content, /Allegare file/);
});

test('/dropchannel show e clear', async () => {
  const db = openDatabase(':memory:');
  const ctx = context(db);
  setDropChannel(db, 'g1', 'c-drop');

  const show = fakeInteraction({ sub: 'show', admin: true });
  await channelCommand.run(show, ctx);
  assert.match(show.replies[0].content, /<#c-drop>/);

  const clear = fakeInteraction({ sub: 'clear', admin: true });
  await channelCommand.run(clear, ctx);
  assert.equal(getDropChannel(db, 'g1'), null);

  const after = fakeInteraction({ sub: 'show', admin: true });
  await channelCommand.run(after, ctx);
  assert.match(after.replies[0].content, /Nessun canale/);
});

test('/dropchannel non tocca le collezioni', async () => {
  const db = openDatabase(':memory:');
  grantCard(db, 'u1', 'gaara');
  const ctx = context(db);
  await channelCommand.run(
    fakeInteraction({ sub: 'set', admin: true, channels: { c1: textChannel('c1') } }),
    ctx,
  );
  await channelCommand.run(fakeInteraction({ sub: 'clear', admin: true }), ctx);
  assert.equal(getCollection(db, 'u1').length, 1);
});
