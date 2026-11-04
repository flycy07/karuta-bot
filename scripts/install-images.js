/**
 * Genera le immagini durante la build dell'host.
 *
 * Le immagini (`assets/art/`, `assets/cards/`) non stanno nel repository, quindi
 * su Render il servizio partirebbe senza. Se la build fa solo `npm install`,
 * questo script (agganciato a `postinstall`) scarica gli artwork e compone le
 * carte: le immagini entrano così nell'artefatto della build e all'avvio ci sono
 * già, senza consumare RAM né tempo del bot.
 *
 * Si attiva solo quando `assets/cards/` è vuota, che è il caso di ogni build su
 * un host pulito; in locale, dopo la prima volta, esce subito. Si disattiva con
 * `YOMI_SKIP_IMAGES=1`, si può limitare con `YOMI_IMAGES_LIMIT=20`.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

if (process.env.YOMI_SKIP_IMAGES === '1') {
  process.exit(0);
}

// Se le carte ci sono già (installazione locale dopo la prima volta) non c'è
// niente da fare: su un host di build la cartella è vuota e si genera tutto.
try {
  if (readdirSync(join(root, 'assets', 'cards')).some((name) => name.endsWith('.png'))) {
    process.exit(0);
  }
} catch {
  // cartella assente: è il caso della build, si prosegue
}

function run(script, args = []) {
  console.log(`\n▶ ${script} ${args.join(' ')}`.trim());
  const result = spawnSync(
    process.execPath,
    ['--max-old-space-size=192', join(root, 'scripts', script), ...args],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) {
    console.error(`✖ ${script}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`✖ ${script} è uscito con codice ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

const limit = process.env.YOMI_IMAGES_LIMIT;

// Gli artwork sono la parte lenta (API AniList): se qualcuno manca la carta
// viene comunque generata con il segnaposto, quindi il deploy non si blocca.
run('fetch-art.js', limit ? ['--limit', limit] : []);
run('build-cards.js');
