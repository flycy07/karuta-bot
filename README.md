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
nel tab *Startup*, comando di avvio `node src/index.js`. Le immagini non stanno nel
repository: dopo il primo avvio lancia una volta `npm run art && npm run cards` nella
console del server, altrimenti i drop restano senza immagine.

**Render** (free): il servizio è un *web service*, quindi Render pretende una porta HTTP e
spegne l'istanza dopo 15 minuti senza traffico in ingresso. Per questo il bot avvia una
piccola dashboard di stato quando esiste la variabile `PORT` (Render la imposta da sola):
`/` mostra una pagina, `/health` risponde JSON. In locale, senza `PORT`, non parte nessun
server e `npm start` si comporta come prima.

1. Render → *New* → *Web Service* (o il `render.yaml` del repo) → piano Free, build
   `npm install --include=dev && npm run art && npm run cards`, start `npm start`.
   La build scarica gli artwork e genera le 160 carte: non serve lanciare niente a
   mano nella console e ogni deploy riparte con le immagini già pronte (la build
   richiede un paio di minuti in più, le devDependencies servono proprio a questo).
   Se hai lasciato il comando di build a `npm install`, non serve cambiarlo: c'è un
   `postinstall` (`scripts/install-images.js`) che su Render genera le immagini
   durante la build e in locale non fa niente.
2. Variabili: `DISCORD_TOKEN`, e se vuoi `GUILD_ID`, `ADMIN_ROLE_ID`, `NODE_VERSION=22.22.0`.
3. Fai pingare `https://<servizio>.onrender.com/health` ogni 10 minuti da un cron esterno
   (cron-job.org, UptimeRobot): senza traffico l'istanza si addormenta e il bot va offline.
4. **Attenzione**: sui piani free il disco è effimero, quindi `data/yomi.db` si azzera a
   ogni riavvio o deploy e le collezioni si perdono. Per conservarle serve un disco
   persistente (a pagamento) o un database esterno.

## Come si gioca

0. **Canale dei drop** (admin): `/dropchannel set [canale]` limita `/drop` a un solo canale
   (senza `canale` usa quello in cui scrivi), `/dropchannel show` lo mostra e
   `/dropchannel clear` toglie la restrizione. Fuori da quel canale `/drop` risponde
   con il canale giusto. Il bot controlla subito di avere i permessi necessari lì; se il
   canale viene cancellato la restrizione cade da sola. La scelta sta su SQLite, per
   server, accanto alle collezioni: non le tocca e sopravvive ai riavvii.
1. Chiunque può usare `/drop`: cadono da 1 a 5 carte a caso. Gli **admin** possono anche
   scegliere cosa far cadere, con una carta specifica (`carta:`) o con una serie
   (`serie:`); entrambe le opzioni hanno l'autocomplete.
2. Compaiono le carte **coperte** (solo serie e rarità) con i pulsanti **1**, **2**, **3**…
3. Chi clicca per primo il pulsante di una carta la prende: la carta si rivela nel
   messaggio del drop e il pulsante si disabilita.
4. Una carta a testa per drop e cooldown personale dopo ogni claim.
5. Dopo un `/drop` c'è un'attesa di **30 minuti** prima di poterne fare un altro: quando
   scade, il bot ti manda un **messaggio in privato** per avvisarti.

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

## Immagini delle carte

Nel drop ogni carta è **solo la sua immagine**, senza testo sopra, con i pulsanti numerati
sotto: è il formato "cartolina" dei bot tipo Karuta.

Quattro modi per dare un'immagine a una carta, in ordine di preferenza:

