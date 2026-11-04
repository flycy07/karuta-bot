# Karuta-style bot

Bot Discord in stile **Karuta**: un admin fa cadere delle carte, gli utenti le prendono
cliccando il pulsante numerato della carta che vogliono (chi arriva primo, vince).
Collezione, wishlist, serie, scambi e classifica inclusi.

- Node 22.5+ (usa `node:sqlite`, quindi **nessuna dipendenza nativa da compilare**)
- discord.js v14, **nessun intent privilegiato** (niente Message Content)
- Catalogo con personaggi di anime esistenti, modificabile da JSON
- Motore di gioco puro e testabile (`src/game.js`), senza Discord né database

## Avvio in 5 minuti

1. Crea una Application su <https://discord.com/developers/applications>.
2. Tab **Bot** → *Reset Token* → copia il token.
3. Copia `.env.example` in `.env` e incolla il token:
   ```bash
   cp .env.example .env
   # DISCORD_TOKEN=...
   ```
4. Invita il bot con gli scope `bot` + `applications.commands` (URL dalla tab OAuth2).
5. ```bash
   npm install
   npm start
   ```

Al primo avvio crea `data/karuta.db` e registra i comandi slash. Senza `GUILD_ID` la
registrazione è globale e può richiedere fino a un'ora per comparire; con `GUILD_ID`
è immediata.

## Come si gioca

1. Un **admin** usa `/drop`: può far cadere N carte a caso, oppure una carta specifica
   (`carta:`), oppure N carte di una sola serie (`serie:`). Entrambe le opzioni hanno
   l'autocomplete: scrivi due lettere e scegli dalla lista.
2. Compaiono le carte **coperte** (solo serie e rarità) con i pulsanti **1**, **2**, **3**…
3. Chi clicca per primo il pulsante di una carta la prende: la carta si rivela nel
   messaggio del drop e il pulsante si disabilita.
4. Una carta a testa per drop e cooldown personale dopo ogni claim.

Non serve scrivere niente in chat, quindi il bot non richiede **Message Content Intent**.

## Chi può droppare

`/drop` è riservato a chi ha il permesso **Gestire il server** oppure ha il ruolo
indicato in `ADMIN_ROLE_ID` nel `.env`. Tutti gli altri ricevono un messaggio privato
di errore e non possono far cadere carte.

## Comandi

| Comando | Chi | Cosa fa |
| --- | --- | --- |
| `/drop [quantita] [carta] [serie]` | admin | Fa cadere le carte scelte (o pescate a caso) |
| `/collection [utente]` | tutti | Collezione con copie e carte uniche |
| `/card <nome>` | tutti | Scheda carta, copie possedute, collezionisti |
| `/series <nome>` | tutti | Tutte le carte della serie con ✅/⬜ |
| `/wishlist add\|remove\|list` | tutti | Carte che stai cercando |
| `/trade @utente <dai> <ricevi>` | tutti | Scambio con bottoni Accetta/Rifiuta |
| `/top` | tutti | Classifica per carte uniche |
| `/help` | tutti | Regole rapide |

## Personalizzare le carte

Tutto in [`src/data/cards.json`](src/data/cards.json): 20 serie, 160 personaggi di anime
esistenti (Naruto, One Piece, Attack on Titan, Demon Slayer, Jujutsu Kaisen, Chainsaw Man,
Frieren, Oshi no Ko e altri).

```json
{
  "id": "mio-personaggio",
  "name": "Mio Personaggio",
  "series": "La Mia Serie",
  "rarity": "rare",
  "emoji": "🌸",
  "image": "https://esempio.com/carta.png"
}
```

- `id` deve essere unico, `rarity` tra `common`, `uncommon`, `rare`, `epic`, `legendary`.
- `image` è opzionale: se presente l'embed mostra l'artwork (Discord non mostra SVG
  inline, quindi usa PNG/JPG/WEBP).
- I pesi delle rarità sono in `src/game.js` → `RARITIES`
  (common 60%, uncommon 25%, rare 10%, epic 4%, legendary 1%).
- Il catalogo è solo un elenco di nomi: nessuna immagine o asset protetto è incluso.

## Sviluppo

```bash
npm test     # test del motore di gioco (node:test, nessuna dipendenza)
npm run demo # simula un drop con i pulsanti nel terminale, senza token
```

## Struttura

```
src/
  config.js    variabili d'ambiente
  cards.js     caricamento catalogo
  game.js      motore puro: rarità, pesca, claim via pulsante, cooldown
  db.js        SQLite (utenti, inventario, wishlist, trade)
  embeds.js    embed delle carte
  drops.js     sessioni di drop attive, pulsanti e claim
  commands.js  comandi slash, autocomplete e bottoni
  bot.js       client Discord
  index.js     entry point
scripts/demo.js  demo nel terminale
test/            test del motore
```

## Note

- Il bot ha bisogno di `Send Messages`, `Embed Links` e `Read Message History` nei canali
  dove droppa.
- Un drop per canale alla volta; `/drop` ha un cooldown per server (`DROP_COOLDOWN_MS`).
- Le sessioni di drop attive stanno in memoria (si perdono al riavvio); collezioni e
  cooldown sono su SQLite e sopravvivono.
- Gli scambi riverificano il possesso delle carte al click di *Accetta*, quindi non si
  possono duplicare carte con due offerte in parallelo.
