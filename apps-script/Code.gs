/**
 * e-Work Permit (FM-MR-58) — Google Apps Script backend.
 *
 * Ported from the PHP/MySQL app (api.php + server-side logic of the PHP pages).
 * Storage: one Google Sheet (tabs: users, permits, permit_logs) and one private
 * Drive folder for attachments + signature images.
 *
 * Files (all share one global scope in Apps Script):
 *   Code.gs     — router (doGet/doPost), response helpers, sheet "DB" helpers, utilities
 *   Auth.gs     — password hashing, login/logout/sessions (CacheService), user management
 *   Permits.gs  — permit actions (submit, track, list, view, review, decide, delete, files)
 *   Setup.gs    — setupSystem() (run once from the editor)
 *   Data.gs     — reference data (companies, checklists, rules) — single source of truth
 *
 * Transport (same as our SDS project):
 *   GET  ?action=config|stats|ping            → public, no secrets
 *   POST body = JSON {action, ...}            → everything else
 *        (Content-Type: text/plain to avoid a CORS preflight)
 *   Response: {ok:true, data} | {ok:false, error, code}
 * Apps Script cannot read cookies/headers, so the admin session token travels in
 * the POST body (`session`) and the requester's tracking token as `no` + `t`.
 */

var WP_TZ = 'Asia/Bangkok';
var WP_PROP_SPREADSHEET = 'WP_SPREADSHEET_ID';
var WP_PROP_FOLDER = 'WP_FOLDER_ID';
var WP_PROP_INITIAL_ADMIN_PASSWORD = 'WP_INITIAL_ADMIN_PASSWORD';
var WP_PROP_SITE_URL = 'WP_SITE_URL'; // optional: public GitHub Pages URL, used to build absolute tracking links
var WP_CELL_MAX = 49000;              // Google Sheets cell limit is 50,000 characters

var WP_SCHEMA = {
  users: ['id', 'username', 'salt', 'password_hash', 'iterations', 'fullname', 'position', 'active', 'must_change', 'created_at'],
  permits: ['id', 'permit_no', 'token', 'company', 'permit_type', 'work_types', 'work_date', 'time_from', 'time_to',
    'requester_title', 'requester_name', 'requester_company', 'requester_phone', 'worker_count', 'workers',
    'owner_name', 'owner_phone', 'job_detail', 'location', 'checklist', 'loto', 'confined', 'inspections',
    'requester_sign_file', 'owner_sign_file', 'attachment_file', 'attachment_name', 'attachment_mime',
    'status', 'approver_id', 'approver_name', 'approver_sign_file', 'approve_comment', 'approved_at', 'closed_at',
    'created_at', 'updated_at'],
  permit_logs: ['id', 'permit_id', 'action', 'by_name', 'note', 'created_at']
};

// ---------------------------------------------------------------- errors
function WpError(message, code) {
  this.name = 'WpError';
  this.message = message;
  this.code = code || 'BAD_REQUEST';
}
WpError.prototype = Object.create(Error.prototype);
WpError.prototype.constructor = WpError;

function fail_(message, code) { throw new WpError(message, code); }

// ---------------------------------------------------------------- entry points
function doGet(e) {
  var params = (e && e.parameter) || {};
  return handle_(String(params.action || ''), params, 'GET');
}

function doPost(e) {
  var body = (e && e.postData && e.postData.contents) || '';
  var payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง', code: 'BAD_REQUEST' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  return handle_(String(payload.action || ''), payload, 'POST');
}

// Built lazily: in Apps Script each .gs file is evaluated in order, so a map
// built at load time could not reference functions declared in later files.
function routes_() {
  return {
    // public
    ping: function () { return { app: WP_DATA.config.appName, form: WP_DATA.config.formCode, time: nowStr_() }; },
    config: apiConfig_,
    stats: apiStats_,
    submit: apiSubmit_,
    track: apiTrack_,
    login: apiLogin_,
    logout: apiLogout_,
    // admin OR permit-token holder
    permit: apiPermit_,
    file: apiFile_,
    // admin only
    me: apiMe_,
    poll: apiPoll_,
    dashboard: apiDashboard_,
    permits: apiPermits_,
    save_review: apiSaveReview_,
    decide: apiDecide_,
    'delete': apiDelete_,
    users: apiUsers_,
    user_save: apiUserSave_,
    user_toggle: apiUserToggle_
  };
}
var WP_GET_ACTIONS = { ping: true, config: true, stats: true };

