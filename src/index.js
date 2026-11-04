import { config } from './config.js';
import { startBot } from './bot.js';

if (!config.token) {
  console.error(
    [
      '❌ DISCORD_TOKEN mancante.',
      '',
      '1. Vai su https://discord.com/developers/applications e crea una nuova Application.',
      '2. Tab "Bot" -> "Reset Token" e copia il token.',
      '3. Sempre in "Bot", abilita "MESSAGE CONTENT INTENT".',
      '4. Copia .env.example in .env e incolla il token in DISCORD_TOKEN.',
      '5. Invita il bot con lo scope bot + applications.commands.',
      '',
      'Poi rilancia: npm start',
    ].join('\n'),
  );
  process.exit(1);
}

startBot(config).catch((error) => {
  console.error('Avvio fallito:', error.message);
  process.exit(1);
});
