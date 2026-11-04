# Yomi

**Yomi** è un bot Discord per collezionare carte in stile **Karuta**: le carte cadono in
chat e si prendono cliccando il pulsante numerato della carta (chi arriva primo, vince).
Il drop a caso è aperto a tutti i membri, mentre scegliere **quali** carte far cadere è
riservato agli admin. Collezione, wishlist, serie, scambi e classifica inclusi.

- Node 22.13+ (usa `node:sqlite`, quindi **nessuna dipendenza nativa da compilare**)
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

Al primo avvio crea `data/yomi.db` e registra i comandi slash. Senza `GUILD_ID` la
registrazione è globale e può richiedere fino a un'ora per comparire; con `GUILD_ID`
è immediata.

## Dove tenerlo online

Il bot deve restare acceso: se il processo muore, i drop smettono di funzionare.

**Wispbyte** (free, filesystem persistente): immagine Docker **Node.js 22.13+ o 24**
(`node:sqlite` esiste da 22.5 ma funziona senza flag solo da 22.13), codice via *GitHub
Integration* o upload della zip, variabili `DISCORD_TOKEN`, `GUILD_ID` e `ADMIN_ROLE_ID`
nel tab *Startup*, comando di avvio `node src/index.js`.

**Render** (free): il servizio è un *web service*, quindi Render pretende una porta HTTP e
spegne l'istanza dopo 15 minuti senza traffico in ingresso. Per questo il bot avvia una
piccola dashboard di stato quando esiste la variabile `PORT` (Render la imposta da sola):
`/` mostra una pagina, `/health` risponde JSON. In locale, senza `PORT`, non parte nessun
server e `npm start` si comporta come prima.

1. Render → *New* → *Web Service* (o il `render.yaml` del repo) → piano Free, build
   `npm install`, start `npm start`.
2. Variabili: `DISCORD_TOKEN`, e se vuoi `GUILD_ID`, `ADMIN_ROLE_ID`, `NODE_VERSION=22.22.0`.
3. Fai pingare `https://<servizio>.onrender.com/health` ogni 10 minuti da un cron esterno
   (cron-job.org, UptimeRobot): senza traffico l'istanza si addormenta e il bot va offline.
4. **Attenzione**: sui piani free il disco è effimero, quindi `data/yomi.db` si azzera a
   ogni riavvio o deploy e le collezioni si perdono. Per conservarle serve un disco
   persistente (a pagamento) o un database esterno.

## Come si gioca

1. Chiunque può usare `/drop`: cadono da 1 a 5 carte a caso. Gli **admin** possono anche
   scegliere cosa far cadere, con una carta specifica (`carta:`) o con una serie
   (`serie:`); entrambe le opzioni hanno l'autocomplete.
2. Compaiono le carte **coperte** (solo serie e rarità) con i pulsanti **1**, **2**, **3**…
3. Chi clicca per primo il pulsante di una carta la prende: la carta si rivela nel
   messaggio del drop e il pulsante si disabilita.
4. Una carta a testa per drop e cooldown personale dopo ogni claim.

Non serve scrivere niente in chat, quindi il bot non richiede **Message Content Intent**.

## Chi può droppare

Il drop a caso è aperto a tutti i membri del server. Scegliere **quali** carte far cadere
(`carta:`, `serie:`) è riservato a chi ha il permesso **Gestire il server** oppure ha il
ruolo indicato in `ADMIN_ROLE_ID` nel `.env`: un membro normale che prova a specificarle
riceve un messaggio privato di errore.

## Comandi

| Comando | Chi | Cosa fa |
| --- | --- | --- |
| `/drop [quantita] [carta] [serie]` | tutti (carta/serie: admin) | Fa cadere carte a caso o scelte |
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
