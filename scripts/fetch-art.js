/**
 * Scarica online gli artwork dei personaggi e li mette nelle carte.
 *
 * Usa l'API pubblica di AniList (https://anilist.co), gratuita e senza chiave.
 * Per ogni serie del catalogo chiede l'anime e l'elenco dei personaggi, poi
 * abbina ogni carta al personaggio omonimo e salva la sua immagine in
 * `assets/art/<id>.<ext>`. Infine `npm run cards` la compone con la cornice
 * della rarità.
 *
 *   npm run art                 # scarica solo gli artwork mancanti
 *   npm run art -- gojo         # solo le carte il cui id contiene "gojo"
 *   npm run art -- --force      # riscarica anche quelle che ci sono già
 *   npm run art -- --limit 40   # max 40 download per esecuzione
 *
 * AniList senza account consente ~30 richieste al minuto: lo script legge gli
 * header X-RateLimit-* e aspetta da sé quando il budget sta per finire.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog } from '../src/cards.js';
import { normalizeName } from '../src/game.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const artDir = join(root, 'assets', 'art');
const API = 'https://graphql.anilist.co';
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent': 'Yomi/1.0 (+https://github.com/flycy07/karuta-bot)',
};

/**
 * Anime della serie e i suoi personaggi: una richiesta per serie, non per carta.
 * AniList restituisce al massimo 25 personaggi per pagina, quindi chiediamo tre
 * pagine in una volta sola: i comprimari (King, Eto, Mumen Rider…) stanno oltre
 * la prima.
 */
const SERIES_QUERY = `query ($s: String) {
  Page(perPage: 5) {
    media(search: $s, type: ANIME) {
      id
      title { romaji english }
      p1: characters(page: 1, perPage: 25) { nodes { id name { full } image { large } } }
      p2: characters(page: 2, perPage: 25) { nodes { id name { full } image { large } } }
      p3: characters(page: 3, perPage: 25) { nodes { id name { full } image { large } } }
    }
  }
}`;

/**
 * Soprannomi: nel catalogo le carte si chiamano come i fan, AniList usa il nome
 * anagrafico. Senza questa mappa "Kirito" non troverebbe mai "Kazuto Kirigaya".
 */
const ALIASES = {
  kirito: ['Kazuto Kirigaya'],
  sinon: ['Shino Asada'],
  leafa: ['Suguha Kirigaya'],
  klein: ['Ryoutarou Tsuboi'],
  'alice-synthesis-thirty': ['Alice Zuberg', 'Alice Synthesis Thirty'],
  'all-might': ['Toshinori Yagi'],
  hawks: ['Keigo Takami'],
  near: ['Nate River'],
  mello: ['Mihael Keehl'],
  'faris-nyannyan': ['Rumiho Akiha'],
  krillin: ['Kuririn'],
  'android-18': ['Jinzouningen 18-gou', 'Lazuli'],
  'aqua-hoshino': ['Aquamarine Hoshino'],
  'speed-o-sound-sonic': ['Onsoku no Sonic'],
  'mumen-rider': ['Satoru', 'Mumen Rider'],
  king: ['King'],
  'eto-yoshimura': ['Eto'],
};

/** Ripiego: ricerca diretta del personaggio per nome. */
const CHARACTER_QUERY = `query ($q: String) {
  Page(perPage: 8) {
    characters(search: $q) {
      id
      name { full }
      image { large }
      media(perPage: 3) { nodes { title { romaji english } } }
    }
  }
}`;

const args = process.argv.slice(2);
const force = args.includes('--force');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 0 : 0;
const filter = (args.find((arg) => !arg.startsWith('--') && arg !== args[limitIndex + 1]) ?? '').toLowerCase();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Budget AniList: header letti a ogni risposta, attesa prima di sforare. */
const budget = { remaining: 30, resetAt: 0 };

async function waitForBudget() {
  if (budget.remaining > 1) return;
  const wait = Math.max(0, budget.resetAt - Date.now()) + 1200;
  if (wait > 0) {
    console.log(`   ⏳ limite API raggiunto, aspetto ${Math.ceil(wait / 1000)}s`);
    await sleep(wait);
  }
  budget.remaining = 30;
}

