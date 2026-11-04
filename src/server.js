/**
 * Mini dashboard HTTP.
 *
 * Non serve a giocare: serve a dare all'host (Render e simili) una porta su cui
 * rispondere e un endpoint da pingare, così il servizio gratuito non va in
 * spin-down. Non espone dati utente e non accetta comandi.
 */
import { readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const cardsDir = fileURLToPath(new URL('../assets/cards/', import.meta.url));

/**
 * Cosa sta girando davvero: Render mette il commit e il branch nell'ambiente,
 * quindi /health dice subito se il deploy è quello giusto e se durante la build
 * le immagini delle carte sono state generate.
 */
const runtime = {
  commit: (process.env.RENDER_GIT_COMMIT ?? 'locale').slice(0, 7),
  branch: process.env.RENDER_GIT_BRANCH ?? '',
  node: process.version,
  get images() {
    try {
      return readdirSync(cardsDir).filter((name) => name.endsWith('.png')).length;
    } catch {
      return 0;
    }
  },
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[char];
  });
}

function page(status, uptimeSeconds) {
  const rows = [
    ['Bot', status.bot ?? 'connessione in corso…'],
    ['Stato', status.ready ? 'online' : 'avvio'],
    ['Server', String(status.servers)],
    ['Carte nel catalogo', String(status.cards)],
    ['Immagini generate', `${runtime.images} / ${status.cards}`],
    ['Versione', runtime.commit],
    ['Node', runtime.node],
    ['Uptime', `${Math.floor(uptimeSeconds / 60)}m ${uptimeSeconds % 60}s`],
  ];
  const cells = rows.map(([key, value]) => `<tr><th>${esc(key)}</th><td>${esc(value)}</td></tr>`).join('');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yomi · stato</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: system-ui, sans-serif; background: #1e1f26; color: #e6e6e6; }
  main { background: #262834; border-radius: 14px; padding: 2rem 2.5rem;
         box-shadow: 0 10px 30px #0005; min-width: 320px; }
  h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
  p { margin: 0 0 1.25rem; color: #9aa0b4; font-size: .9rem; }
  table { border-collapse: collapse; width: 100%; font-size: .95rem; }
  th, td { padding: .4rem .2rem; border-bottom: 1px solid #33364a; }
  th { text-align: left; font-weight: 500; color: #9aa0b4; }
  td { text-align: right; }
</style>
</head>
<body>
<main>
  <h1>Yomi</h1>
  <p>Bot di carte per Discord · pagina di stato</p>
  <table>${cells}</table>
</main>
</body>
</html>`;
}

/** Avvia il server sulla porta indicata; risolve quando la porta è in ascolto. */
export function startStatusServer({ port, getStatus }) {
  const startedAt = Date.now();
  const uptime = () => Math.round((Date.now() - startedAt) / 1000);

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];

    if (path === '/health' || path === '/healthz') {
      const body = JSON.stringify({
        ok: true,
        uptimeSeconds: uptime(),
        commit: runtime.commit,
        branch: runtime.branch,
        node: runtime.node,
        images: runtime.images,
        ...getStatus(),
      });
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }

    if (path !== '/') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(page(getStatus(), uptime()));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}
