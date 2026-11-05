/**
 * Layer di persistenza su SQLite.
 * Usa il modulo `node:sqlite` incluso in Node 22.5+, quindi nessuna dipendenza nativa.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  claims INTEGER NOT NULL DEFAULT 0,
  last_claim_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory (
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  first_obtained INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE IF NOT EXISTS wishlist (
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  give_card TEXT NOT NULL,
  want_card TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_inventory_card ON inventory (card_id);

CREATE TABLE IF NOT EXISTS drop_cooldowns (
  user_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  notified_at INTEGER NOT NULL DEFAULT 0,
  guild_id TEXT,
  channel_id TEXT
);
`;

export function openDatabase(file = 'data/yomi.db') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function touchUser(db, id, username) {
  db.prepare(
    `INSERT INTO users (id, username) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET username = COALESCE(excluded.username, users.username)`,
  ).run(id, username ?? null);
}

export function getLastClaimAt(db, userId) {
  const row = db.prepare('SELECT last_claim_at FROM users WHERE id = ?').get(userId);
  return row?.last_claim_at ?? 0;
}

export function grantCard(db, userId, cardId, now = Date.now(), qty = 1) {
  db.prepare(
    `INSERT INTO inventory (user_id, card_id, qty, first_obtained) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, card_id) DO UPDATE SET qty = qty + excluded.qty`,
  ).run(userId, cardId, qty, now);
}

/** Toglie una copia della carta; false se l'utente non la possiede. */
export function removeCard(db, userId, cardId) {
  const row = db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND card_id = ?').get(userId, cardId);
  if (!row || row.qty < 1) return false;
  if (row.qty === 1) {
    db.prepare('DELETE FROM inventory WHERE user_id = ? AND card_id = ?').run(userId, cardId);
  } else {
    db.prepare('UPDATE inventory SET qty = qty - 1 WHERE user_id = ? AND card_id = ?').run(userId, cardId);
  }
  return true;
}

export function recordClaim(db, userId, cardId, now = Date.now()) {
  touchUser(db, userId);
  grantCard(db, userId, cardId, now);
  db.prepare('UPDATE users SET claims = claims + 1, last_claim_at = ? WHERE id = ?').run(now, userId);
}

export function getCollection(db, userId) {
  return db
    .prepare('SELECT card_id, qty, first_obtained FROM inventory WHERE user_id = ?')
    .all(userId);
}

export function countOwners(db, cardId) {
  const row = db.prepare('SELECT COUNT(*) AS owners FROM inventory WHERE card_id = ?').get(cardId);
  return row?.owners ?? 0;
}

export function ownsCard(db, userId, cardId) {
  const row = db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND card_id = ?').get(userId, cardId);
  return (row?.qty ?? 0) > 0;
}

export function addWish(db, userId, cardId, now = Date.now()) {
  const before = db
    .prepare('SELECT 1 AS present FROM wishlist WHERE user_id = ? AND card_id = ?')
    .get(userId, cardId);
  if (before) return false;
  db.prepare('INSERT INTO wishlist (user_id, card_id, created_at) VALUES (?, ?, ?)').run(userId, cardId, now);
  return true;
}

export function removeWish(db, userId, cardId) {
  const result = db.prepare('DELETE FROM wishlist WHERE user_id = ? AND card_id = ?').run(userId, cardId);
  return result.changes > 0;
}

export function listWishes(db, userId) {
  return db
    .prepare('SELECT card_id FROM wishlist WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId)
    .map((row) => row.card_id);
}

export function createTrade(db, { fromId, toId, giveCard, wantCard, now = Date.now() }) {
  const result = db
    .prepare(
      'INSERT INTO trades (from_id, to_id, give_card, want_card, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(fromId, toId, giveCard, wantCard, 'pending', now);
  return Number(result.lastInsertRowid);
}

export function getTrade(db, id) {
  return db.prepare('SELECT * FROM trades WHERE id = ?').get(id) ?? null;
}

export function setTradeStatus(db, id, status) {
  db.prepare('UPDATE trades SET status = ? WHERE id = ?').run(status, id);
}

/**
 * Cooldown di `/drop` per utente.
 *
 * Sta su SQLite (e non in memoria) perché il DM di fine attesa deve arrivare
 * anche se nel frattempo il bot è stato riavviato o ridistribuito.
 */
export function setDropCooldown(db, userId, expiresAt, { guildId = null, channelId = null } = {}) {
  db.prepare(
    `INSERT INTO drop_cooldowns (user_id, expires_at, notified_at, guild_id, channel_id)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       expires_at = excluded.expires_at,
       notified_at = 0,
       guild_id = COALESCE(excluded.guild_id, drop_cooldowns.guild_id),
       channel_id = COALESCE(excluded.channel_id, drop_cooldowns.channel_id)`,
  ).run(userId, expiresAt, guildId, channelId);
}

export function getDropCooldown(db, userId) {
  return db.prepare('SELECT * FROM drop_cooldowns WHERE user_id = ?').get(userId) ?? null;
}

/** Cooldown scaduti che non hanno ancora ricevuto il DM di fine attesa. */
export function dueDropCooldowns(db, now = Date.now(), limit = 25) {
  return db
    .prepare(
      `SELECT * FROM drop_cooldowns
       WHERE expires_at <= ? AND notified_at = 0
       ORDER BY expires_at ASC
       LIMIT ?`,
    )
    .all(now, limit);
}

/** Segna il DM come inviato (o come non più da inviare, se l'utente ha i privati chiusi). */
export function markDropCooldownNotified(db, userId, now = Date.now()) {
  db.prepare('UPDATE drop_cooldowns SET notified_at = ? WHERE user_id = ?').run(now, userId);
}

export function topCollectors(db, limit = 10) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.claims,
              (SELECT COUNT(*) FROM inventory i WHERE i.user_id = u.id) AS unique_cards
       FROM users u
       WHERE unique_cards > 0
       ORDER BY unique_cards DESC, u.claims DESC, u.id ASC
       LIMIT ?`,
    )
    .all(limit);
}
