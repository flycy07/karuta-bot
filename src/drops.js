import { getLastClaimAt, recordClaim, touchUser } from './db.js';
import { hiddenCardEmbed, revealedCardEmbed } from './embeds.js';
import { createDropSession, remainingCards, resolveClaim, rollDrop } from './game.js';

/**
 * Gestisce i drop attivi (una sessione per canale) e i claim via messaggio.
 * Le sessioni sono in memoria: sopravvivono solo finché il bot è online,
 * mentre collezioni e cooldown sono su SQLite.
 */
export class DropManager {
  constructor({ db, config, catalog }) {
    this.db = db;
    this.config = config;
    this.catalog = catalog;
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
      const claim = session.claimed.find((entry) => entry.card.id === card.id);
      return claim
        ? revealedCardEmbed(card, { claimedBy: claim.userId })
        : hiddenCardEmbed(card, { index: index + 1, total, expiresAt: session.expiresAt });
    });
  }

  async start({ channel, guildId, amount = 1, now = Date.now() }) {
    const cards = rollDrop(this.catalog, amount);
    const session = createDropSession({
      cards,
      now,
      durationMs: this.config.dropDurationMs,
      channelId: channel.id,
      guildId,
    });

    const message = await channel.send({ embeds: this.renderEmbeds(session) });
    session.message = message;
    session.messageId = message.id;
    this.sessions.set(channel.id, session);
    this.guildDrops.set(guildId, now);

    session.timer = setTimeout(() => {
      this.finish(channel.id).catch(() => {});
    }, this.config.dropDurationMs + 500);
    session.timer.unref?.();

    return session;
  }

  async refresh(session) {
    if (!session.message) return;
    await session.message.edit({ embeds: this.renderEmbeds(session) }).catch(() => {});
  }

  async finish(channelId) {
    const session = this.sessions.get(channelId);
    if (!session) return;
    session.closed = true;
    clearTimeout(session.timer);
    this.sessions.delete(channelId);
    await this.refresh(session);
  }

  /** Ritorna true se il messaggio riguardava un drop (anche se ignorato). */
  async handleMessage(message) {
    if (!message.inGuild?.() || message.author?.bot) return false;

    const session = this.sessions.get(message.channelId);
    if (!session) return false;

    const guess = (message.content ?? '').trim();
    if (!guess || guess.length > 80 || guess.startsWith('/')) return false;

    const now = Date.now();
    const lastClaimAt = getLastClaimAt(this.db, message.author.id);
    const outcome = resolveClaim(session, {
      userId: message.author.id,
      guess,
      now,
      cooldownMs: this.config.claimCooldownMs,
      lastClaimAt,
    });

    if (outcome.result === 'closed') {
      await this.finish(session.channelId);
      return false;
    }
    if (outcome.result === 'cooldown') return true;

    if (outcome.result === 'blocked') {
      const key = `blocked:${session.messageId}`;
      if (!session.noticesShown.has(key)) {
        session.noticesShown.add(key);
        this.tempReply(message, '🚫 Hai esaurito i tentativi per questo drop.').catch(() => {});
      }
      return true;
    }

    if (outcome.result === 'wrong') {
      this.tempReply(message, `❌ Nome sbagliato — tentativi rimasti: **${outcome.remainingStrikes}**.`).catch(
        () => {},
      );
      return true;
    }

    const name = message.member?.displayName ?? message.author.username;
    touchUser(this.db, message.author.id, message.author.username);
    recordClaim(this.db, message.author.id, outcome.card.id, now);

    await message.channel
      .send({
        content: `🎴 **${name}** ha preso **${outcome.card.name}**!`,
        embeds: [revealedCardEmbed(outcome.card)],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    await this.refresh(session);

    if (remainingCards(session).length === 0) {
      await this.finish(session.channelId);
    }
    return true;
  }

  async tempReply(message, content, ms = 4000) {
    const reply = await message.reply({ content, allowedMentions: { repliedUser: false } });
    setTimeout(() => {
      reply.delete().catch(() => {});
    }, ms).unref?.();
  }
}
