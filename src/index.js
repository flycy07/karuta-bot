import { catalog } from './cards.js';
import { config } from './config.js';
import { startBot } from './bot.js';
import { startStatusServer } from './server.js';

if (!config.token) {
  console.error(
    [
      '❌ DISCORD_TOKEN mancante.',
      '',
      '1. Vai su https://discord.com/developers/applications e crea una nuova Application.',
      '2. Tab "Bot" -> "Reset Token" e copia il token.',
      '3. Copia .env.example in .env e incolla il token in DISCORD_TOKEN.',
      '4. Invita il bot con lo scope bot + applications.commands.',
      '5. Per droppare carte ti serve il permesso "Gestire il server" (o imposta ADMIN_ROLE_ID).',
      '',
      'Poi rilancia: npm start',
    ].join('\n'),
  );
  process.exit(1);
}

// Su Render (e host simili) la piattaforma assegna una porta e spegne i servizi
// gratuiti che non ricevono traffico: apriamo una piccola dashboard di stato così
// c'è qualcosa da pingare. In locale, senza PORT, non parte nessun server HTTP.
let client = null;

if (process.env.PORT) {
  const port = Number.parseInt(process.env.PORT, 10) || 3000;
  await startStatusServer({
    port,
    getStatus: () => ({
      bot: client?.user?.tag ?? null,
      ready: Boolean(client?.isReady?.()),
      servers: client?.guilds?.cache?.size ?? 0,
      cards: catalog.length,
    }),
  });
  console.log(`🌐 Dashboard di stato sulla porta ${port} (/health per i ping).`);
}

try {
  client = await startBot(config);
} catch (error) {
  console.error('Avvio fallito:', error.message);
  process.exit(1);
}
