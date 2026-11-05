import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { catalog } from './cards.js';
import { commands, handleAutocomplete, handleButton, handleCommand } from './commands.js';
import { openDatabase } from './db.js';
import { DropManager } from './drops.js';

export function createClient() {
  return new Client({
    // Nessun intent privilegiato: i claim passano dai pulsanti, non dai messaggi.
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });
}

export async function startBot(config) {
  const db = openDatabase(config.databaseFile);
  const client = createClient();
  const drops = new DropManager({ db, config, catalog, client });
  const ctx = { db, config, drops, client };

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) await handleAutocomplete(interaction);
      else if (interaction.isChatInputCommand()) await handleCommand(interaction, ctx);
      else if (interaction.isButton()) await handleButton(interaction, ctx);
    } catch (error) {
      console.error('[interazione]', error);
    }
  });

  client.once(Events.ClientReady, async (ready) => {
    const payload = commands.map((command) => command.builder.toJSON());
    try {
      if (config.guildId) await ready.application.commands.set(payload, config.guildId);
      else await ready.application.commands.set(payload);
      console.log(
        `✅ Online come ${ready.user.tag} — ${payload.length} comandi registrati ` +
          `(${config.guildId ? `guild ${config.guildId}` : 'globalmente'}).`,
      );
    } catch (error) {
      console.error('[registrazione comandi]', error);
    }
    ready.user.setActivity('le carte cadere', { type: ActivityType.Watching });
    console.log(`📚 Catalogo: ${catalog.length} carte.`);

    // Da qui in poi possiamo mandare i DM di fine cooldown, anche quelli scaduti
    // mentre il bot era spento.
    drops.watchCooldowns();
  });

  client.on(Events.Error, (error) => console.error('[client]', error));

  await client.login(config.token);
  return client;
}
