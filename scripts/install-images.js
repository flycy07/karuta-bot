/**
 * Genera le immagini durante la build dell'host.
 *
 * Le immagini (`assets/art/`, `assets/cards/`) non stanno nel repository, quindi
 * su Render il servizio partirebbe senza. Se la build fa solo `npm install`,
 * questo script (agganciato a `postinstall`) scarica gli artwork e compone le
 * carte: le immagini entrano così nell'artefatto della build e all'avvio ci sono
 * già, senza consumare RAM né tempo del bot.
 *
 * Gira solo su un host di build: in locale esce subito, così `npm install` resta
 * veloce. Si può forzare con `YOMI_BUILD_IMAGES=1`, limitare con
 * `YOMI_IMAGES_LIMIT=20`.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const onHost =
  process.env.YOMI_BUILD_IMAGES === '1' ||
  process.env.RENDER === 'true' ||
  Boolean(process.env.RENDER_SERVICE_ID);

if (!onHost) {
  process.exit(0);
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
