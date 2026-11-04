import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getLastClaimAt, recordClaim, touchUser } from './db.js';
import { hiddenCardEmbed, revealedCardEmbed } from './embeds.js';
import { claimCard, createDropSession, remainingCards } from './game.js';

/**
 * Gestisce i drop attivi e i claim tramite pulsanti numerati (1, 2, 3, ...).
 * Le sessioni sono in memoria: sopravvivono solo finché il bot è online,
 * mentre collezioni e cooldown sono su SQLite.
 */
export class DropManager {
  constructor({ db, config, catalog }) {
    this.db = db;
    this.config = config;
    this.catalog = catalog;
    this.byId = new Map();
    this.sessions = new Map();
    this.guildDrops = new Map();
  }

  cooldownRemaining(guildId, now = Date.now()) {
    const last = this.guildDrops.get(guildId) ?? 0;
    return Math.max(0, this.config.dropCooldownMs - (now - last));
  }

  renderEmbeds(session) {
    const total = session.cards.length;
    return session.cards.map((card, index) => {
      const claim = session.claimed.find((entry) => entry.index === index);
      return claim
        ? revealedCardEmbed(card, { claimedBy: claim.userId })
        : hiddenCardEmbed(card, { index: index + 1, total, expiresAt: session.expiresAt });
    });
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

  async start({ channel, guildId, cards, now = Date.now() }) {
    const session = createDropSession({
      id: randomUUID(),
      cards,
      now,
      durationMs: this.config.dropDurationMs,
      channelId: channel.id,
      guildId,
    });

    const message = await channel.send({
      embeds: this.renderEmbeds(session),
      components: this.renderComponents(session),
    });
    session.message = message;
    session.messageId = message.id;
    this.byId.set(session.id, session);
    this.sessions.set(channel.id, session);
    this.guildDrops.set(guildId, now);

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
    await session.message
      .edit({ embeds: this.renderEmbeds(session), components: this.renderComponents(session) })
      .catch(() => {});
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