1. **Farsele scaricare online** con `npm run art`: lo script interroga l'API pubblica di
   [AniList](https://anilist.co) (gratis, nessuna chiave da chiedere), cerca ogni
   personaggio **dentro la sua serie** e salva l'immagine in `assets/art/<id>.png`.
   Poi `npm run cards` la mette nella sua cornice. Fa una richiesta per serie,
   non per carta, e scarica solo quelle che mancano (`--force` le riscarica tutte).
2. **PNG già pronto** in `assets/cards/<id>.png` (es. `assets/cards/satoru-gojo.png`):
   il bot lo invia come allegato, nessun hosting esterno da configurare.
3. **Artwork tuo** in `assets/art/<id>.png` + `npm run cards`: lo script mette
   l'artwork sotto la cornice e scrive nome e serie sulle targhette. Cerca il file per
   `id` e poi per nome normalizzato (`Satoru Gojo` → `satoru-gojo.png`).
4. **URL nel catalogo**: campo `image` di `cards.json`, se le immagini sono già online.

Se un personaggio non viene trovato (nomi traslitterati in modo strano, comprimari) lo
script lo dice e puoi mettergli l'immagine a mano in `assets/art/<id>.png`: il resto
funziona lo stesso.

Se l'host esegue solo `npm install` e non genera le carte in build, il bot se ne accorge
all'avvio: con `assets/cards/` vuota lancia da sé lo scaricamento e la composizione in
background (`src/images.js`), così i drop passano alle immagini appena sono pronte senza
riavviare niente. Si disattiva con `YOMI_SKIP_IMAGES=1`.

### Cornici: dove metterle

Le cornici vanno nella cartella **`assets/frames/`** (dentro il progetto, accanto a
`src/`), in uno dei due formati:

```
assets/frames/frames.png           ← un solo file con le cornici affiancate
assets/frames/frame-1.png … frame-6.png   ← oppure già separate
```

Con il foglio unico non devi ritagliare niente: alla prima esecuzione `npm run cards`
lo divide da sé in `frame-1.png` … `frame-N.png`. Riconosce dove finisce una cornice e
comincia la successiva, quindi vanno bene anche cornici di larghezza diversa o
distanziate in modo irregolare, e quante ne vuoi (5, 6…). **Non ritagliarle a mano:**
basta il foglio intero.

Le cornici sono **solo decorative**, non legate alle rarità: ogni carta ne riceve una,
sempre la stessa per quella carta (dipende dal suo id), così rigenerando le carte le
immagini non cambiano.

Se vuoi vedere subito cosa esce, `npm run frames` fa la stessa cosa da sola e scrive
anche un'anteprima in `artifacts/frames-preview.png` (le cornici sopra uno sfondo
colorato, per controllare che il centro sia davvero trasparente):

```bash
npm run frames                            # legge assets/frames/frames.png
npm run frames -- --inset-x 6 --inset-y 4 # finestra più larga (se resta un bordo scuro)
npm run frames -- --keep-alpha            # cornici già trasparenti al centro
```

Perché funzionino serve che il centro della cornice risulti trasparente, così sotto si
vede l'artwork del personaggio: un centro bianco o opaco coprirebbe la carta. Non devi
ritoccare il foglio a mano: dividendo le cornici (`npm run frames` o `npm run cards`)
l'interno viene aperto in automatico. Se l'interno è **bianco** viene svuotato seguendo
il disegno, così i decori che sporgono verso il centro restano intatti; altrimenti si
apre una finestra rettangolare. Se resta visibile un bordo di pixel attorno all'artwork,
allarga la finestra con `--inset-x` / `--inset-y` più piccoli (es. `--inset-x 6 --inset-y 3`).

Senza cartella `assets/frames/` (o finché è vuota) lo script disegna una cornice sobria
propria, quindi il bot funziona comunque. Le carte senza immagine usano l'embed
testuale di prima (serie e rarità coperte). `assets/cards/` e `assets/art/` sono
generate e stanno nel `.gitignore`: non finiscono nel repository.

Le immagini dei personaggi sono file tuoi: il repository non include artwork protetti,
quindi il catalogo resta di soli nomi finché non aggiungi gli originali.

## Sviluppo

```bash
npm test     # test del motore di gioco (node:test, nessuna dipendenza)
npm run demo # simula un drop con i pulsanti nel terminale, senza token
npm run art  # scarica online gli artwork dei personaggi in assets/art/
npm run cards # genera le immagini delle carte in assets/cards/ (artwork + cornice)
```

## Struttura

```
src/
  config.js    variabili d'ambiente
  cards.js     caricamento catalogo
  game.js      motore puro: rarità, pesca, claim via pulsante, cooldown
  db.js        SQLite (utenti, inventario, wishlist, trade, canale dei drop)
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
- Un drop per canale alla volta; ogni utente può usare `/drop` una volta ogni 30 minuti
  (`DROP_COOLDOWN_MINUTES`, in minuti, default `30`; il vecchio `DROP_COOLDOWN_MS` in
  millisecondi viene ignorato). Alla scadenza il bot manda un DM all'utente che ha lanciato
  il drop. Il cooldown sta su SQLite, quindi l'avviso arriva anche se nel frattempo il bot
  è stato riavviato o ridistribuito; `DROP_NOTIFY_INTERVAL_MS` decide ogni quanto
  controllare i cooldown scaduti (default 30s).
- Le sessioni di drop attive stanno in memoria (si perdono al riavvio); collezioni e
  cooldown sono su SQLite e sopravvivono.
- Gli scambi riverificano il possesso delle carte al click di *Accetta*, quindi non si
  possono duplicare carte con due offerte in parallelo.
