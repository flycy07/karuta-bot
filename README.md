# Karuta-style bot

Bot Discord in stile **Karuta**: le carte cadono in chat, il primo che scrive il nome del
personaggio le prende. Collezione, wishlist, serie, scambi e classifica inclusi.

- Node 22.5+ (usa `node:sqlite`, quindi **nessuna dipendenza nativa da compilare**)
- discord.js v14
- Motore di gioco puro e testabile (`src/game.js`), senza Discord né database

## Avvio in 5 minuti

1. Crea una Application su <https://discord.com/developers/applications>.
2. Tab **Bot** → *Reset Token* → copia il token.
3. Sempre in **Bot**, abilita **MESSAGE CONTENT INTENT** (serve per leggere i nomi in chat).
4. Copia `.env.example` in `.env` e incolla il token:
   ```bash
   cp .env.example .env
   # DISCORD_TOKEN=...
   ```
5. Invita il bot con gli scope `bot` + `applications.commands` (URL dalla tab OAuth2).
6. ```bash
   npm install
   npm start
   ```

Al primo avvio crea `data/karuta.db` e registra i comandi slash. Senza `GUILD_ID` la
registrazione è globale e può richiedere fino a un'ora per comparire; con `GUILD_ID`
è immediata.

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `/drop [quantita]` | Fa cadere 1-5 carte coperte (serie + rarità visibili, nome da indovinare) |
| `/collection [utente]` | Collezione con copie e carte uniche |
| `/card <nome>` | Scheda carta, copie possedute, numero di collezionisti |
| `/series <nome>` | Tutte le carte della serie con ✅/⬜ |
| `/wishlist add\|remove\|list` | Carte che stai cercando |
| `/trade @utente <dai> <ricevi>` | Proposta di scambio con bottoni Accetta/Rifiuta |
| `/top` | Classifica per carte uniche |
| `/help` | Regole rapide |

## Come funziona un claim

- Il drop resta aperto `DROP_DURATION_MS` (default 60s) e viene **aggiornato in place**: la
  carta indovinata si rivela nell'embed originale.
- Il confronto è normalizzato: maiuscole, accenti e punteggiatura non contano
  (`Nozomi KŌRI!` = `nozomi kori`), e ogni carta può avere `aliases` nel catalogo.
- Al nome sbagliato scatta uno strike; al terzo (`MAX_STRIKES`) si perde quel drop.
- Dopo un claim riuscito c'è un cooldown personale (`CLAIM_COOLDOWN_MS`, default 20s).
- Il cooldown è salvato su SQLite: sopravvive ai riavvii. Le sessioni di drop attive no.

## Personalizzare le carte

Tutto in [`src/data/cards.json`](src/data/cards.json):

```json
{
  "id": "mio-personaggio",
  "name": "Mio Personaggio",
  "series": "La Mia Serie",
  "rarity": "rare",
  "emoji": "🌸",
  "aliases": ["Mio"],
  "image": "https://esempio.com/carta.png"
}
```

- `rarity`: `common` 60%, `uncommon` 25%, `rare` 10%, `epic` 4%, `legendary` 1%
  (pesi in `src/game.js` → `RARITIES`).
- `image` è opzionale: se presente l'embed mostra l'artwork (Discord non mostra SVG inline,
  quindi usa PNG/JPG/WEBP).
- Il catalogo incluso è **inventato apposta**: sostituiscilo con i tuoi personaggi.

## Sviluppo

```bash
npm test     # test del motore di gioco (node:test, nessuna dipendenza)
npm run demo # simula un drop completo nel terminale, senza token Discord
```

## Struttura

```
src/
  config.js    variabili d'ambiente
  cards.js     caricamento catalogo
  game.js      motore puro: rarità, matching nomi, strike, cooldown
  db.js        SQLite (utenti, inventario, wishlist, trade)
  embeds.js    embed delle carte
  drops.js     sessioni di drop attive + gestione claim
  commands.js  comandi slash e bottoni degli scambi
  bot.js       client Discord
  index.js     entry point
scripts/demo.js  demo nel terminale
test/            test del motore
```

## Note

- Il bot ha bisogno di `Send Messages`, `Embed Links` e `Read Message History` nei canali
  dove droppa.
- Un drop per canale alla volta; `/drop` ha un cooldown per server (`DROP_COOLDOWN_MS`).
- Gli scambi riverificano il possesso delle carte al click di *Accetta*, quindi non si
  possono duplicare carte con due offerte in parallelo.
