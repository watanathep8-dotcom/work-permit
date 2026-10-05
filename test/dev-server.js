/* Local preview of docs/ (no Google account needed).
 *
 *   node test/dev-server.js [port]            → docs/ + in-memory mocked Apps Script API at /api
 *   node test/dev-server.js [port] --no-api   → docs/ exactly as shipped (apiUrl empty → Thai banner)
 *
 * With the mock API, config.js is rewritten on the fly to point at /api and the
 * backend is set up with the test-only admin password below (in-memory, lost on exit).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-mock');

const DEV_ADMIN_PASSWORD = 'dev-admin-pass'; // test fixture for the in-memory mock only
const port = Number(process.argv[2]) || 8765;
const noApi = process.argv.includes('--no-api');
const DOCS = path.join(__dirname, '..', 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let gas = null;
if (!noApi) {
  gas = createGas();
  gas.load(path.join(__dirname, '..', 'apps-script'), ['Data.gs', 'Code.gs', 'Auth.gs', 'Permits.gs', 'Setup.gs']);
  gas.propStore.WP_INITIAL_ADMIN_PASSWORD = DEV_ADMIN_PASSWORD;
  gas.context.setupSystem();
  delete gas.propStore.WP_INITIAL_ADMIN_PASSWORD;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (gas && url.pathname === '/api') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const out = req.method === 'POST'
        ? gas.context.doPost({ postData: { contents: body } })
        : gas.context.doGet({ parameter: Object.fromEntries(url.searchParams) });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(out.getContent());
    });
    return;
  }
  if (gas && url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    res.end(`window.WP_CONFIG = { apiUrl: "http://localhost:${port}/api" };\n`);
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(DOCS, p));
  if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`docs/ on http://localhost:${port}/ ${noApi ? '(no API)' : '(mock API at /api)'}`));