async function graphql(query, variables, attempt = 0) {
  await waitForBudget();
  const response = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query, variables }) });

  budget.remaining = Number(response.headers.get('x-ratelimit-remaining') ?? budget.remaining);
  const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0);
  if (reset) budget.resetAt = reset * 1000;

  if (response.status === 429) {
    if (attempt >= 5) throw new Error('AniList continua a rispondere 429');
    budget.remaining = 0;
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    const untilReset = Math.max(0, (budget.resetAt - Date.now()) / 1000);
    const backoff = 5 * 2 ** attempt;
    const wait = Math.min(90, Math.max(5, retryAfter, untilReset + 2, backoff));
    console.log(`   ⏳ 429, riprovo tra ${Math.ceil(wait)}s`);
    await sleep(wait * 1000);
    return graphql(query, variables, attempt + 1);
  }

  const json = await response.json().catch(() => ({}));
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return json.data;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

/**
 * AniList traslittera i nomi in modi diversi ("Hyuuga" per "Hyuga", "Gojou" per
 * "Gojo", "Levi" per "Levi Ackerman"): confronto per parola tollerando uno o due
 * caratteri di differenza.
 */
function words(name) {
  return normalizeName(name).split(' ').filter(Boolean);
}

function sameWord(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.3));
}

/** 0-100: quanto il nome del personaggio somiglia a quello della carta. */
function nameScore(candidateName, cardName) {
  const found = words(candidateName);
  const wanted = words(cardName);
  if (!found.length || !wanted.length) return 0;

  // Le cifre devono combaciare: "Jinzouningen 8-gou" non è "Jinzouningen 18-gou".
  const numbers = (list) => list.filter((word) => /\d/.test(word));
  if (numbers(found).some((word) => !wanted.includes(word))) return 0;
  if (numbers(wanted).some((token) => !found.includes(token))) return 0;

  // Nome unico ("Levi", "Eto", "Saitama"): dentro la serie giusta è una prova
  // forte, ma se coincide col cognome vale meno ("Yoshimura" non è Eto).
  if (found.length === 1) {
    if (sameWord(found[0], wanted[0])) return 80;
    return wanted.some((token) => sameWord(token, found[0])) ? 65 : 0;
  }

  // Copertura su entrambi i nomi: "Vegeta Ou" non è "Vegeta" (una parola su due).
  const hits = wanted.filter((token) => found.some((word) => sameWord(token, word))).length;
  return Math.round((hits / Math.max(found.length, wanted.length)) * 100);
}

function seriesScore(media, card) {
  const titles = [media.title?.romaji, media.title?.english]
    .filter(Boolean)
    .flatMap((title) => words(title));
  const series = words(card.series);
  if (!titles.length || !series.length) return 0;
  const hits = series.filter((token) => titles.some((word) => sameWord(token, word))).length;
  return hits / series.length;
}

function hasArt(card) {
  return EXTENSIONS.some((ext) => existsSync(join(artDir, `${card.id}.${ext}`)));
}