function handle_(action, params, method) {
  try {
    var routes = routes_();
    if (!Object.prototype.hasOwnProperty.call(routes, action)) fail_('Unknown action', 'NOT_FOUND');
    if (method === 'GET' && !WP_GET_ACTIONS[action]) fail_('คำสั่งนี้ต้องเรียกด้วย POST', 'BAD_REQUEST');
    var ctx = { tables: {}, user: null };
    return jsonOut_({ ok: true, data: routes[action](params, ctx) });
  } catch (err) {
    if (err instanceof WpError) return jsonOut_({ ok: false, error: err.message, code: err.code });
    console.error(err && err.stack ? err.stack : err);
    return jsonOut_({ ok: false, error: 'เกิดข้อผิดพลาด: ' + (err && err.message ? err.message : String(err)), code: 'SERVER' });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiConfig_() {
  return WP_DATA;
}

// ---------------------------------------------------------------- locking
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) fail_('ระบบกำลังทำงานหนาแน่น กรุณาลองใหม่อีกครั้ง', 'BUSY');
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- spreadsheet "DB"
function props_() { return PropertiesService.getScriptProperties(); }

function spreadsheet_() {
  var id = props_().getProperty(WP_PROP_SPREADSHEET);
  if (!id) fail_('ระบบยังไม่ได้ตั้งค่า กรุณารัน setupSystem() ใน Apps Script ก่อน', 'SETUP');
  return SpreadsheetApp.openById(id);
}

function folder_() {
  var id = props_().getProperty(WP_PROP_FOLDER);
  if (!id) fail_('ระบบยังไม่ได้ตั้งค่า กรุณารัน setupSystem() ใน Apps Script ก่อน', 'SETUP');
  return DriveApp.getFolderById(id);
}

/**
 * Loads a whole sheet once per request (getDataRange().getValues()) and maps
 * rows to objects by header name. Writes go through writeRow_/appendRow_.
 */
function table_(ctx, name) {
  if (ctx.tables[name]) return ctx.tables[name];
  if (!ctx.ss) ctx.ss = spreadsheet_();
  var sheet = ctx.ss.getSheetByName(name);
  if (!sheet) fail_('ไม่พบชีต "' + name + '" กรุณารัน setupSystem() อีกครั้ง', 'SETUP');
  var values = sheet.getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return String(h); });
  WP_SCHEMA[name].forEach(function (h) {
    if (headers.indexOf(h) < 0) fail_('โครงสร้างชีต "' + name + '" ไม่ครบ (ขาดคอลัมน์ ' + h + ') กรุณารัน setupSystem()', 'SETUP');
  });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r], empty = true, obj = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      var v = fromCell_(row[c]);
      if (v !== '') empty = false;
      obj[headers[c]] = v;
    }
    if (!empty) rows.push(obj);
  }
  ctx.tables[name] = { name: name, sheet: sheet, headers: headers, rows: rows };
  return ctx.tables[name];
}

function fromCell_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, WP_TZ, 'yyyy-MM-dd HH:mm:ss');
  }
  var s = String(v);
  // undo the formula guard if Sheets kept the quote prefix
  if (/^'[=+\-@]/.test(s)) s = s.substring(1);
  return s;
}

function toCell_(v, column) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.length > WP_CELL_MAX) {
    fail_('ข้อมูล "' + column + '" ยาวเกินขีดจำกัดของ Google Sheets (' + WP_CELL_MAX + ' ตัวอักษร) กรุณาลดข้อมูลหรือแนบเป็นไฟล์แทน', 'TOO_LARGE');
  }
  // Never let user text be interpreted as a formula.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function rowValues_(t, obj) {
  return t.headers.map(function (h) { return toCell_(obj[h], h); });
}

function appendRow_(t, obj) {
  var values = rowValues_(t, obj);
  var sheet = t.sheet;
  var rowIndex = sheet.getLastRow() + 1;
  if (rowIndex > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);
  var range = sheet.getRange(rowIndex, 1, 1, values.length);
  range.setNumberFormat('@'); // keep phone numbers, dates and times as plain text
  range.setValues([values]);
  obj._row = rowIndex;
  t.rows.push(obj);
  return obj;
}

function writeRow_(t, obj) {
  var values = rowValues_(t, obj);
  var range = t.sheet.getRange(obj._row, 1, 1, values.length);
  range.setNumberFormat('@');
  range.setValues([values]);
  return obj;
}

function deleteRows_(t, objs) {
  objs.map(function (o) { return o._row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (r) { t.sheet.deleteRow(r); });
  var gone = {};
  objs.forEach(function (o) { gone[o._row] = true; });
  t.rows = t.rows.filter(function (o) { return !gone[o._row]; });
}

function nextId_(t) {
  var max = 0;
  t.rows.forEach(function (r) { var n = Number(r.id) || 0; if (n > max) max = n; });
  return max + 1;
}

function findById_(t, id) {
  id = Number(id) || 0;
  if (!id) return null;
  for (var i = 0; i < t.rows.length; i++) if (Number(t.rows[i].id) === id) return t.rows[i];
  return null;
}

// ---------------------------------------------------------------- utilities
function now_() { return new Date(); } // single clock source (tests override it)
function nowTs_() { return Math.floor(now_().getTime() / 1000); }
function nowStr_() { return Utilities.formatDate(now_(), WP_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function todayStr_() { return Utilities.formatDate(now_(), WP_TZ, 'yyyy-MM-dd'); }

/** mb_substr(trim((string)$v), 0, $max) */
function str_(v, max) {
  if (v === null || v === undefined || typeof v === 'object') v = '';
  var s = String(v).trim();
  max = max || 255;
  if (s.length > max) s = Array.from(s).slice(0, max).join('');
  return s;
}

function jdec_(s, fallback) {
  if (s === '' || s === null || s === undefined) return fallback;
  try {
    var v = JSON.parse(s);
    return (v && typeof v === 'object') ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

function bytesToHex_(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out.push((b < 16 ? '0' : '') + b.toString(16));
  }
  return out.join('');
}

function sha256Hex_(s) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

/** Random lowercase hex string of length n (UUIDs + Math.random mixed through SHA-256). */
function randomHex_(n) {
  var out = '';
  while (out.length < n) {
    out += sha256Hex_(Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Math.random() + ':' + Date.now() + ':' + out);
  }
  return out.substring(0, n);
}

/** Constant-time string comparison. */
function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length || !a.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
