import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { cardImageSource } from './cards.js';
import {
  dueDropCooldowns,
  getDropChannel,
  getDropCooldown,
  getLastClaimAt,
  markDropCooldownNotified,
  recordClaim,
  setDropCooldown,
  touchUser,
} from './db.js';
import { cardImageEmbed, hiddenCardEmbed, revealedCardEmbed } from './embeds.js';
import {
  claimCard,
  cooldownRemaining as remainingCooldown,
  createDropSession,
  formatWait,
  remainingCards,
} from './game.js';
import { cardStrip, STRIP_NAME } from './strip.js';

/**
 * Gestisce i drop attivi e i claim tramite pulsanti numerati (1, 2, 3, ...).
 * Le sessioni sono in memoria: sopravvivono solo finché il bot è online,
 * mentre collezioni e cooldown sono su SQLite.
 */
export class DropManager {
  constructor({ db, config, catalog, client = null }) {
    this.db = db;
    this.config = config;
    this.catalog = catalog;
    this.client = client;
    this.byId = new Map();
    this.sessions = new Map();
    this.watcher = null;
    this.notifying = false;
  }

  /** Quanto manca al prossimo `/drop` di questo utente (0 = può droppare subito). */
  cooldownRemaining(userId, now = Date.now()) {
    const row = getDropCooldown(this.db, userId);
    return row ? remainingCooldown(row.expires_at, now) : 0;
  }

  /** Sorgenti immagine delle carte di un drop (file locale oppure URL). */
  images(session) {
    const sources = new Map();
    for (const card of session.cards) {
      const source = cardImageSource(card);
      if (source) sources.set(card.id, source);
    }
    return sources;
  }

  /** Allegati da caricare: solo le carte con un file locale, non quelle con URL. */
  attachmentFiles(session) {
    return [...this.images(session).values()]
      .filter((source) => source.file)
      .map((source) => new AttachmentBuilder(source.file, { name: source.name }));
  }

  renderEmbeds(session) {
    const total = session.cards.length;
    const sources = this.images(session);
    return session.cards.map((card, index) => {
      const claim = session.claimed.find((entry) => entry.index === index);
      const source = sources.get(card.id);
      // Con un'immagine la carta si mostra e basta: niente testo sopra.
      if (source) return cardImageEmbed(card, { attachment: source.name, url: source.url });
      return claim
        ? revealedCardEmbed(card, { claimedBy: claim.userId })
        : hiddenCardEmbed(card, { index: index + 1, total, expiresAt: session.expiresAt });
    });
  }

  /**
   * Corpo del messaggio del drop.
   *
   * Con più carte che hanno un PNG locale le unisce in una sola immagine, così
   * Discord le mostra affiancate invece che una sotto l'altra; i pulsanti restano
   * uno per carta, nell'ordine da sinistra a destra. Negli altri casi manda un
   * embed per carta come prima (segnaposto testuale o URL dal catalogo).
   */
  async payload(session) {
    const components = this.renderComponents(session);
    const sources = this.images(session);
    const local = session.cards.map((card) => sources.get(card.id));

    if (local.length > 1 && local.every((source) => source?.file)) {
      const strip = await cardStrip(local.map((source) => source.file));
      return {
        embeds: [cardImageEmbed(session.cards[0], { attachment: STRIP_NAME })],
        components,
        files: [new AttachmentBuilder(strip, { name: STRIP_NAME })],
      };
    }

    return {
      embeds: this.renderEmbeds(session),
      components,
      files: this.attachmentFiles(session),
    };
  }

