/* ================================================================
   e-Work Permit — core: config, API transport (Google Apps Script),
   admin session storage. Loaded on every page (before layout.js).
   ================================================================ */
(() => {
  const WP = (window.WP = window.WP || {});
  const cfg = window.WP_CONFIG || {};
  const D = window.WP_DATA || {};

  // Site root (docs/) as absolute URL without trailing slash — works from /admin/* too.
  const me = document.currentScript && document.currentScript.src;
  WP.base = me ? me.replace(/\/assets\/js\/core\.js(?:[?#].*)?$/, '') : location.origin;
  WP.apiUrl = String(cfg.apiUrl || '').trim();
  WP.data = D;
  WP.defs = D.workTypes || {};
  WP.confinedClose = D.confinedClose || {};

  WP.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  WP.qs = name => new URLSearchParams(location.search).get(name) || '';

  // ---------- admin session (token from action=login, 6 h server TTL) ----------
  const SKEY = 'wp_session_v1';
  WP.loadSession = () => {
    try {
      const s = JSON.parse(localStorage.getItem(SKEY) || 'null');
      if (s && s.token && s.exp > Date.now()) return s;
      if (s) localStorage.removeItem(SKEY);
    } catch { }
    return null;
  };
  WP.saveSession = (token, user, ttlSec = 21600) => {
    const s = { token, user, exp: Date.now() + ttlSec * 1000 };
    try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { }
    WP.session = token; WP.user = user; WP.admin = true;
    return s;
  };
  WP.updateSessionUser = user => {
    const s = WP.loadSession(); if (!s) return;
    s.user = user; try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { }
    WP.user = user;
  };
  WP.clearSession = () => { try { localStorage.removeItem(SKEY); } catch { } WP.session = null; WP.user = null; WP.admin = false; };
  const S = WP.loadSession();
  WP.session = S ? S.token : null;
  WP.user = S ? S.user : null;
  WP.admin = !!S;

  // ---------- API ----------
  const noApi = () => ({ ok: false, code: 'NO_API', error: 'ยังไม่ได้ตั้งค่า apiUrl ใน docs/config.js', msg: 'ยังไม่ได้ตั้งค่า apiUrl ใน docs/config.js' });
  const finish = j => {
    if (!j || typeof j !== 'object') j = { ok: false, error: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง' };
    j.msg = j.error || '';
    if (!j.ok && j.code === 'AUTH' && WP.session) {
      WP.clearSession();
      if (WP.layout === 'admin' || WP.requireAdmin) location.href = WP.base + '/login.html?expired=1';
    }
    return j;
  };
  // Writes and anything carrying a secret: POST, text/plain JSON body (no CORS preflight).
  WP.api = async (action, data = {}) => {
    if (!WP.apiUrl) return noApi();
    const body = Object.assign({}, data, { action });
    if (WP.session && !('session' in data)) body.session = WP.session;
    let j;
    try {
      const res = await fetch(WP.apiUrl, {
        method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body)
      });
      try { j = await res.json(); } catch { j = { ok: false, error: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (' + res.status + ')' }; }
    } catch (e) {
      j = { ok: false, code: 'NETWORK', error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' };
    }
    return finish(j);
  };
  // Public reads without secrets: GET ?action=...&_=<ts>
  WP.get = async (action, params = {}) => {
    if (!WP.apiUrl) return noApi();
    const u = new URL(WP.apiUrl);
    u.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    u.searchParams.set('_', String(Date.now()));
    let j;
    try {
      const res = await fetch(u.toString(), { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow' });
      j = await res.json();
    } catch (e) {
      j = { ok: false, code: 'NETWORK', error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' };
    }
    return finish(j);
  };

  // Today's date in Asia/Bangkok as YYYY-MM-DD (independent of the viewer's timezone).
  WP.todayBkk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
})();