async function download(url, card) {
  const response = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!response.ok) throw new Error(`immagine HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 2_000) throw new Error('immagine troppo piccola');
  const file = join(artDir, `${card.id}.${ext}`);
  writeFileSync(file, buffer);
  return file;
}

function charactersOf(media) {
  return ['p1', 'p2', 'p3'].flatMap((page) => media[page]?.nodes ?? []);
}

/** Nomi con cui cercare una carta: quello del catalogo e i suoi soprannomi. */
function searchNames(card) {
  return [card.name, ...(ALIASES[card.id] ?? [])];
}

/** Miglior personaggio per una carta tra quelli di una serie. */
function bestMatch(nodes, card) {
  let best = null;
  for (const name of searchNames(card)) {
    for (const node of nodes) {
      const score = nameScore(node.name?.full, name);
      // 70 e non 60: un solo cognome somigliante ("Yoshimura") è troppo poco.
      if (score >= 70 && (!best || score > best.score)) best = { node, score };
    }
  }
  return best?.node ?? null;
}

/** Anime della serie (per nome) e i suoi personaggi. */
async function findInSeries(card) {
  const data = await graphql(SERIES_QUERY, { s: card.series });
  const medias = data?.Page?.media ?? [];
  const media = medias
    .map((entry) => ({ entry, score: seriesScore(entry, card) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)[0]?.entry;
  if (!media) return null;
  return { media, characters: charactersOf(media) };
}

/** Ripiego: ricerca globale per nome, con la serie come conferma. */
async function findGlobal(card) {
  let best = null;
  for (const name of searchNames(card)) {
    const data = await graphql(CHARACTER_QUERY, { q: name });
    for (const node of data?.Page?.characters ?? []) {
      const base = nameScore(node.name?.full, name);
      if (base < 60) continue;
      const titles = (node.media?.nodes ?? []).flatMap((entry) =>
        [entry.title?.romaji, entry.title?.english].filter(Boolean).flatMap(words),
      );
      const confirmed = words(card.series).some((token) => titles.some((word) => sameWord(token, word)));
      // Senza la conferma della serie il nome da solo non basta: "Vegeta" non è
      // "Vegeta Ou" e "Klein" non è "Klein Moretti".
      const score = base + (confirmed ? 40 : -25);
      // A parità vince il nome più simile, non lo spin-off scoperto prima.
      if (score >= 100 && (!best || score > best.score || (score === best.score && base > best.base))) {
        best = { node, score, base };
      }
    }
  }
  return best?.node ?? null;
}

mkdirSync(artDir, { recursive: true });

const targets = catalog.filter((card) => (filter ? card.id.includes(filter) : true));
const todo = targets.filter((card) => force || !hasArt(card)).slice(0, limit || undefined);

if (!todo.length) {
  console.log('✅ Tutte le carte hanno già il loro artwork in assets/art/ (usa --force per riscaricarle).');
  process.exit(0);
}

const bySeries = new Map();
for (const card of todo) {
  if (!bySeries.has(card.series)) bySeries.set(card.series, []);
  bySeries.get(card.series).push(card);
}

console.log(`🔎 ${todo.length} carte in ${bySeries.size} serie: cerco gli artwork su AniList…`);

let saved = 0;
const missing = [];
const pending = [];

for (const [series, cards] of bySeries) {
  let found;
  try {
    found = await findInSeries(cards[0]);
  } catch (error) {
    console.log(`   ❌ ${series}: ${error.message}`);
    missing.push(...cards.map((card) => card.id));
    continue;
  }

  if (!found?.media) {
    console.log(`   ⚠️  serie non trovata: ${series}`);
    missing.push(...cards.map((card) => card.id));
    continue;
  }

  const nodes = found.characters;
  for (const card of cards) {
    const match = bestMatch(nodes, card);

    if (!match) {
      pending.push(card);
      continue;
    }

    try {
      await download(match.image.large, card);
      saved += 1;
      console.log(`   ✅ ${card.name} (${series}) → ${match.name.full}`);
    } catch (error) {
      console.log(`   ❌ ${card.name}: ${error.message}`);
      missing.push(card.id);
    }
  }
}

if (pending.length) {
  console.log(`\n🔁 ${pending.length} carte non presenti nella lista della serie: cerco per nome…`);
  for (const card of pending) {
    try {
      const node = await findGlobal(card);
      if (!node) {
        console.log(`   ⚠️  ${card.name} (${card.series}): nessun personaggio trovato`);
        missing.push(card.id);
        continue;
      }
      await download(node.image.large, card);
      saved += 1;
      console.log(`   ✅ ${card.name} (${card.series}) → ${node.name.full}`);
    } catch (error) {
      console.log(`   ❌ ${card.name}: ${error.message}`);
      missing.push(card.id);
    }
  }
}

console.log(`\n🖼️  ${saved} artwork salvati in assets/art/`);
if (missing.length) {
  console.log(`   Senza immagine (${missing.length}): ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}`);
  console.log('   Riprova con: npm run art -- --force, oppure mettili a mano in assets/art/<id>.png');
}
console.log('   Ora: npm run cards');