  renderComponents(session) {
    const buttons = session.cards.map((card, index) => {
      const claim = session.claimed.find((entry) => entry.index === index);
      const button = new ButtonBuilder()
        .setCustomId(`claim:${session.id}:${index}`)
        .setStyle(claim ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setLabel(claim ? `${index + 1} · presa` : String(index + 1));
      if (claim || session.closed) button.setDisabled(true);
      return button;
    });

    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    return rows;
  }

  async start({ channel, guildId, userId = null, cards, now = Date.now() }) {
    const session = createDropSession({
      id: randomUUID(),
      cards,
      now,
      durationMs: this.config.dropDurationMs,
      channelId: channel.id,
      guildId,
    });

    const message = await channel.send(await this.payload(session));
    session.message = message;
    session.messageId = message.id;
    this.byId.set(session.id, session);
    this.sessions.set(channel.id, session);

    // Il cooldown è per utente e sta su SQLite: deve sopravvivere al riavvio, così
    // il DM di fine attesa arriva comunque.
    if (userId) {
      setDropCooldown(this.db, userId, now + this.config.dropCooldownMs, {
        guildId,
        channelId: channel.id,
      });
    }

    session.timer = setTimeout(() => {
      this.finish(session.id).catch(() => {});
    }, this.config.dropDurationMs + 500);
    session.timer.unref?.();

    return session;
  }

  get(sessionId) {
    return this.byId.get(sessionId) ?? null;
  }

  async refresh(session) {
    if (!session.message) return;
    await session.message.edit(await this.payload(session)).catch(() => {});
  }

  /**
   * Avvisi di fine cooldown.
   *
   * Niente timer per utente: al riavvio sparirebbero. Un controllo periodico sui
   * cooldown salvati in SQLite recupera anche quelli scaduti mentre il bot era
   * offline (su Render l'istanza gratuita si riavvia spesso).
   */
  watchCooldowns(intervalMs = this.config.dropNotifyIntervalMs ?? 30_000) {
    if (this.watcher) return this.watcher;
    this.notifyDueCooldowns().catch(() => {});
    this.watcher = setInterval(() => {
      this.notifyDueCooldowns().catch(() => {});
    }, intervalMs);
    this.watcher.unref?.();
    return this.watcher;
  }

  stopCooldowns() {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
  }

  /** Manda il DM a chi ha il cooldown scaduto e ritorna quanti ne sono partiti. */
  async notifyDueCooldowns(now = Date.now()) {
    if (this.notifying) return 0;
    this.notifying = true;
    let sent = 0;
    try {
      for (const row of dueDropCooldowns(this.db, now)) {
        // Segnato prima dell'invio: con i DM chiusi non si riprova all'infinito.
        markDropCooldownNotified(this.db, row.user_id, now);
        if (await this.sendCooldownDm(row)) sent += 1;
      }
    } finally {
      this.notifying = false;
    }
    return sent;
  }

  async sendCooldownDm(row) {
    if (!this.client) return false;
    try {
      const user = await this.client.users.fetch(row.user_id);
      const dropChannel = row.guild_id ? getDropChannel(this.db, row.guild_id) : null;
      await user.send({
        content:
          `🎴 È finita l'attesa di **${formatWait(this.config.dropCooldownMs)}**: ` +
          `puoi far cadere nuove carte con \`/drop\`${dropChannel ? ` in <#${dropChannel}>` : ''}.`,
        allowedMentions: { parse: [] },
      });
      return true;
    } catch (error) {
      console.warn(`[cooldown] DM a ${row.user_id} non inviato: ${error.message}`);
      return false;
    }
  }

  async finish(sessionId) {
    const session = this.byId.get(sessionId);
    if (!session) return;
    session.closed = true;
    clearTimeout(session.timer);
    this.byId.delete(sessionId);
    this.sessions.delete(session.channelId);
    await this.refresh(session);
  }

  /** Claim via pulsante: valida, aggiorna il database e ridisegna il messaggio del drop. */
  async claim({ sessionId, userId, username, index, now = Date.now() }) {
    const session = this.byId.get(sessionId);
    if (!session) return { result: 'closed' };

    const outcome = claimCard(session, {
      userId,
      index,
      now,
      cooldownMs: this.config.claimCooldownMs,
      lastClaimAt: getLastClaimAt(this.db, userId),
    });

    if (outcome.result === 'claimed') {
      touchUser(this.db, userId, username ?? null);
      recordClaim(this.db, userId, outcome.card.id, now);
      await this.refresh(session);
      if (remainingCards(session).length === 0) await this.finish(session.id);
    }

    return { ...outcome, session };
  }
}
