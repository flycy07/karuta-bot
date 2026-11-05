import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { catalog, cardsBySeries, getCard, rarityRank, seriesList } from './cards.js';
import * as db from './db.js';
import { cardInfoEmbed, colorOf, labelOf, stars } from './embeds.js';
import { findCardsByName, formatWait, matchesCard, normalizeName, rollDrop } from './game.js';

const MAX_LIST = 20;

function ephemeral(interaction, content) {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/** Solo chi ha "Gestire il server" (o il ruolo configurato) può scegliere le carte da droppare. */
function isAdmin(interaction, ctx) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roleId = ctx.config.adminRoleId;
  return Boolean(roleId && interaction.member?.roles?.cache?.has(roleId));
}

function resolveCard(query) {
  const q = normalizeName(query);
  if (!q) return { error: 'Scrivi il nome di una carta.' };
  const exact = catalog.find((card) => matchesCard(card, q));
  if (exact) return { card: exact };
  const partial = catalog.filter(
    (card) => normalizeName(card.name).includes(q) || card.id === q || normalizeName(card.series) === q,
  );
  if (partial.length === 1) return { card: partial[0] };
  if (partial.length > 1) return { candidates: partial };
  return { error: `Nessuna carta trovata per **${query}**.` };
}

function resolveOwnedCard(userId, query, database) {
  const owned = new Set(db.getCollection(database, userId).map((row) => row.card_id));
  const q = normalizeName(query);
  if (!q) return { error: 'Specifica il nome di una carta.' };
  const pool = catalog.filter((card) => owned.has(card.id));
  const exact = pool.find((card) => matchesCard(card, q));
  if (exact) return { card: exact };
  const partial = pool.filter((card) => normalizeName(card.name).includes(q));
  if (partial.length === 1) return { card: partial[0] };
  if (partial.length > 1) return { candidates: partial };
  return { error: `Non hai nessuna carta che corrisponde a **${query}**.` };
}

function ownedLines(rows, limit = MAX_LIST) {
  const entries = rows
    .map((row) => ({ card: getCard(row.card_id), qty: row.qty }))
    .filter((entry) => entry.card)
    .sort((a, b) => rarityRank(b.card.rarity) - rarityRank(a.card.rarity) || a.card.name.localeCompare(b.card.name));
  const visible = entries.slice(0, limit).map(
    (entry) => `${entry.card.emoji} **${entry.card.name}** · ${entry.card.series}${entry.qty > 1 ? ` ×${entry.qty}` : ''}`,
  );
  return { entries, visible };
}

