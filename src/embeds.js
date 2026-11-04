import { EmbedBuilder } from 'discord.js';
import { RARITIES } from './game.js';

export function stars(rarity) {
  return '★'.repeat(RARITIES[rarity]?.stars ?? 1);
}

export function colorOf(rarity) {
  return RARITIES[rarity]?.color ?? 0x95a5a6;
}

export function labelOf(rarity) {
  return RARITIES[rarity]?.label ?? rarity;
}

function baseEmbed(card) {
  const embed = new EmbedBuilder()
    .setColor(colorOf(card.rarity))
    .setFooter({ text: `${labelOf(card.rarity)} • ${stars(card.rarity)}` });
  if (card.image) embed.setImage(card.image);
  return embed;
}

/** Carta non ancora indovinata: mostra solo serie e rarità. */
export function hiddenCardEmbed(card, { index, total, expiresAt }) {
  const embed = baseEmbed(card)
    .setTitle(`${card.emoji} ${stars(card.rarity)}`)
    .setDescription(
      `**Serie:** ${card.series}\n\n*Scrivi il nome del personaggio in chat per prenderla.*\n` +
        `<t:${Math.floor(expiresAt / 1000)}:R>`,
    );
  return embed;
}

/** Carta indovinata: rivela il nome. */
export function revealedCardEmbed(card, { claimedBy } = {}) {
  const embed = baseEmbed(card)
    .setTitle(`${card.emoji} ${card.name}`)
    .setDescription(`**Serie:** ${card.series}`);
  if (claimedBy) embed.addFields({ name: 'Claim di', value: `<@${claimedBy}>`, inline: true });
  return embed;
}

/** Scheda carta per /card. */
export function cardInfoEmbed(card, { qty = 0, owners = 0, wanted = false } = {}) {
  const embed = baseEmbed(card)
    .setTitle(`${card.emoji} ${card.name}`)
    .setDescription(`**Serie:** ${card.series}\n**Rarità:** ${labelOf(card.rarity)} ${stars(card.rarity)}`)
    .addFields(
      { name: 'Copie tue', value: String(qty), inline: true },
      { name: 'Collezionisti', value: String(owners), inline: true },
    );
  if (wanted) embed.addFields({ name: 'Wishlist', value: '⭐ In wishlist', inline: true });
  return embed;
}
