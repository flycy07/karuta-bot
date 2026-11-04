import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { catalog } from './cards.js';
import { commands, handleButton, handleCommand } from './commands.js';
import { openDatabase } from './db.js';
import { DropManager } from './drops.js';

export function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // Necessario per leggere i nomi scritti in chat durante un drop.
      // Va abilitato anche nel Developer Portal (Bot -> Message Content Intent).
      GatewayIntentBits.MessageContent,
    ],
  });
}

export async function startBot(config) {
  const db = openDatabase(config.databaseFile);
  const client = createClient();
  const drops = new DropManager({ db, config, catalog });
  const ctx = { db, config, drops, client };

  client.on(Events.MessageCreate, (message) => {
    drops.handleMessage(message).catch((error) => console.error('[drop]', error));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) await handleCommand(interaction, ctx);
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
  });

  client.on(Events.Error, (error) => console.error('[client]', error));

  await client.login(config.token);
  return client;
}
