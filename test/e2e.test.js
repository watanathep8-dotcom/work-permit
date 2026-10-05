/* End-to-end tests of the Apps Script backend through doGet/doPost,
 * using the in-memory mocks in gas-mock.js.  Run: node test/run.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
const GS_ORDER = ['Data.gs', 'Code.gs', 'Auth.gs', 'Permits.gs', 'Setup.gs'];

let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; return; }
  failures.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : ''));
}
function throws(name, fn, re) {
  try { fn(); failures.push(name + ' → did not throw'); } catch (e) {
    if (re && !re.test(e.message)) failures.push(name + ' → wrong error: ' + e.message); else passed++;
  }
}

// ------------------------------------------------------------ fixtures
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SIG = 'data:image/png;base64,' + PNG_1x1;
const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');

module.exports = function run() {
  const gas = createGas();
  gas.load(path.join(ROOT, 'apps-script'), GS_ORDER);
  const G = gas.context;
  const BKK = (iso) => new Date(iso + '+07:00').getTime();
  const setNow = (iso) => { gas.clock.offset = BKK(iso) - Date.now(); };

  const post = (body) => JSON.parse(G.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  const get = (params) => JSON.parse(G.doGet({ parameter: params }).getContent());

  // ================================================================ setup
  setNow('2026-10-05T09:00:00');
  check('API before setup → SETUP error', post({ action: 'stats' }).code === 'SETUP');
  throws('setupSystem refuses without WP_INITIAL_ADMIN_PASSWORD', () => G.setupSystem(), /WP_INITIAL_ADMIN_PASSWORD/);
  check('no spreadsheet created when refused', gas.spreadsheets.size === 0);
  gas.propStore.WP_INITIAL_ADMIN_PASSWORD = 'short';
  throws('setupSystem refuses too-short initial password', () => G.setupSystem(), /WP_INITIAL_ADMIN_PASSWORD/);
  const INIT_PW = 'Init-Passw0rd!';
  gas.propStore.WP_INITIAL_ADMIN_PASSWORD = INIT_PW;
  const s1 = G.setupSystem();
  check('setup creates admin', s1.adminCreated === true);
  const ssId = gas.propStore.WP_SPREADSHEET_ID, folderId = gas.propStore.WP_FOLDER_ID;
  const ss = gas.spreadsheets.get(ssId);
  check('sheets users/permits/permit_logs', ['users', 'permits', 'permit_logs'].every((n) => ss.getSheetByName(n)));
  check('permits header has all columns', ss.getSheetByName('permits').getRange(1, 1, 1, G.WP_SCHEMA.permits.length).getValues()[0].join() === G.WP_SCHEMA.permits.join());
  const s2 = G.setupSystem();
  check('setup idempotent (same ids, no new admin)', !s2.adminCreated && gas.propStore.WP_SPREADSHEET_ID === ssId && gas.propStore.WP_FOLDER_ID === folderId && gas.spreadsheets.size === 1 && ss.sheets.length === 3);
  const userRow = ss.getSheetByName('users').getDataRange().getValues();
  check('one user stored', userRow.length === 2);
  const uh = userRow[0];
  check('password stored as salt+hash, not plaintext', !JSON.stringify(userRow).includes(INIT_PW) && /^[a-f0-9]{64}$/.test(userRow[1][uh.indexOf('password_hash')]) && userRow[1][uh.indexOf('iterations')] === '5000');

  // ================================================================ public GET
  check('GET ping', get({ action: 'ping' }).ok);
  const cfg = get({ action: 'config' });
  check('GET config returns reference data', cfg.ok && cfg.data.companies.length === 2 && cfg.data.workTypes.confined.form === 'FM-EMR-46');
  check('GET stats', get({ action: 'stats' }).data.total === 0);
  check('GET on POST-only action refused', !get({ action: 'permits' }).ok);
  check('unknown action', post({ action: 'nope' }).code === 'NOT_FOUND');
  check('invalid JSON body', JSON.parse(G.doPost({ postData: { contents: '{bad' } }).getContent()).ok === false);

  // ================================================================ login
  gas.stats.sleeps.length = 0;
  let r = post({ action: 'login', username: 'admin', password: 'wrong-pass' });
  check('login wrong password fails', !r.ok && r.code === 'AUTH_FAILED' && r.error === 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', r);
  check('failed login sleeps 1s', gas.stats.sleeps[0] === 1000);
  check('unknown user fails the same way', post({ action: 'login', username: 'ghost', password: 'x' }).code === 'AUTH_FAILED');
  r = post({ action: 'login', username: 'admin', password: INIT_PW });
  check('login right password', r.ok && /^[a-f0-9]{64}$/.test(r.data.session) && r.data.user.username === 'admin', r);
  let S = r.data.session;
  check('username case-insensitive like MySQL', post({ action: 'login', username: 'ADMIN', password: INIT_PW }).ok);
  check('me with session', post({ action: 'me', session: S }).data.fullname === 'ผู้ดูแลระบบ จป.');
  check('me without session → AUTH', post({ action: 'me' }).code === 'AUTH');
  check('me with forged session → AUTH', post({ action: 'me', session: 'a'.repeat(64) }).code === 'AUTH');

  // lockout: 10 failures → locked 15 min, even for the right password
  for (let i = 0; i < 10; i++) post({ action: 'login', username: 'admin', password: 'bad' + i });
  r = post({ action: 'login', username: 'admin', password: INIT_PW });
  check('locked after 10 failures', !r.ok && r.code === 'LOCKED', r);
  check('lockout does not block other usernames', post({ action: 'login', username: 'other', password: 'x' }).code === 'AUTH_FAILED');
  gas.clock.offset += 16 * 60 * 1000;
  r = post({ action: 'login', username: 'admin', password: INIT_PW });
  check('lock expires after 15 min', r.ok, r);
  S = r.data.session;
  setNow('2026-10-05T09:30:00');

  // ================================================================ submit
  const base = () => ({
    action: 'submit', company: G.WP_DATA.companies[0], permit_type: 'contractor', work_types: ['hot', 'electric', 'confined', 'bogus'],
    work_date: '2026-10-05', time_from: '08:00', time_to: '17:00', requester_title: 'นาย',
    requester_name: 'สมชาย ใจดี', requester_company: 'ผู้รับเหมา ก', requester_phone: '081-234-5678',
    owner_name: 'วิชัย', owner_phone: '0899999999', location: '=HYPERLINK("http://evil")', job_detail: 'เชื่อมท่อ\nบรรทัด 2',
    workers: [{ name: 'คนงาน 1', role: 'ช่างเชื่อม', idno: '123' }, { name: '' }, { name: 'คนงาน 2' }],
    checklist: { h1: true, h8: { sel: ['ถุงมือ', 'ไม่มีจริง'], other: 'x' }, e6: { on: true, text: 'ข้อกำหนด' }, cs4_1: 'ใช่', cs4_12: 'ไม่ใช่', cs4_12_t: 'อื่นๆ', zzz: 'drop me' },
    loto: [{ item: 'MDB-1', t_on: '08:00', by_on: 'A', hacker: 'x' }],
    confined: { gas: [{ o2: '20.9', lel: '0', by: 'จป.', time: '08:10' }], close: { done: true } },
    requester_sign: SIG, owner_sign: SIG,
    attachment: { name: 'รายชื่อ.pdf', mimeType: 'application/pdf', base64: PDF_B64 }
  });
  const bad = (name, mut, re) => { const b = base(); mut(b); const x = post(b); check('submit rejects: ' + name, !x.ok && (!re || re.test(x.error)), x); };
  bad('no work types', (b) => { b.work_types = ['bogus']; }, /ลักษณะงาน/);
  bad('bad company', (b) => { b.company = 'X'; }, /บริษัท/);
  bad('bad permit type', (b) => { b.permit_type = 'x'; }, /ประเภท/);
  bad('bad date', (b) => { b.work_date = '5/10/2026'; }, /วันที่/);
  bad('bad time', (b) => { b.time_to = '5pm'; }, /เวลา/);
  bad('missing requester name', (b) => { b.requester_name = '  '; }, /ชื่อผู้ขออนุญาต/);
  bad('missing signature', (b) => { b.requester_sign = ''; }, /ลงลายมือชื่อ/);
  bad('non-PNG signature', (b) => { b.requester_sign = 'data:image/svg+xml;base64,AAAA'; }, /ลายเซ็น/);
  bad('PNG header lie in signature', (b) => { b.requester_sign = 'data:image/png;base64,' + PDF_B64; }, /ลายเซ็น/);
  bad('attachment ext not allowed', (b) => { b.attachment.name = 'x.exe'; }, /ชนิดไฟล์/);
  bad('attachment content mismatch', (b) => { b.attachment.name = 'x.png'; }, /ไม่ตรง/);
  bad('attachment > 10 MB', (b) => { b.attachment.base64 = Buffer.alloc(10 * 1048576 + 10, 0x25).toString('base64'); }, /ใหญ่เกิน/);
  bad('oversize workers JSON (cell limit)', (b) => { b.workers = Array.from({ length: 200 }, (_, i) => ({ name: 'ก'.repeat(150), role: 'ข'.repeat(150), idno: String(i).repeat(50) })); }, /ขีดจำกัด/);
  check('rejected submits created no Drive files', gas.files.size === 0);

  r = post(base());
  check('submit ok', r.ok && r.data.permit_no === 'WP-20261005-001' && /^[a-f0-9]{32}$/.test(r.data.token), r);
  const P1 = r.data;
  check('submit returns tracking path', P1.track_path === 'track.html?no=WP-20261005-001&t=' + P1.token);
  check('3 Drive files (2 signatures + attachment), private', gas.files.size === 3 && gas.stats.sharingCalls === 0);
  const b2 = base(); delete b2.attachment; b2.owner_sign = ''; b2.work_types = ['general']; b2.requester_phone = '0811111111';
  b2.location = 'ห้อง MDB';
  r = post(b2);
  check('second submit numbered 002', r.ok && r.data.permit_no === 'WP-20261005-002', r);
  const P2 = r.data;
  const pRows = ss.getSheetByName('permits').getDataRange().getValues();
  const ph = pRows[0];
  check('phone kept as text with leading zero', pRows[1][ph.indexOf('requester_phone')] === '081-234-5678');
  check('no signature data URL stored in cells', !JSON.stringify(pRows).includes('base64'));
  check('formula-like text round-trips', post({ action: 'permit', no: P1.permit_no, t: P1.token }).data.permit.location === '=HYPERLINK("http://evil")');
  check('stats counts 2 pending today', get({ action: 'stats' }).data.pending === 2 && get({ action: 'stats' }).data.today === 2);

  // ================================================================ track / token access
  check('track wrong phone', post({ action: 'track', permit_no: P1.permit_no, phone: '000' }).code === 'NOT_FOUND');
  r = post({ action: 'track', permit_no: P1.permit_no.toLowerCase(), phone: '0812345678' });
  check('track right phone (digits only, case-insensitive no)', r.ok && r.data.token === P1.token, r);
  r = post({ action: 'permit', no: P1.permit_no, t: P1.token });
  const v1 = r.ok && r.data.permit;
  check('permit by token', v1 && v1.permit_no === P1.permit_no && v1.status === 'pending' && v1.es === 'pending', r);
  check('work types filtered', v1 && v1.work_types.join() === 'hot,electric,confined');
  check('workers cleaned', v1 && v1.worker_count === 2 && v1.workers.length === 2);
  check('checklist sanitized', v1 && !('zzz' in v1.checklist) && v1.checklist.h8.sel.join() === 'ถุงมือ' && v1.checklist.cs4_12_t === 'อื่นๆ' && v1.checklist.e6.on === true);
  check('loto sanitized', v1 && v1.loto.length === 1 && !('hacker' in v1.loto[0]) && v1.loto[0].item === 'MDB-1');
  check('confined cleaned (5 gas, 6 entries, 3 renew)', v1 && v1.confined.gas.length === 5 && v1.confined.entries.length === 6 && v1.confined.renew.length === 3 && v1.confined.close.done === true);
  check('token not echoed in permit', v1 && !('token' in v1));
  check('log submit', r.data.logs.length === 1 && r.data.logs[0].action === 'submit' && r.data.logs[0].by_name === 'สมชาย ใจดี');
  check('signatures not sent unless asked', !r.data.signs);
  r = post({ action: 'permit', no: P1.permit_no, t: P1.token, signs: true });
  check('token holder gets signatures for print', r.ok && r.data.signs.requester.startsWith('data:image/png;base64,') && r.data.signs.owner && r.data.signs.approver === '');
  check('wrong token → NOT_FOUND', post({ action: 'permit', no: P1.permit_no, t: 'f'.repeat(32) }).code === 'NOT_FOUND');
  check("other permit's token → NOT_FOUND", post({ action: 'permit', no: P1.permit_no, t: P2.token }).code === 'NOT_FOUND');
  check('no token → NOT_FOUND', post({ action: 'permit', no: P1.permit_no }).code === 'NOT_FOUND');
  check('token without no → NOT_FOUND', post({ action: 'permit', t: P1.token }).code === 'NOT_FOUND');
  check('by id without session → AUTH', post({ action: 'permit', id: 1 }).code === 'AUTH');
  check('by id with token instead of session → AUTH', post({ action: 'permit', id: 1, no: P1.permit_no, t: P1.token }).code === 'AUTH');
  r = post({ action: 'file', no: P1.permit_no, t: P1.token });
  check('attachment with token', r.ok && r.data.base64 === PDF_B64 && r.data.mimeType === 'application/pdf' && r.data.inline && r.data.name === 'รายชื่อ.pdf', r);
  check('attachment wrong token', post({ action: 'file', no: P1.permit_no, t: P2.token }).code === 'NOT_FOUND');
  check('attachment none on P2', post({ action: 'file', no: P2.permit_no, t: P2.token }).code === 'NOT_FOUND');
  check('attachment by id needs session', post({ action: 'file', id: 1 }).code === 'AUTH');

  // admin-only actions must refuse anonymous / bogus / token callers
  ['poll', 'dashboard', 'permits', 'save_review', 'decide', 'delete', 'users', 'user_save', 'user_toggle', 'me', 'reset_data'].forEach((a) => {
    check('anonymous ' + a + ' refused', post({ action: a, id: 1, decision: 'approve', fullname: 'x', no: P1.permit_no, t: P1.token }).code === 'AUTH');
    check('bogus session ' + a + ' refused', post({ action: a, id: 1, session: '0'.repeat(64) }).code === 'AUTH');
  });

  // ================================================================ admin list / dashboard / poll
  r = post({ action: 'poll', session: S });
  check('poll', r.ok && r.data.pending === 2 && r.data.max_id === 2 && r.data.new.length === 0, r);
  r = post({ action: 'poll', session: S, since: 1 });
  check('poll since', r.data.new.length === 1 && r.data.new[0].permit_no === P2.permit_no);
  r = post({ action: 'permits', session: S });
  check('permits list desc', r.ok && r.data.rows.length === 2 && r.data.rows[0].id === 2 && r.data.counts.pending === 2, r);
  check('permits q filter', post({ action: 'permits', session: S, q: 'mdb' }).data.rows.length === 1);
  check('permits type filter', post({ action: 'permits', session: S, type: 'confined' }).data.rows.map((x) => x.id).join() === '1');
  check('permits date filter', post({ action: 'permits', session: S, from: '2026-10-06' }).data.rows.length === 0);
  check('permits status filter', post({ action: 'permits', session: S, status: 'approved' }).data.rows.length === 0);
  r = post({ action: 'dashboard', session: S });
  check('dashboard', r.ok && r.data.cnt.pending === 2 && r.data.byType.hot === 1 && r.data.byType.general === 1 && r.data.days.length === 14 && r.data.days[13].count === 2 && r.data.pending.length === 2, r);

  // ================================================================ review / approve / reject / close
  r = post({
    action: 'save_review', session: S, id: 1, log: true,
    checklist: { h1: true, h2: true, nope: 1 }, loto: [{ item: 'X' }],
    confined: { gas: [{ o2: '21' }] },
    inspections: { owner: { before: { name: 'เจ้าของพื้นที่' }, note: 'ok' }, safety: { permit: { name: '' }, before: { name: 'จป. A' } } }
  });
  check('save_review', r.ok && r.data.inspections.owner.before.name === 'เจ้าของพื้นที่' && /^2026-10-05 09:30/.test(r.data.inspections.owner.before.at) && r.data.inspections.owner.note === 'ok', r);
  const at1 = r.data.inspections.owner.before.at;
  gas.clock.offset += 60000;
  r = post({ action: 'save_review', session: S, id: 1, checklist: {}, inspections: { owner: { before: { name: 'เจ้าของพื้นที่' }, during: { name: 'คนใหม่' } }, safety: { before: { name: 'จป. A' } } } });
  check('inspection time kept for unchanged name, stamped for new', r.data.inspections.owner.before.at === at1 && r.data.inspections.owner.during.at !== at1 && !r.data.inspections.owner.note);
  check('confined kept when not sent', post({ action: 'permit', session: S, id: 1 }).data.permit.confined.gas[0].o2 === '21');
  check('review log only when log=true', post({ action: 'permit', session: S, id: 1 }).data.logs.filter((l) => l.action === 'review').length === 1);
  check('save_review unknown permit', post({ action: 'save_review', session: S, id: 99 }).code === 'NOT_FOUND');

  check('approve without signature', /ลงลายมือชื่อผู้อนุมัติ/.test(post({ action: 'decide', session: S, id: 1, decision: 'approve' }).error));
  check('bad decision', post({ action: 'decide', session: S, id: 1, decision: 'maybe' }).error === 'คำสั่งไม่ถูกต้อง');
  check('close while pending refused', /เฉพาะใบอนุญาตที่อนุมัติ/.test(post({ action: 'decide', session: S, id: 1, decision: 'close' }).error));
  r = post({ action: 'decide', session: S, id: 1, decision: 'approve', comment: 'ต้องมี Fire Watch', sign: SIG });
  check('approve', r.ok && r.data.status === 'approved', r);
  r = post({ action: 'permit', session: S, id: 1, signs: true });
  const a1 = r.data.permit;
  check('approved fields', a1.status === 'approved' && a1.es === 'approved' && a1.approver_name === 'ผู้ดูแลระบบ จป.' && a1.approve_comment === 'ต้องมี Fire Watch' && a1.inspections.safety.permit.name === 'ผู้ดูแลระบบ จป.');
  check('approver signature served', r.data.signs.approver.startsWith('data:image/png'));
  check('approve log', r.data.logs.some((l) => l.action === 'approve' && l.note === 'ต้องมี Fire Watch'));
  check('approve twice refused', /ไม่ได้อยู่ในสถานะรออนุมัติ/.test(post({ action: 'decide', session: S, id: 1, decision: 'approve', sign: SIG }).error));
  check('reject approved refused', /ไม่ได้อยู่ในสถานะรออนุมัติ/.test(post({ action: 'decide', session: S, id: 1, decision: 'reject', comment: 'x' }).error));
  check('reject without reason', /เหตุผล/.test(post({ action: 'decide', session: S, id: 2, decision: 'reject', comment: ' ' }).error));
  r = post({ action: 'decide', session: S, id: 2, decision: 'reject', comment: 'เอกสารไม่ครบ' });
  check('reject', r.ok && post({ action: 'permit', no: P2.permit_no, t: P2.token }).data.permit.status === 'rejected');
  check('close rejected refused', !post({ action: 'decide', session: S, id: 2, decision: 'close' }).ok);
  r = post({ action: 'decide', session: S, id: 1, decision: 'close' });
  const c1 = post({ action: 'permit', no: P1.permit_no, t: P1.token }).data;
  check('close', r.ok && c1.permit.status === 'closed' && c1.permit.closed_at && c1.logs.some((l) => l.action === 'close' && l.note === 'ตรวจสอบหลังเสร็จงาน ปิดใบอนุญาต'));

  // ================================================================ expiry
  const end = (wd, f, t) => G.permitEndTs_({ work_date: wd, time_from: f, time_to: t });
  check('end = time_to same day', end('2026-10-05', '08:00', '17:00') === BKK('2026-10-05T17:00:00') / 1000);
  check('overnight end next day', end('2026-10-05', '20:00', '06:00') === BKK('2026-10-06T06:00:00') / 1000);
  check('equal times → capped at +24h', end('2026-10-05', '08:00', '08:00') === BKK('2026-10-06T08:00:00') / 1000);
  const b3 = base(); delete b3.attachment; b3.work_types = ['general']; b3.time_from = '20:00'; b3.time_to = '06:00';
  const P3 = post(b3).data;
  post({ action: 'decide', session: S, id: P3.id, decision: 'approve', sign: SIG });
  setNow('2026-10-06T05:59:00');
  S = post({ action: 'login', username: 'admin', password: INIT_PW }).data.session; // previous session is > 6 h old now
  check('overnight permit still valid at 05:59 next day', post({ action: 'permit', no: P3.permit_no, t: P3.token }).data.permit.es === 'approved');
  setNow('2026-10-06T06:01:00');
  const e3 = post({ action: 'permit', no: P3.permit_no, t: P3.token }).data.permit;
  check('auto-expired after end time', e3.status === 'approved' && e3.es === 'expired');
  check('dashboard counts expired', post({ action: 'dashboard', session: S }).data.cnt.expired === 1);
  check('permits status=expired', post({ action: 'permits', session: S, status: 'expired' }).data.rows.map((x) => x.id).join() === String(P3.id));
  check('expired (approved) can still be closed like PHP', post({ action: 'decide', session: S, id: P3.id, decision: 'close' }).ok);
  r = post(Object.assign(base(), { attachment: null }));
  check('numbering restarts per Bangkok day', r.ok && r.data.permit_no === 'WP-20261006-001', r);
  const P4 = r.data;

  // ================================================================ users
  r = post({ action: 'users', session: S });
  check('users list + initial password warning', r.ok && r.data.users.length === 1 && r.data.initial_password_warning === true, r);
  check('user_save bad username', /ชื่อผู้ใช้ต้องเป็น/.test(post({ action: 'user_save', session: S, username: 'a b', fullname: 'X', password: 'secret1' }).error));
  check('user_save short password', /อย่างน้อย 6/.test(post({ action: 'user_save', session: S, username: 'safety2', fullname: 'X', password: '123' }).error));
  check('user_save no fullname', /ชื่อ-นามสกุล/.test(post({ action: 'user_save', session: S, username: 'safety2', fullname: '', password: '123456' }).error));
  r = post({ action: 'user_save', session: S, username: 'safety2', fullname: 'จป. สอง', position: '', password: 'pass-two' });
  check('user add', r.ok && r.data.id === 2, r);
  check('duplicate username (case-insensitive)', /มีอยู่แล้ว/.test(post({ action: 'user_save', session: S, username: 'SAFETY2', fullname: 'x', password: '123456' }).error));
  check('default position', post({ action: 'users', session: S }).data.users[1].position === 'เจ้าหน้าที่ความปลอดภัย (จป.วิชาชีพ)');
  r = post({ action: 'login', username: 'safety2', password: 'pass-two' });
  check('new user can log in', r.ok);
  const S2 = r.data.session;
  check('cannot disable self', /ตนเอง/.test(post({ action: 'user_toggle', session: S2, id: 2 }).error));
  r = post({ action: 'user_toggle', session: S, id: 2 });
  check('disable user', r.ok && r.data.active === false);
  check('disabled user session revoked', post({ action: 'me', session: S2 }).code === 'AUTH');
  check('disabled user cannot log in', post({ action: 'login', username: 'safety2', password: 'pass-two' }).code === 'AUTH_FAILED');
  post({ action: 'user_toggle', session: S, id: 2 });
  const S2b = post({ action: 'login', username: 'safety2', password: 'pass-two' }).data.session;
  r = post({ action: 'user_save', session: S, id: 2, fullname: 'จป. สอง (แก้)', position: 'หัวหน้า', password: 'new-pass-2' });
  check('admin resets other user password', r.ok && !r.data.session);
  check('reset password revokes that user sessions', post({ action: 'me', session: S2b }).code === 'AUTH');
  check('old password no longer works', post({ action: 'login', username: 'safety2', password: 'pass-two' }).code === 'AUTH_FAILED');
  check('new password works', post({ action: 'login', username: 'safety2', password: 'new-pass-2' }).ok);
  check('edit keeps password when blank', post({ action: 'user_save', session: S, id: 2, fullname: 'จป. สอง', password: '' }).ok && post({ action: 'login', username: 'safety2', password: 'new-pass-2' }).ok);
  r = post({ action: 'user_save', session: S, id: 1, fullname: 'ผู้ดูแลระบบ จป.', position: 'จป.', password: 'Brand-New-1' });
  check('own password change returns a fresh session', r.ok && /^[a-f0-9]{64}$/.test(r.data.session) && r.data.session !== S);
  check('old own session revoked', post({ action: 'me', session: S }).code === 'AUTH');
  S = r.data.session;
  check('initial password warning cleared', post({ action: 'users', session: S }).data.initial_password_warning === false);
  check('toggle unknown user', post({ action: 'user_toggle', session: S, id: 77 }).code === 'NOT_FOUND');

  // ================================================================ session TTL / logout
  const S3 = post({ action: 'login', username: 'safety2', password: 'new-pass-2' }).data.session;
  gas.clock.offset += 6 * 3600 * 1000 + 1000;
  check('session expires after 6 h', post({ action: 'me', session: S3 }).code === 'AUTH');
  S = post({ action: 'login', username: 'admin', password: 'Brand-New-1' }).data.session;
  check('logout', post({ action: 'logout', session: S }).ok && post({ action: 'me', session: S }).code === 'AUTH');
  S = post({ action: 'login', username: 'admin', password: 'Brand-New-1' }).data.session;

  // ================================================================ delete
  const fileIds = ['attachment_file', 'requester_sign_file', 'owner_sign_file', 'approver_sign_file']
    .map((k) => ss.getSheetByName('permits').getDataRange().getValues()[1][ph.indexOf(k)]).filter(Boolean);
  r = post({ action: 'delete', session: S, id: 1 });
  check('delete', r.ok);
  check('deleted permit unreachable by token', post({ action: 'permit', no: P1.permit_no, t: P1.token }).code === 'NOT_FOUND');
  check('deleted permit files moved to Drive trash', fileIds.length === 4 && fileIds.every((id) => gas.files.get(id).isTrashed()));
  check('logs of deleted permit removed', ss.getSheetByName('permit_logs').getDataRange().getValues().slice(1).every((row) => String(row[1]) !== '1'));
  check('other permits intact', post({ action: 'permit', no: P2.permit_no, t: P2.token }).ok);

  // ================================================================ reset_data
  const pSheet = ss.getSheetByName('permits'), lSheet = ss.getSheetByName('permit_logs');
  const RESET_PW = 'Reset-Only-For-Tests-9';
  check('reset: no session → AUTH', post({ action: 'reset_data', resetPassword: RESET_PW }).code === 'AUTH');
  check('reset: token holder (no session) → AUTH', post({ action: 'reset_data', no: P2.permit_no, t: P2.token, resetPassword: RESET_PW }).code === 'AUTH');
  r = post({ action: 'reset_data', session: S, resetPassword: RESET_PW });
  check('reset: refused while WP_RESET_PASSWORD unset', !r.ok && r.code === 'SETUP' && /WP_RESET_PASSWORD/.test(r.error), r);
  check('reset password is not in the source', !['Code.gs', 'Auth.gs', 'Permits.gs', 'Setup.gs'].some((f) => /WP_RESET_PASSWORD['"]?\s*[:=]\s*['"][^'"]+['"]/.test(fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'))));
  gas.propStore.WP_RESET_PASSWORD = RESET_PW;
  const beforeRows = pSheet.getLastRow();
  gas.stats.sleeps.length = 0;
  r = post({ action: 'reset_data', session: S, resetPassword: 'wrong' });
  check('reset: wrong password refused', !r.ok && r.code === 'AUTH_FAILED' && /ไม่ถูกต้อง/.test(r.error), r);
  check('reset: wrong password sleeps 1s', gas.stats.sleeps[0] === 1000);
  check('reset: missing password refused', post({ action: 'reset_data', session: S }).code === 'AUTH_FAILED');
  check('reset: nothing deleted after failures', pSheet.getLastRow() === beforeRows && beforeRows > 1);
  for (let i = 0; i < 8; i++) post({ action: 'reset_data', session: S, resetPassword: 'bad' + i });
  r = post({ action: 'reset_data', session: S, resetPassword: RESET_PW });
  check('reset: locked after 10 wrong passwords (even with the right one)', !r.ok && r.code === 'LOCKED', r);
  check('reset lockout does not lock login', post({ action: 'login', username: 'admin', password: 'Brand-New-1' }).ok);
  check('reset: still nothing deleted while locked', pSheet.getLastRow() === beforeRows);
  gas.clock.offset += 16 * 60 * 1000;
  // lock P4's tracking number (10 wrong phones) — must not haunt the next permit with the same number
  for (let i = 0; i < 10; i++) post({ action: 'track', permit_no: P4.permit_no, phone: '000' + i });
  check('track locked before reset', post({ action: 'track', permit_no: P4.permit_no, phone: '0812345678' }).code === 'LOCKED');
  const permitCount = pSheet.getLastRow() - 1, logCount = lSheet.getLastRow() - 1;
  const liveFiles = [...gas.files.values()].filter((f) => !f.isTrashed()).length;
  const S2c = post({ action: 'login', username: 'safety2', password: 'new-pass-2' }).data.session;
  r = post({ action: 'reset_data', session: S, resetPassword: RESET_PW });
  check('reset: success', r.ok && r.data.permits_removed === permitCount && r.data.logs_removed === logCount && r.data.files_trashed === liveFiles && permitCount === 3 && liveFiles > 0, { r, permitCount, logCount, liveFiles });
  check('reset: permits sheet only header left', pSheet.getLastRow() === 1 && pSheet.getRange(1, 1, 1, G.WP_SCHEMA.permits.length).getValues()[0].join() === G.WP_SCHEMA.permits.join());
  check('reset: logs sheet only header left', lSheet.getLastRow() === 1 && lSheet.getRange(1, 1, 1, G.WP_SCHEMA.permit_logs.length).getValues()[0].join() === G.WP_SCHEMA.permit_logs.join());
  check('reset: every Drive file in trash (not deleted)', gas.files.size > 0 && [...gas.files.values()].every((f) => f.isTrashed()));
  check('reset recorded in execution log', gas.logs.some((l) => l.startsWith('LOG WP reset_data by admin')));
  check('reset: users kept', ss.getSheetByName('users').getLastRow() === 3 && post({ action: 'users', session: S }).data.users.length === 2);
  check('reset: current session still works', post({ action: 'me', session: S }).ok);
  check('reset: other user session still works', post({ action: 'me', session: S2c }).ok);
  check('reset: login still works', post({ action: 'login', username: 'safety2', password: 'new-pass-2' }).ok);
  r = post({ action: 'dashboard', session: S });
  check('reset: dashboard empty', r.ok && r.data.cnt.pending === 0 && r.data.cnt.closed === 0 && r.data.pending.length === 0 && r.data.days.every((x) => x.count === 0), r);
  check('reset: stats zero', get({ action: 'stats' }).data.total === 0);
  check('reset: permits list empty', post({ action: 'permits', session: S }).data.rows.length === 0);
  check('reset: old token no longer tracks', post({ action: 'permit', no: P2.permit_no, t: P2.token }).code === 'NOT_FOUND' && post({ action: 'permit', no: P4.permit_no, t: P4.token }).code === 'NOT_FOUND');
  check('reset: old attachment unreachable', post({ action: 'file', no: P2.permit_no, t: P2.token }).code === 'NOT_FOUND');
  check('reset: second reset (nothing left) is fine', (() => { const x = post({ action: 'reset_data', session: S, resetPassword: RESET_PW }); return x.ok && x.data.permits_removed === 0 && x.data.files_trashed === 0; })());
  r = post(base());
  check('after reset: first number of the day again, id 1', r.ok && r.data.permit_no === P4.permit_no && r.data.permit_no === 'WP-20261006-001' && r.data.id === 1, r);
  const P5 = r.data;
  check('after reset: old token of the reused number fails', post({ action: 'permit', no: P5.permit_no, t: P4.token }).code === 'NOT_FOUND');
  r = post({ action: 'permit', no: P5.permit_no, t: P5.token, signs: true });
  check('after reset: new permit readable with one log + files', r.ok && r.data.logs.length === 1 && r.data.signs.requester.startsWith('data:image/png') && pSheet.getLastRow() === 2 && lSheet.getLastRow() === 2, r);
  check('after reset: tracking lockout of reused number cleared', post({ action: 'track', permit_no: P5.permit_no, phone: '0812345678' }).ok);
  check('after reset: second submit 002', post(Object.assign(base(), { attachment: null })).data.permit_no === 'WP-20261006-002');

  // ================================================================ invariants
  check('every sheet write happened under LockService', gas.stats.unlockedWrites === 0, gas.stats.unlockedWrites);
  check('no server errors logged', !gas.logs.some((l) => l.startsWith('ERROR')), gas.logs.filter((l) => l.startsWith('ERROR')));

  return { passed, failures };
};
