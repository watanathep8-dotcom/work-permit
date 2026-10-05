/* Browser transport (docs/assets/js/core.js) against the real backend (gas-mock):
 * batched reads, fallback for a backend without "batch", stale-while-revalidate
 * cache + its invalidation, and the one-shot permit hand-over.  Run: node test/run.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGas } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(String(k), String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
  keys() { return [...this.m.keys()]; }
}

module.exports = async function run() {
  let passed = 0;
  const failures = [];
  const check = (name, cond, extra) => {
    if (cond) passed++; else failures.push('frontend: ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : ''));
  };

  // ---- backend
  const gas = createGas();
  gas.load(path.join(ROOT, 'apps-script'), ['Data.gs', 'Code.gs', 'Auth.gs', 'Permits.gs', 'Setup.gs']);
  gas.propStore.WP_INITIAL_ADMIN_PASSWORD = 'Front-End-Test-1';
  gas.context.setupSystem();
  let oldBackend = false; // simulate a deployment without action=batch
  const calls = [];
  const fetchMock = async (url, opts = {}) => {
    let out;
    if ((opts.method || 'GET') === 'POST') {
      let body = opts.body;
      const a = JSON.parse(body);
      calls.push(a.action + (Array.isArray(a.calls) ? '[' + a.calls.map((c) => c.action).join(',') + ']' : ''));
      if (oldBackend && a.action === 'batch') body = JSON.stringify(Object.assign(a, { action: 'batch_unknown' }));
      out = gas.context.doPost({ postData: { contents: body } });
    } else {
      const u = new URL(url);
      calls.push('GET ' + u.searchParams.get('action'));
      out = gas.context.doGet({ parameter: Object.fromEntries(u.searchParams) });
    }
    const text = out.getContent();
    return { status: 200, json: async () => JSON.parse(text) };
  };

  // ---- browser-ish global for core.js
  const sessionStorage = new MemStorage(), localStorage = new MemStorage();
  const ss = new Proxy(sessionStorage, { ownKeys: (t) => t.keys(), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  const ctx = {
    WP_CONFIG: { apiUrl: 'https://script.google.com/macros/s/test/exec' },
    document: { readyState: 'complete', currentScript: null, addEventListener() {} },
    location: { origin: 'https://example.test', href: '', search: '' },
    localStorage, sessionStorage: ss, fetch: fetchMock, URL, URLSearchParams, Intl, setTimeout, console, JSON, Promise, Date, Object, Array, String, Set, Map
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/assets/js/data.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/assets/js/core.js'), 'utf8'), ctx);
  const WP = ctx.WP;
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---- login + data
  let r = await WP.api('login', { username: 'admin', password: 'Front-End-Test-1' });
  check('login', r.ok, r);
  WP.saveSession(r.data.session, r.data.user, r.data.expires_in);
  for (let i = 0; i < 2; i++) {
    r = await WP.api('submit', {
      company: WP.data.companies[0], permit_type: 'contractor', work_types: ['general'], work_date: '2026-10-05', time_from: '08:00', time_to: '17:00',
      requester_name: 'ผู้ขอ ' + i, requester_company: 'x', requester_phone: '0812345678', owner_name: 'o', location: 'ห้อง ' + i, job_detail: 'j', requester_sign: PNG
    });
    check('submit ' + i, r.ok, r);
  }

  // ---- reads started together → one batch round-trip, same answers as single calls
  const singles = [await WP.api('me'), await WP.api('poll'), await WP.api('dashboard')];
  calls.length = 0;
  const batched = await Promise.all([WP.read('me'), WP.read('poll'), WP.read('dashboard')]);
  check('3 reads → 1 batch request', calls.length === 1 && calls[0] === 'batch[me,poll,dashboard]', calls);
  check('batched answers === single calls', batched.every((x, i) => same(x, singles[i])), { batched, singles });
  calls.length = 0;
  r = await WP.read('poll', { since: 1 });
  check('a lone read goes out as itself', calls.join() === 'poll' && r.ok && r.data.new.length === 1, { calls, r });

  // ---- AUTH inside a batch still logs the browser out
  const keep = WP.session;
  WP.session = 'f'.repeat(64);
  r = await Promise.all([WP.read('me'), WP.read('dashboard')]);
  check('batched AUTH clears the session', r.every((x) => x.code === 'AUTH') && WP.session === null && localStorage.getItem('wp_session_v1') === null, r);
  WP.saveSession(keep, singles[0].data);

  // ---- older backend without "batch": fall back to single calls, remember it for this tab
  oldBackend = true;
  calls.length = 0;
  const fb = await Promise.all([WP.read('me'), WP.read('poll'), WP.read('dashboard')]);
  check('old backend: NOT_FOUND batch → single calls', calls.join() === 'batch[me,poll,dashboard],me,poll,dashboard' && fb.every((x, i) => same(x, singles[i])), { calls, fb });
  calls.length = 0;
  await Promise.all([WP.read('me'), WP.read('poll')]);
  check('old backend: no more batch attempts in this tab', calls.join() === 'me,poll', calls);
  oldBackend = false;
  sessionStorage.removeItem('wp_nobatch');

  // ---- stale-while-revalidate
  // (core.js read wp_nobatch at load: reload it so batching is back on)
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/assets/js/core.js'), 'utf8'), ctx);
  const W = ctx.WP;
  W.saveSession(keep, singles[0].data);
  const paints = [];
  const render = (x) => paints.push(x.cached ? 'cached' : (x.ok ? 'fresh' : 'error:' + x.code));
  await W.swr('permits', { status: 'pending' }, render);
  check('swr: first view paints once (fresh)', paints.join() === 'fresh', paints);
  paints.length = 0; calls.length = 0;
  await W.swr('permits', { status: 'pending' }, render);
  check('swr: second view paints the cached copy, unchanged answer is not repainted', paints.join() === 'cached' && calls.join() === 'permits', { paints, calls });
  // a change on the server (other tab / other admin) → repaint
  gas.context.doPost({ postData: { contents: JSON.stringify({ action: 'decide', session: keep, id: 1, decision: 'reject', comment: 'x' }) } });
  paints.length = 0;
  await W.swr('permits', { status: 'pending' }, render);
  check('swr: changed answer is repainted', paints.join() === 'cached,fresh', paints);
  // a write from this tab wipes the cache → next view paints fresh only
  r = await W.api('decide', { id: 2, decision: 'reject', comment: 'y' });
  check('write ok', r.ok, r);
  check('write wiped the browser cache', !ss.keys().some((k) => k.startsWith('wp_swr:')), ss.keys());
  paints.length = 0;
  await W.swr('permits', { status: 'pending' }, render);
  check('after a write: fresh paint only', paints.join() === 'fresh', paints);
  // cache key is per session; logout wipes it
  check('cache keyed by session', ss.keys().some((k) => k.startsWith('wp_swr:' + keep.slice(0, 16) + ':permits:')));
  W.clearSession();
  check('logout wipes the browser cache', !ss.keys().some((k) => k.startsWith('wp_swr:')));
  // anonymous: nothing cached unless explicitly public (opts.anon)
  paints.length = 0;
  await W.swr('permits', {}, render);
  check('anonymous admin view: error painted, nothing cached', paints.join() === 'error:AUTH' && !ss.keys().some((k) => k.startsWith('wp_swr:')), { paints, keys: ss.keys() });
  await W.swr('stats', {}, render, { anon: true, fetch: () => W.get('stats') });
  check('public stats cached for the tab', ss.keys().some((k) => k === 'wp_swr:anon:stats:{}'));

  // ---- one-shot hand-over (track / submit → status page)
  r = await W.api('track', { permit_no: 'WP-20261005-001', phone: '0812345678', with_permit: true });
  check('track with_permit returns the view', r.ok && r.data.view && r.data.view.permit.permit_no === 'WP-20261005-001', r);
  W.handoff(r.data.permit_no, r.data.token, r.data.view);
  check('hand-over: wrong token → nothing (and consumed)', W.takeHandoff('WP-20261005-001', 'a'.repeat(32)) === null && sessionStorage.getItem('wp_handoff') === null);
  W.handoff(r.data.permit_no, r.data.token, r.data.view);
  const direct = await W.api('permit', { no: r.data.permit_no, t: r.data.token });
  check('hand-over: same data as action permit', same(W.takeHandoff(r.data.permit_no, r.data.token), direct.data));
  check('hand-over: one-shot', W.takeHandoff(r.data.permit_no, r.data.token) === null);
  W.handoff(r.data.permit_no, r.data.token, r.data.view);
  const h = JSON.parse(sessionStorage.getItem('wp_handoff')); h.at -= 61000; sessionStorage.setItem('wp_handoff', JSON.stringify(h));
  check('hand-over: ignored after 60 s', W.takeHandoff(r.data.permit_no, r.data.token) === null);
  await tick();

  return { passed, failures };
};
