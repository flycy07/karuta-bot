import 'dotenv/config';

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Cooldown tra due `/drop` dello stesso utente, in minuti.
 *
 * Il vecchio `DROP_COOLDOWN_MS` (5 secondi, per server) è ignorato di proposito:
 * un valore rimasto nelle variabili d'ambiente dell'host non deve poter
 * annullare i 30 minuti.
 */
const dropCooldownMinutes = Math.max(0, int(process.env.DROP_COOLDOWN_MINUTES, 30));

export const config = {
  token: (process.env.DISCORD_TOKEN ?? '').trim(),
  guildId: (process.env.GUILD_ID ?? '').trim() || null,
  /** Ruolo che può usare /drop anche senza il permesso "Gestire il server". */
  adminRoleId: (process.env.ADMIN_ROLE_ID ?? '').trim() || null,
  databaseFile: process.env.DATABASE_FILE ?? 'data/yomi.db',
  /** Cooldown personale dopo un claim riuscito. */
  claimCooldownMs: int(process.env.CLAIM_COOLDOWN_MS, 20_000),
  /** Quanto resta aperto un drop. */
  dropDurationMs: int(process.env.DROP_DURATION_MS, 60_000),
  /** Cooldown tra due /drop dello stesso utente (30 minuti di default). */
  dropCooldownMinutes,
  dropCooldownMs: dropCooldownMinutes * 60_000,
  /** Ogni quanto controllare i cooldown scaduti per mandare il DM di fine attesa. */
  dropNotifyIntervalMs: int(process.env.DROP_NOTIFY_INTERVAL_MS, 30_000),
};