export const commands = [
  {
    builder: new SlashCommandBuilder()
      .setName('drop')
      .setDescription('Fa cadere delle carte a caso nel canale.')
      .addIntegerOption((option) =>
        option.setName('quantita').setDescription('Quante carte (1-5)').setMinValue(1).setMaxValue(5),
      )
      .addStringOption((option) =>
        option.setName('carta').setDescription('Solo admin: una carta specifica').setAutocomplete(true),
      )
      .addStringOption((option) =>
        option.setName('serie').setDescription('Solo admin: pesca a caso solo da questa serie').setAutocomplete(true),
      ),
    async run(interaction, ctx) {
      const amount = interaction.options.getInteger('quantita') ?? 3;
      const cardQuery = interaction.options.getString('carta');
      const seriesQuery = interaction.options.getString('serie');

      if ((cardQuery || seriesQuery) && !isAdmin(interaction, ctx)) {
        return ephemeral(
          interaction,
          'Scegliere una carta o una serie è riservato agli admin (**Gestire il server** o ruolo in `ADMIN_ROLE_ID`). ' +
            'Senza opzioni il drop è a caso e lo può fare chiunque.',
        );
      }

      let pool = catalog;
      if (seriesQuery) {
        const wanted = normalizeName(seriesQuery);
        const series = seriesList().find((name) => normalizeName(name).includes(wanted));
        if (!series) return ephemeral(interaction, `Serie sconosciuta: **${seriesQuery}**.`);
        pool = cardsBySeries(series);
      }

      let cards;
      if (cardQuery) {
        const matches = findCardsByName(pool, cardQuery);
        if (!matches.length) return ephemeral(interaction, `Nessuna carta trovata per **${cardQuery}**.`);
        if (matches.length > 1) {
          return ephemeral(
            interaction,
            `Più carte corrispondono: ${matches.slice(0, 8).map((card) => card.name).join(', ')}`,
          );
        }
        cards = matches;
      } else {
        cards = rollDrop(pool, amount);
      }

      const wait = ctx.drops.cooldownRemaining(interaction.user.id);
      if (wait > 0) {
        return ephemeral(
          interaction,
          `⏳ Puoi droppare di nuovo tra **${formatWait(wait)}**. ` +
            'Ti scrivo in privato appena l\'attesa è finita.',
        );
      }
      if (!interaction.channel?.isSendable?.()) return ephemeral(interaction, 'Non posso scrivere in questo canale.');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await ctx.drops.start({
          channel: interaction.channel,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          cards,
        });
        await interaction.editReply({
          content:
            `🎴 Droppate **${cards.length}** cart${cards.length === 1 ? 'a' : 'e'}! ` +
            `Prossimo drop tra ${formatWait(ctx.config.dropCooldownMs)}: ti avviso in privato.`,
        });
      } catch (error) {
        await interaction.editReply({ content: `Errore nel drop: ${error.message}` });
      }
    },
  },
  {
    builder: new SlashCommandBuilder()
      .setName('collection')
      .setDescription('Mostra la collezione di carte.')
      .addUserOption((option) => option.setName('utente').setDescription('Di chi vuoi vedere la collezione')),
    async run(interaction, ctx) {
      const target = interaction.options.getUser('utente') ?? interaction.user;
      const rows = db.getCollection(ctx.db, target.id);
      if (!rows.length) {
        return ephemeral(interaction, `**${target.username}** non ha ancora nessuna carta. Prova a indovinare un drop!`);
      }
      const { entries, visible } = ownedLines(rows);
      const copies = entries.reduce((sum, entry) => sum + entry.qty, 0);
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(`Collezione di ${target.username}`)
        .setDescription(visible.join('\n') + (entries.length > visible.length ? `\n*…e altre ${entries.length - visible.length}*` : ''))
        .setFooter({ text: `${entries.length} carte uniche · ${copies} copie totali` });
      return interaction.reply({ embeds: [embed] });
    },
  },
  {
    builder: new SlashCommandBuilder()
      .setName('card')
      .setDescription('Scheda di una carta: rarità, serie e chi la possiede.')
      .addStringOption((option) => option.setName('nome').setDescription('Nome (anche parziale)').setRequired(true)),
    async run(interaction, ctx) {
      const result = resolveCard(interaction.options.getString('nome', true));
      if (result.error) return ephemeral(interaction, result.error);
      if (result.candidates) {
        const names = result.candidates.slice(0, 10).map((card) => `• ${card.name} — ${card.series}`);
        return ephemeral(interaction, `Più carte corrispondono:\n${names.join('\n')}`);
      }
      const card = result.card;
      const row = db.getCollection(ctx.db, interaction.user.id).find((entry) => entry.card_id === card.id);
      const wishes = db.listWishes(ctx.db, interaction.user.id);
      return interaction.reply({
        embeds: [
          cardInfoEmbed(card, {
            qty: row?.qty ?? 0,
            owners: db.countOwners(ctx.db, card.id),
            wanted: wishes.includes(card.id),
          }),
        ],
      });
    },
  },
  {
    builder: new SlashCommandBuilder()
      .setName('series')
      .setDescription('Carte di una serie e quante ne possiedi.')
      .addStringOption((option) => option.setName('nome').setDescription('Nome della serie').setRequired(true)),
    async run(interaction, ctx) {
      const needle = interaction.options.getString('nome', true).toLowerCase();
      const series = seriesList().find((name) => name.toLowerCase().includes(needle));
      if (!series) {
        return ephemeral(interaction, `Serie non trovata. Disponibili:\n${seriesList().map((s) => `• ${s}`).join('\n')}`);
      }
      const owned = new Set(db.getCollection(ctx.db, interaction.user.id).map((row) => row.card_id));
      const cards = cardsBySeries(series).sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
      const lines = cards.map(
        (card) => `${owned.has(card.id) ? '✅' : '⬜'} ${card.emoji} ${card.name} · ${labelOf(card.rarity)} ${stars(card.rarity)}`,
      );
      const done = cards.filter((card) => owned.has(card.id)).length;
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle(series)
            .setDescription(lines.join('\n'))
            .setFooter({ text: `Completata: ${done}/${cards.length}` }),
        ],
      });
    },
  },
  {
    builder: new SlashCommandBuilder()
      .setName('wishlist')
      .setDescription('Gestisci le carte che stai cercando.')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Aggiungi una carta alla wishlist')
          .addStringOption((option) => option.setName('nome').setDescription('Nome della carta').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Togli una carta dalla wishlist')
          .addStringOption((option) => option.setName('nome').setDescription('Nome della carta').setRequired(true)),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('Mostra la tua wishlist')),
    async run(interaction, ctx) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'list') {
        const wishes = db.listWishes(ctx.db, interaction.user.id);
        if (!wishes.length) return ephemeral(interaction, 'La tua wishlist è vuota: usa `/wishlist add`.');
        const owned = new Set(db.getCollection(ctx.db, interaction.user.id).map((row) => row.card_id));
        const lines = wishes.map((id) => {
          const card = getCard(id);
          if (!card) return null;
          return `${owned.has(id) ? '✅' : '⭐'} ${card.emoji} **${card.name}** · ${card.series}`;
        });
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2b2d31)
              .setTitle('Wishlist')
              .setDescription(lines.filter(Boolean).slice(0, 25).join('\n')),
          ],
        });
      }

      const result = resolveCard(interaction.options.getString('nome', true));
      if (result.error) return ephemeral(interaction, result.error);
      if (result.candidates) {
        return ephemeral(interaction, `Più carte corrispondono: ${result.candidates.slice(0, 8).map((c) => c.name).join(', ')}`);
      }
      const card = result.card;
      if (sub === 'add') {
        const added = db.addWish(ctx.db, interaction.user.id, card.id);
        return ephemeral(interaction, added ? `⭐ Aggiunta **${card.name}** alla wishlist.` : `**${card.name}** è già in wishlist.`);
      }
      const removed = db.removeWish(ctx.db, interaction.user.id, card.id);
      return ephemeral(interaction, removed ? `🗑️ Tolta **${card.name}** dalla wishlist.` : `**${card.name}** non era in wishlist.`);
    },
  },
  {
    builder: new SlashCommandBuilder()
      .setName('trade')
      .setDescription('Proponi uno scambio a un altro collezionista.')
      .addUserOption((option) => option.setName('utente').setDescription('Con chi vuoi scambiare').setRequired(true))
      .addStringOption((option) =>
        option.setName('dai').setDescription('La carta che offri (devi possederla)').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('ricevi').setDescription("La carta che vuoi dall'altro").setRequired(true),
      ),
    async run(interaction, ctx) {
      const target = interaction.options.getUser('utente', true);
      if (target.id === interaction.user.id) return ephemeral(interaction, 'Non puoi scambiare con te stesso.');
      if (target.bot) return ephemeral(interaction, "I bot non collezionano carte (ancora).");

      const give = resolveOwnedCard(interaction.user.id, interaction.options.getString('dai', true), ctx.db);
      if (give.error) return ephemeral(interaction, give.error);
      if (give.candidates) return ephemeral(interaction, `Sei ambiguo: ${give.candidates.slice(0, 8).map((c) => c.name).join(', ')}`);

      const want = resolveOwnedCard(target.id, interaction.options.getString('ricevi', true), ctx.db);
      if (want.error) return ephemeral(interaction, `**${target.username}** non ha quella carta.`);
      if (want.candidates) return ephemeral(interaction, `Carta richiesta ambigua: ${want.candidates.slice(0, 8).map((c) => c.name).join(', ')}`);

      if (give.card.id === want.card.id) return ephemeral(interaction, 'Le due carte sono la stessa.');

      const id = db.createTrade(ctx.db, {
        fromId: interaction.user.id,
        toId: target.id,
        giveCard: give.card.id,
        wantCard: want.card.id,
      });

      const embed = new EmbedBuilder()
        .setColor(colorOf(want.card.rarity))
        .setTitle('Proposta di scambio')
        .setDescription(
          `<@${interaction.user.id}> offre ${give.card.emoji} **${give.card.name}**\n` +
            `e vuole ${want.card.emoji} **${want.card.name}** da <@${target.id}>.`,
        )
        .setFooter({ text: `Offerta #${id} · solo ${target.username} può rispondere` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`trade:accept:${id}`).setLabel('Accetta').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`trade:decline:${id}`).setLabel('Rifiuta').setStyle(ButtonStyle.Danger),
      );

      return interaction.reply({
        content: `<@${target.id}>`,
        embeds: [embed],
        components: [row],
        allowedMentions: { users: [target.id] },
      });
    },
  },
  {
    builder: new SlashCommandBuilder().setName('top').setDescription('Classifica dei collezionisti del server.'),
    async run(interaction, ctx) {
      const rows = db.topCollectors(ctx.db, 10);
      if (!rows.length) return ephemeral(interaction, 'Nessuno ha ancora carte.');
      const medals = ['🥇', '🥈', '🥉'];
      const lines = rows.map(
        (row, index) => `${medals[index] ?? `${index + 1}.`} <@${row.id}> — **${row.unique_cards}** uniche · ${row.claims} claim`,
      );
      const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle('Top collezionisti').setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] });
    },
  },
  {
    builder: new SlashCommandBuilder().setName('help').setDescription('Come funziona il bot.'),
    async run(interaction) {
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('Come si gioca')
        .setDescription(
          [
            '**1.** Chiunque può usare `/drop`: cadono carte a caso. Gli admin possono scegliere carta o serie.',
            '**2.** Compaiono le carte coperte con i pulsanti **1**, **2**, **3**…: chi clicca per primo prende quella carta.',
            '**3.** Una carta a testa per drop, e un cooldown dopo ogni claim.',
            "**4.** Dopo ogni `/drop` devi aspettare 30 minuti: quando l'attesa finisce il bot ti manda un messaggio in privato.",
            '',
            '**Comandi**',
            '`/drop [quantita] [carta] [serie]` · tutti; carta/serie solo admin',
            '`/collection [utente]` · la tua collezione',
            '`/card <nome>` · scheda carta',
            '`/series <nome>` · carte di una serie',
            '`/wishlist add|remove|list` · carte che cerchi',
            '`/trade @utente <dai> <ricevi>` · scambio',
            '`/top` · classifica',
          ].join('\n'),
        );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
];

export async function handleCommand(interaction, ctx) {
  const command = commands.find((entry) => entry.builder.name === interaction.commandName);
  if (!command) return;
  try {
    await command.run(interaction, ctx);
  } catch (error) {
    console.error(`[comando ${interaction.commandName}]`, error);
    const payload = { content: 'Qualcosa è andato storto, riprova.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}

export async function handleButton(interaction, ctx) {
  const [scope, ...rest] = interaction.customId.split(':');
  if (scope === 'claim') return handleClaimButton(interaction, ctx, rest[0], Number(rest[1]));
  if (scope !== 'trade') return;

  const [action, rawId] = rest;

  const trade = db.getTrade(ctx.db, Number(rawId));
  if (!trade) {
    return interaction.update({ content: 'Offerta non trovata.', embeds: [], components: [] });
  }
  if (interaction.user.id !== trade.to_id) {
    return interaction.reply({ content: 'Questa offerta non è per te.', flags: MessageFlags.Ephemeral });
  }
  if (trade.status !== 'pending') {
    return interaction.update({ content: `Offerta già ${trade.status === 'accepted' ? 'accettata' : 'rifiutata'}.`, embeds: [], components: [] });
  }

  if (action === 'decline') {
    db.setTradeStatus(ctx.db, trade.id, 'declined');
    return interaction.update({
      content: `<@${trade.to_id}> ha rifiutato lo scambio #${trade.id}.`,
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  if (action !== 'accept') return;

  if (!db.ownsCard(ctx.db, trade.from_id, trade.give_card)) {
    db.setTradeStatus(ctx.db, trade.id, 'cancelled');
    return interaction.update({ content: 'Offerta annullata: chi propone non ha più quella carta.', embeds: [], components: [] });
  }
  if (!db.ownsCard(ctx.db, trade.to_id, trade.want_card)) {
    db.setTradeStatus(ctx.db, trade.id, 'cancelled');
    return interaction.update({ content: 'Offerta annullata: la carta richiesta non è più disponibile.', embeds: [], components: [] });
  }

  db.removeCard(ctx.db, trade.from_id, trade.give_card);
  db.removeCard(ctx.db, trade.to_id, trade.want_card);
  db.grantCard(ctx.db, trade.to_id, trade.give_card);
  db.grantCard(ctx.db, trade.from_id, trade.want_card);
  db.setTradeStatus(ctx.db, trade.id, 'accepted');

  const give = getCard(trade.give_card);
  const want = getCard(trade.want_card);
  return interaction.update({
    content: `✅ Scambio #${trade.id} completato: **${give?.name}** ↔ **${want?.name}**.`,
    embeds: [],
    components: [],
    allowedMentions: { parse: [] },
  });
}

/** Pulsante numerato di un drop: prenota la carta se è ancora libera. */
async function handleClaimButton(interaction, ctx, sessionId, index) {
  const outcome = await ctx.drops.claim({
    sessionId,
    userId: interaction.user.id,
    username: interaction.user.username,
    index,
  });

  if (outcome.result === 'closed') {
    return interaction.reply({ content: 'Questo drop non è più attivo.', flags: MessageFlags.Ephemeral });
  }
  if (outcome.result === 'invalid') {
    return interaction.reply({ content: 'Carta inesistente in questo drop.', flags: MessageFlags.Ephemeral });
  }
  if (outcome.result === 'taken') {
    return interaction.reply({
      content: `Quella carta l'ha già presa <@${outcome.owner}>.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
  if (outcome.result === 'already') {
    return interaction.reply({
      content: 'In questo drop hai già preso una carta: una a testa.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (outcome.result === 'cooldown') {
    return interaction.reply({
      content: `⏳ Ancora ${Math.ceil(outcome.retryInMs / 1000)}s di cooldown.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.update({
    embeds: ctx.drops.renderEmbeds(outcome.session),
    components: ctx.drops.renderComponents(outcome.session),
  });
  return interaction.followUp({
    content: `🎴 Hai preso ${outcome.card.emoji} **${outcome.card.name}** · ${outcome.card.series}!`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Autocomplete per le opzioni `carta` e `serie` di /drop. */
export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const query = normalizeName(focused.value ?? '');
  const source = focused.name === 'serie' ? seriesList() : catalog.map((card) => card.name);
  const matches = source.filter((value) => normalizeName(value).includes(query)).slice(0, 25);
  await interaction.respond(matches.map((value) => ({ name: value.slice(0, 100), value: value.slice(0, 100) })));
}
