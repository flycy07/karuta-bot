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

/** Carta ancora coperta: mostra solo serie e rarità (usato se manca l'immagine). */
export function hiddenCardEmbed(card, { index, total, expiresAt }) {
  const embed = baseEmbed(card)
    .setTitle(`${card.emoji} ${stars(card.rarity)}`)
    .setDescription(
      `**Serie:** ${card.series}\n\n*Clicca il numero qui sotto per prenderla.*\n` +
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

/** Carta mostrata come immagine pura: solo l'artwork, senza testo sopra. */
export function cardImageEmbed(card, { attachment, url } = {}) {
  const embed = new EmbedBuilder().setColor(colorOf(card.rarity));
  const source = attachment ? `attachment://${attachment}` : url;
  if (source) embed.setImage(source);
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
