/**
 * Immagini delle carte a runtime.
 *
 * `assets/art/` e `assets/cards/` sono generate e stanno nel `.gitignore`: se
 * l'host esegue solo `npm install` (build senza `npm run art && npm run cards`)
 * il bot si trova senza immagini e i drop cadono sull'embed di testo. Qui,
 * quando non c'è nessun PNG pronto, le creiamo in background: il bot è già
 * online e le carte compaiono appena la generazione è finita.
 *
 * Disattivabile con la variabile d'ambiente `YOMI_SKIP_IMAGES=1`.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cardsDir = fileURLToPath(new URL('../assets/cards/', import.meta.url));

/** Stato dell'ultima generazione: finisce in /health, così si vede cosa succede. */
const job = { state: 'idle', error: null, startedAt: null, finishedAt: null };

/** Copia dello stato della generazione delle immagini. */
export function imageJobStatus() {
  return { ...job };
}

/** Quante carte hanno già il loro PNG. */
export function cardImageCount() {
  try {
    return readdirSync(cardsDir).filter((name) => name.endsWith('.png')).length;
  } catch {
    return 0;
  }
}

/** Esegue uno script del progetto e raccoglie l'output per i log. */
function run(script) {
  return new Promise((resolve, reject) => {
    // Host gratuiti con 512 MB: limitiamo l'heap del figlio, così il totale
    // resta prevedibile e il processo del bot non viene ucciso per memoria.
    const child = spawn(process.execPath, ['--max-old-space-size=192', join(root, 'scripts', script)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(output);
      const tail = output.trim().split('\n').slice(-3).join(' | ');
      return reject(new Error(`${script} è uscito con codice ${code}: ${tail}`));
    });
  });
}

/**
 * Scarica gli artwork mancanti e compone le carte.
 * Ritorna quanti PNG ci sono alla fine (0 se disattivato o se ha fallito).
 */
export async function ensureCardImages({ log = console } = {}) {
  if (process.env.YOMI_SKIP_IMAGES === '1') {
    job.state = 'disabled';
    return 0;
  }

  const before = cardImageCount();
  if (before > 0) {
    job.state = 'done';
    job.finishedAt = Date.now();
    return before;
  }

  job.state = 'running';
  job.startedAt = Date.now();
  job.error = null;

  log.log('🖼️  Nessuna immagine delle carte: le genero in background (qualche minuto)…');
  try {
    await run('fetch-art.js');
    await run('build-cards.js');
  } catch (error) {
    job.error = error.message;
    log.warn(`⚠️  Generazione immagini non riuscita: ${error.message}`);
  }

  const after = cardImageCount();
  job.state = after > 0 ? 'done' : 'error';
  job.finishedAt = Date.now();
  log.log(after ? `🖼️  ${after} immagini delle carte generate.` : '⚠️  Nessuna immagine generata.');
  return after;
}
