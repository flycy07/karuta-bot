import 'dotenv/config';

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DEFAULT_COOLDOWN_MINUTES = 30;
const MAX_COOLDOWN_MINUTES = 1440; // 1 giorno

/**
 * Cooldown tra due `/drop` dello stesso utente, in minuti.
 *
 * Il vecchio `DROP_COOLDOWN_MS` (5 secondi, per server) è ignorato di proposito:
 * un valore rimasto nelle variabili d'ambiente dell'host non deve poter
 * annullare i 30 minuti. Un valore fuori scala (es. `30000`, che sarebbero 21
 * giorni) torna al default con un avviso nei log, invece di bloccare i drop.
 */
function cooldownMinutes(raw) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COOLDOWN_MINUTES;
  if (parsed < 1 || parsed > MAX_COOLDOWN_MINUTES) {
    console.warn(
      `⚠️  DROP_COOLDOWN_MINUTES=${raw} fuori intervallo (1-${MAX_COOLDOWN_MINUTES} minuti): uso ${DEFAULT_COOLDOWN_MINUTES} minuti.`,
    );
    return DEFAULT_COOLDOWN_MINUTES;
  }
  return parsed;
}

const dropCooldownMinutes = cooldownMinutes(process.env.DROP_COOLDOWN_MINUTES);

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
