/**
 * Permit actions — port of api.php plus the server-side logic embedded in
 * index.php / status.php / track.php / print.php / file.php / admin/*.php.
 *
 * Read access to a permit (details, logs, signatures, attachment) is granted to
 *   (a) a logged-in จป. admin (by `id`, with `session`), or
 *   (b) the requester holding that permit's tracking token (`no` + `t`).
 */

var WP_MIME_BY_EXT = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
// Leading "magic" bytes per extension, so a renamed file cannot slip through.
var WP_MAGIC_BY_EXT = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],                 // %PDF
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],                // zip (OOXML)
  docx: [[0x50, 0x4b, 0x03, 0x04]],
  xls: [[0xd0, 0xcf, 0x11, 0xe0], [0x50, 0x4b, 0x03, 0x04]], // OLE2 (or mis-named OOXML)
  doc: [[0xd0, 0xcf, 0x11, 0xe0], [0x7b, 0x5c, 0x72, 0x74], [0x50, 0x4b, 0x03, 0x04]] // OLE2 / RTF / OOXML
};
var WP_SIG_MAX = 1500000; // same as sig_ok() in api.php

// ---------------------------------------------------------------- expiry (inc/data.php)
/** Unix seconds of "YYYY-MM-DD HH:MM" in Asia/Bangkok (UTC+7, no DST). */
function bkkTs_(date, time) {
  var d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  var t = /^(\d{1,2}):(\d{2})/.exec(String(time || '00:00'));
  if (!d) return 0;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], t ? +t[1] : 0, t ? +t[2] : 0) / 1000 - 7 * 3600;
}

/** permit_end_ts(): end of the stated time window (overnight aware), capped at start + 24 h. */
function permitEndTs_(p) {
  var end = bkkTs_(p.work_date, p.time_to);
  if (String(p.time_to) <= String(p.time_from)) end += 86400; // overnight work
  var max = bkkTs_(p.work_date, p.time_from) + WP_DATA.config.permitValidHours * 3600;
  return Math.min(end, max);
}

/** effective_status(): approved permits become "expired" automatically. */
function effectiveStatus_(p) {
  if (p.status === 'approved' && nowTs_() > permitEndTs_(p)) return 'expired';
  return p.status;
}

// ---------------------------------------------------------------- sanitizers
function workTypeKeys_() { return Object.keys(WP_DATA.workTypes); }

function checklistItemIndex_() {
  var idx = {};
  workTypeKeys_().forEach(function (k) {
    WP_DATA.workTypes[k].items.forEach(function (it) { idx[it.id] = it; });
  });
  return idx;
}

/** Keeps only known checklist ids with the value shape the UI produces. */
function cleanChecklist_(raw) {
  var out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  var idx = checklistItemIndex_();
  Object.keys(raw).forEach(function (key) {
    var v = raw[key];
    var it = idx[key];
    if (!it) {
      var base = key.replace(/_t$/, '');
      if (key !== base && idx[base] && idx[base].type === 'choice' && idx[base].other) out[key] = str_(v, 200);
      return;
    }
    switch (it.type) {
      case 'check': out[key] = !!v; break;
      case 'text': out[key] = str_(v, 500); break;
      case 'checktext': out[key] = { on: !!(v && v.on), text: str_(v && v.text, 500) }; break;
      case 'choice': out[key] = it.opts.indexOf(v) >= 0 ? v : ''; break;
      case 'ppe':
        var sel = (v && Array.isArray(v.sel)) ? v.sel : [];
        out[key] = {
          sel: it.options.filter(function (o) { return sel.indexOf(o) >= 0; }),
          other: str_(v && v.other, 200)
        };
        break;
      default: break; // group / info carry no value
    }
  });
  return out;
}

function cleanLoto_(raw) {
  var rows = Array.isArray(raw) ? raw.slice(0, 6) : [];
  return rows.map(function (r) {
    r = (r && typeof r === 'object') ? r : {};
    return {
      item: str_(r.item, 200), t_on: str_(r.t_on, 5), by_on: str_(r.by_on, 150),
      t_off: str_(r.t_off, 5), by_off: str_(r.by_off, 150), note: str_(r.note, 300)
    };
  });
}

/** clean_confined() from inc/data.php (gas / entries / renew / close). */
function cleanConfined_(d) {
  d = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  var at = function (arr, i) { return (Array.isArray(arr) && arr[i] && typeof arr[i] === 'object') ? arr[i] : {}; };
  var o = { gas: [], entries: [], renew: [], close: {} };
  var i, j;
  for (i = 0; i < 5; i++) {
    var g = at(d.gas, i);
    o.gas.push({ o2: str_(g.o2, 10), lel: str_(g.lel, 10), by: str_(g.by, 100), time: str_(g.time, 5) });
  }
  for (i = 0; i < 6; i++) {
    var e = at(d.entries, i), t = [];
    for (j = 0; j < 5; j++) { var x = at(e.t, j); t.push({ 'in': str_(x['in'], 5), out: str_(x.out, 5) }); }
    o.entries.push({ name: str_(e.name, 150), t: t });
  }
  for (i = 0; i < 3; i++) {
    var r = at(d.renew, i);
    o.renew.push({ start: str_(r.start, 5), end: str_(r.end, 5), by: str_(r.by, 100) });
  }
  var cl = (d.close && typeof d.close === 'object') ? d.close : {};
  Object.keys(WP_DATA.confinedClose).forEach(function (k) { o.close[k] = !!cl[k]; });
  o.close.reason = str_(cl.reason, 300);
  return o;
}

function cleanWorkers_(raw) {
  var out = [];
  (Array.isArray(raw) ? raw : []).some(function (w) {
    w = (w && typeof w === 'object') ? w : {};
    if (str_(w.name) === '') return false;
    out.push({ name: str_(w.name, 150), role: str_(w.role, 150), idno: str_(w.idno, 50) });
    return out.length >= 200;
  });
  return out;
}

// ---------------------------------------------------------------- files (Drive, private)
function startsWithBytes_(bytes, magic) {
  if (bytes.length < magic.length) return false;
  for (var i = 0; i < magic.length; i++) if ((bytes[i] & 0xff) !== magic[i]) return false;
  return true;
}

/** sig_ok(): '' or a PNG data URL ≤ 1.5 MB. Returns decoded bytes (or null). */
function checkSignature_(s) {
  s = typeof s === 'string' ? s : '';
  if (s === '') return null;
  if (s.length > WP_SIG_MAX || !/^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(s)) fail_('ลายเซ็นไม่ถูกต้อง');
  var bytes = Utilities.base64Decode(s.substring(s.indexOf(',') + 1));
  if (!startsWithBytes_(bytes, WP_MAGIC_BY_EXT.png[0])) fail_('ลายเซ็นไม่ถูกต้อง');
  return bytes;
}

/** Attachment rules of api.php: ≤ UPLOAD_MAX_MB, pdf/jpg/jpeg/png/xls/xlsx/doc/docx. */
function checkAttachment_(a) {
  if (!a || typeof a !== 'object' || !a.base64) return null;
  var name = str_(a.name, 255);
  var ext = name.indexOf('.') >= 0 ? name.split('.').pop().toLowerCase() : '';
  var maxBytes = WP_DATA.config.uploadMaxMb * 1048576;
  if (WP_DATA.config.uploadExt.indexOf(ext) < 0) fail_('ชนิดไฟล์ไม่รองรับ');
  var b64 = String(a.base64).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(b64)) fail_('อัปโหลดไฟล์ไม่สำเร็จ');
  if (Math.floor(b64.length * 3 / 4) - 2 > maxBytes) fail_('ไฟล์แนบใหญ่เกินกำหนด');
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) fail_('อัปโหลดไฟล์ไม่สำเร็จ');
  if (bytes.length > maxBytes) fail_('ไฟล์แนบใหญ่เกินกำหนด');
  var okMagic = WP_MAGIC_BY_EXT[ext].some(function (m) { return startsWithBytes_(bytes, m); });
  if (!okMagic) fail_('ชนิดไฟล์ไม่ตรงกับเนื้อหาไฟล์');
  return { bytes: bytes, ext: ext, name: name, mime: WP_MIME_BY_EXT[ext] };
}

function saveDriveFile_(bytes, mime, filename) {
  // Files stay private (default sharing) and are only served through apiFile_ / apiPermit_.
  return folder_().createFile(Utilities.newBlob(bytes, mime, filename)).getId();
}

function trashDriveFile_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { console.warn('trash failed: ' + id); }
}

function driveDataUrl_(id) {
  if (!id) return '';
  try {
    var blob = DriveApp.getFileById(id).getBlob();
    return 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return '';
  }
}

function stampName_(ext) {
  return Utilities.formatDate(now_(), WP_TZ, 'yyyyMMdd_HHmmss') + '_' + randomHex_(12) + '.' + ext;
}

// ---------------------------------------------------------------- logs
function addLog_(ctx, permitId, action, by, note) {
  var t = table_(ctx, 'permit_logs');
  appendRow_(t, { id: nextId_(t), permit_id: permitId, action: action, by_name: by || '', note: note || '', created_at: nowStr_() });
}

function logsFor_(ctx, permitId) {
  return table_(ctx, 'permit_logs').rows
    .filter(function (l) { return Number(l.permit_id) === Number(permitId); })
    .sort(function (a, b) { return Number(a.id) - Number(b.id); })
    .map(function (l) { return { action: l.action, by_name: l.by_name, note: l.note, created_at: l.created_at }; });
}

// ---------------------------------------------------------------- shaping
function permitOut_(r) {
  var types = jdec_(r.work_types, []);
  return {
    id: Number(r.id), permit_no: r.permit_no, company: r.company, permit_type: r.permit_type,
    work_types: types, work_date: r.work_date, time_from: r.time_from, time_to: r.time_to,
    requester_title: r.requester_title, requester_name: r.requester_name, requester_company: r.requester_company,
    requester_phone: r.requester_phone, worker_count: Number(r.worker_count) || 0, workers: jdec_(r.workers, []),
    owner_name: r.owner_name, owner_phone: r.owner_phone, job_detail: r.job_detail, location: r.location,
    checklist: jdec_(r.checklist, {}), loto: jdec_(r.loto, []), confined: jdec_(r.confined, null),
    inspections: jdec_(r.inspections, {}),
    has_attachment: !!r.attachment_file, attachment_name: r.attachment_name,
    has_owner_sign: !!r.owner_sign_file, has_approver_sign: !!r.approver_sign_file,
    status: r.status, es: effectiveStatus_(r), end_ts: permitEndTs_(r),
    approver_name: r.approver_name, approve_comment: r.approve_comment,
    approved_at: r.approved_at, closed_at: r.closed_at, created_at: r.created_at
  };
}

function listRowOut_(r) {
  return {
    id: Number(r.id), permit_no: r.permit_no, status: r.status, es: effectiveStatus_(r), permit_type: r.permit_type,
    work_types: jdec_(r.work_types, []), work_date: r.work_date, time_from: r.time_from, time_to: r.time_to,
    requester_title: r.requester_title, requester_name: r.requester_name, requester_company: r.requester_company,
    requester_phone: r.requester_phone, location: r.location, worker_count: Number(r.worker_count) || 0,
    approver_name: r.approver_name, created_at: r.created_at, end_ts: permitEndTs_(r)
  };
}

function permitsDesc_(ctx) {
  return table_(ctx, 'permits').rows.slice().sort(function (a, b) { return Number(b.id) - Number(a.id); });
}

/**
 * Resolves the permit a caller may read:
 *  - `id` → admin session required
 *  - `no` + `t` → tracking token must match that permit (constant-time)
 */
function authorizedPermit_(p, ctx) {
  if (p.id !== undefined && p.id !== null && p.id !== '') {
    requireAdmin_(p, ctx);
    var byId = findById_(table_(ctx, 'permits'), p.id);
    if (!byId) fail_('ไม่พบใบอนุญาต', 'NOT_FOUND');
    return byId;
  }
  var no = str_(p.no, 30).toUpperCase();
  var tok = String(p.t || '').toLowerCase();
  if (!no || !/^[a-f0-9]{32}$/.test(tok)) fail_('ไม่พบใบอนุญาต', 'NOT_FOUND');
  var rows = table_(ctx, 'permits').rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].permit_no === no) {
      if (safeEqual_(rows[i].token, tok)) return rows[i];
      break;
    }
  }
  fail_('ไม่พบใบอนุญาต', 'NOT_FOUND');
}

// ---------------------------------------------------------------- PUBLIC
/** index.php hero counters (aggregate numbers only — no permit data). */
function apiStats_(p, ctx) {
  var today = todayStr_();
  var s = { total: 0, approved: 0, pending: 0, today: 0 };
  table_(ctx, 'permits').rows.forEach(function (r) {
    s.total++;
    if (r.status === 'approved') s.approved++;
    if (r.status === 'pending') s.pending++;
    if (String(r.created_at).substring(0, 10) === today) s.today++;
  });
  return s;
}

/** api.php?action=submit — anonymous, like the original. */
function apiSubmit_(d) {
  var WT = WP_DATA.workTypes;
  var types = (Array.isArray(d.work_types) ? d.work_types : []).filter(function (t, i, a) {
    return typeof t === 'string' && Object.prototype.hasOwnProperty.call(WT, t) && a.indexOf(t) === i;
  });
  if (!types.length) fail_('กรุณาเลือกลักษณะงาน');
  if (WP_DATA.companies.indexOf(d.company) < 0) fail_('บริษัทไม่ถูกต้อง');
  if (!Object.prototype.hasOwnProperty.call(WP_DATA.permitTypes, String(d.permit_type))) fail_('ประเภทไม่ถูกต้อง');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.work_date || ''))) fail_('วันที่ไม่ถูกต้อง');
  ['time_from', 'time_to'].forEach(function (k) { if (!/^\d{2}:\d{2}$/.test(String(d[k] || ''))) fail_('เวลาไม่ถูกต้อง'); });
  var req = { requester_name: 'ชื่อผู้ขออนุญาต', requester_company: 'บริษัท/หน่วยงาน', requester_phone: 'เบอร์โทรศัพท์', owner_name: 'ผู้รับผิดชอบงานโครงการ', location: 'สถานที่ปฏิบัติงาน', job_detail: 'รายละเอียดงาน' };
  Object.keys(req).forEach(function (k) { if (str_(d[k]) === '') fail_('กรุณากรอก ' + req[k]); });
  var reqSign = checkSignature_(d.requester_sign);
  if (!reqSign) fail_('กรุณาลงลายมือชื่อผู้ขออนุญาต');
  var ownSign = checkSignature_(d.owner_sign);
  var workers = cleanWorkers_(d.workers);
  var att = checkAttachment_(d.attachment);

  var row = {
    company: d.company, permit_type: d.permit_type, work_types: JSON.stringify(types),
    work_date: d.work_date, time_from: d.time_from, time_to: d.time_to,
    requester_title: str_(d.requester_title, 20), requester_name: str_(d.requester_name, 150),
    requester_company: str_(d.requester_company, 200), requester_phone: str_(d.requester_phone, 30),
    worker_count: workers.length, workers: JSON.stringify(workers),
    owner_name: str_(d.owner_name, 150), owner_phone: str_(d.owner_phone, 30),
    job_detail: str_(d.job_detail, 5000), location: str_(d.location),
    checklist: JSON.stringify(cleanChecklist_(d.checklist)), loto: JSON.stringify(cleanLoto_(d.loto)),
    confined: types.indexOf('confined') >= 0 ? JSON.stringify(cleanConfined_(d.confined)) : '',
    inspections: '{}', status: 'pending',
    token: randomHex_(32), created_at: '', updated_at: ''
  };
  // Fail on oversize cells (e.g. 200 very long worker rows) before touching Drive.
  WP_SCHEMA.permits.forEach(function (h) { toCell_(row[h], h); });

  var created = [];
  try {
    var tag = stampName_('png').replace(/\.png$/, '');
    row.requester_sign_file = saveDriveFile_(reqSign, 'image/png', tag + '_requester.png');
    created.push(row.requester_sign_file);
    if (ownSign) { row.owner_sign_file = saveDriveFile_(ownSign, 'image/png', tag + '_owner.png'); created.push(row.owner_sign_file); }
    if (att) {
      row.attachment_file = saveDriveFile_(att.bytes, att.mime, stampName_(att.ext));
      row.attachment_name = att.name;
      row.attachment_mime = att.mime;
      created.push(row.attachment_file);
    }
    return withLock_(function () {
      var ctx = { tables: {} };
      var t = table_(ctx, 'permits');
      // numbering: WP-YYYYMMDD-NNN (per Bangkok day, 3-digit running number)
      var prefix = 'WP-' + Utilities.formatDate(now_(), WP_TZ, 'yyyyMMdd') + '-';
      var seq = 0;
      t.rows.forEach(function (r) {
        if (String(r.permit_no).indexOf(prefix) === 0) seq = Math.max(seq, parseInt(String(r.permit_no).substring(prefix.length), 10) || 0);
      });
      var n = String(seq + 1);
      while (n.length < 3) n = '0' + n;
      row.permit_no = prefix + n;
      row.id = nextId_(t);
      row.created_at = row.updated_at = nowStr_();
      appendRow_(t, row);
      addLog_(ctx, row.id, 'submit', row.requester_name, 'ยื่นใบขออนุญาตปฏิบัติงาน');
      var path = 'track.html?no=' + encodeURIComponent(row.permit_no) + '&t=' + row.token;
      var site = String(props_().getProperty(WP_PROP_SITE_URL) || '').replace(/\/+$/, '');
      return { id: row.id, permit_no: row.permit_no, token: row.token, track_path: path, track_url: site ? site + '/' + path : '' };
    });
  } catch (err) {
    created.forEach(trashDriveFile_);
    throw err;
  }
}

/** api.php?action=track — permit no + requester phone → token. */
function apiTrack_(d, ctx) {
  var no = str_(d.permit_no, 30).toUpperCase();
  var phone = String(d.phone || '').replace(/\D/g, '');
  if (no === '' || phone === '') fail_('กรุณากรอกเลขที่ใบอนุญาตและเบอร์โทรศัพท์');
  var cache = cache_(), key = 'wptf_' + no;
  if ((Number(cache.get(key)) || 0) >= WP_TRACK_MAX_FAIL) fail_('ค้นหาผิดหลายครั้งเกินไป กรุณารอ 15 นาที', 'LOCKED');
  var r = null;
  table_(ctx, 'permits').rows.some(function (x) { if (x.permit_no === no) { r = x; return true; } return false; });
  if (!r || String(r.requester_phone).replace(/\D/g, '') !== phone) {
    cache.put(key, String((Number(cache.get(key)) || 0) + 1), WP_LOGIN_LOCK_SEC);
    fail_('ไม่พบข้อมูล กรุณาตรวจสอบเลขที่และเบอร์โทรศัพท์', 'NOT_FOUND');
  }
  return { permit_no: r.permit_no, token: r.token };
}

// ---------------------------------------------------------------- ADMIN or TOKEN
/** status.php / admin/view.php / print.php data. */
function apiPermit_(p, ctx) {
  var r = authorizedPermit_(p, ctx);
  var out = { permit: permitOut_(r), logs: logsFor_(ctx, r.id) };
  if (p.signs) {
    out.signs = {
      requester: driveDataUrl_(r.requester_sign_file),
      owner: driveDataUrl_(r.owner_sign_file),
      approver: driveDataUrl_(r.approver_sign_file)
    };
  }
  return out;
}

/** file.php — attachment as base64 for authorized callers only. */
function apiFile_(p, ctx) {
  var r = authorizedPermit_(p, ctx);
  if (!r.attachment_file) fail_('ไม่พบไฟล์', 'NOT_FOUND');
  var blob;
  try { blob = DriveApp.getFileById(r.attachment_file).getBlob(); } catch (e) { fail_('ไม่พบไฟล์', 'NOT_FOUND'); }
  var mime = r.attachment_mime || blob.getContentType() || 'application/octet-stream';
  return {
    name: r.attachment_name, mimeType: mime,
    inline: ['application/pdf', 'image/png', 'image/jpeg'].indexOf(mime) >= 0,
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

// ---------------------------------------------------------------- ADMIN
/** api.php?action=poll */
function apiPoll_(p, ctx) {
  requireAdmin_(p, ctx);
  var rows = table_(ctx, 'permits').rows;
  var pending = 0, max = 0;
  rows.forEach(function (r) { if (r.status === 'pending') pending++; max = Math.max(max, Number(r.id) || 0); });
  var out = { pending: pending, max_id: max, 'new': [] };
  if (p.since !== undefined && p.since !== null && p.since !== '') {
    var since = Number(p.since) || 0;
    out['new'] = rows.filter(function (r) { return Number(r.id) > since; })
      .sort(function (a, b) { return Number(a.id) - Number(b.id); }).slice(0, 10)
      .map(function (r) { return { id: Number(r.id), permit_no: r.permit_no, requester_name: r.requester_name, location: r.location }; });
  }
  return out;
}

/** admin/dashboard.php aggregates. */
function apiDashboard_(p, ctx) {
  var u = requireAdmin_(p, ctx);
  var cnt = { pending: 0, approved: 0, rejected: 0, closed: 0, expired: 0 };
  var byType = {};
  workTypeKeys_().forEach(function (k) { byType[k] = 0; });
  var days = {}, dayKeys = [];
  for (var i = 13; i >= 0; i--) {
    var k = Utilities.formatDate(new Date(now_().getTime() - i * 86400000), WP_TZ, 'yyyy-MM-dd');
    days[k] = 0; dayKeys.push(k);
  }
  var activeNow = [], pending = [];
  permitsDesc_(ctx).forEach(function (r) {
    var o = listRowOut_(r);
    if (cnt[o.es] !== undefined) cnt[o.es]++;
    o.work_types.forEach(function (t) { if (byType[t] !== undefined) byType[t]++; });
    var d = String(r.created_at).substring(0, 10);
    if (days[d] !== undefined) days[d]++;
    if (o.es === 'approved') activeNow.push(o);
    if (r.status === 'pending') pending.push(o);
  });
  return {
    user: publicUser_(u), cnt: cnt, byType: byType,
    days: dayKeys.map(function (k) { return { date: k, count: days[k] }; }),
    pending: pending.slice(0, 8), activeNow: activeNow.slice(0, 6)
  };
}

/** admin/permits.php search + filters + status tabs. */
function apiPermits_(p, ctx) {
  requireAdmin_(p, ctx);
  var q = str_(p.q, 200).toLowerCase();
  var type = String(p.type || '');
  var from = /^\d{4}-\d{2}-\d{2}$/.test(String(p.from || '')) ? p.from : '';
  var to = /^\d{4}-\d{2}-\d{2}$/.test(String(p.to || '')) ? p.to : '';
  var status = String(p.status || '');
  var rows = permitsDesc_(ctx).filter(function (r) {
    if (q) {
      var hay = [r.permit_no, r.requester_name, r.requester_company, r.location, r.job_detail, r.owner_name].join('\n').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (type && WP_DATA.workTypes[type] && jdec_(r.work_types, []).indexOf(type) < 0) return false;
    if (from && r.work_date < from) return false;
    if (to && r.work_date > to) return false;
    return true;
  }).slice(0, 1000).map(listRowOut_);
  var counts = {};
  Object.keys(WP_DATA.status).forEach(function (k) { counts[k] = 0; });
  rows.forEach(function (r) { if (counts[r.es] !== undefined) counts[r.es]++; });
  if (status && WP_DATA.status[status]) rows = rows.filter(function (r) { return r.es === status; });
  return { rows: rows, counts: counts };
}

/** api.php?action=save_review — checklist / LOTO / confined / inspection signatures. */
function apiSaveReview_(d, ctx) {
  requireAdmin_(d, ctx);
  return withLock_(function () {
    ctx.tables = {};
    ctx.user = null;
    var u = requireAdmin_(d, ctx);
    var t = table_(ctx, 'permits');
    var p = findById_(t, d.id);
    if (!p) fail_('ไม่พบใบอนุญาต', 'NOT_FOUND');
    var ins = jdec_(p.inspections, {});
    if (Array.isArray(ins)) ins = {};
    var din = (d.inspections && typeof d.inspections === 'object') ? d.inspections : {};
    var stamp = nowStr_();
    Object.keys(WP_DATA.inspectRoles).forEach(function (rk) {
      var role = (din[rk] && typeof din[rk] === 'object') ? din[rk] : {};
      if (!ins[rk] || typeof ins[rk] !== 'object' || Array.isArray(ins[rk])) ins[rk] = {};
      Object.keys(WP_DATA.inspectStages).forEach(function (sk) {
        var name = str_(role[sk] && role[sk].name, 150);
        var old = ins[rk][sk];
        if (name === '') { delete ins[rk][sk]; return; }
        ins[rk][sk] = { name: name, at: (old && old.name === name) ? old.at : stamp };
      });
      var note = str_(role.note, 500);
      if (note !== '') ins[rk].note = note; else delete ins[rk].note;
    });
    p.checklist = JSON.stringify(cleanChecklist_(d.checklist));
    p.loto = JSON.stringify(cleanLoto_(d.loto));
    if (d.confined !== undefined && d.confined !== null) p.confined = JSON.stringify(cleanConfined_(d.confined));
    p.inspections = JSON.stringify(ins);
    p.updated_at = stamp;
    writeRow_(t, p);
    if (d.log) addLog_(ctx, p.id, 'review', u.fullname, 'บันทึกผลการตรวจสอบ');
    return { inspections: ins };
  });
}

/** api.php?action=decide — approve / reject / close. */
function apiDecide_(d, ctx) {
  requireAdmin_(d, ctx);
  var decision = String(d.decision || '');
  var comment = str_(d.comment, 2000);
  if (['approve', 'reject', 'close'].indexOf(decision) < 0) fail_('คำสั่งไม่ถูกต้อง');
  var sign = decision === 'approve' ? checkSignature_(d.sign) : null;
  var signFile = '';
  try {
    return withLock_(function () {
      ctx.tables = {};
      ctx.user = null;
      var u = requireAdmin_(d, ctx);
      var t = table_(ctx, 'permits');
      var p = findById_(t, d.id);
      if (!p) fail_('ไม่พบใบอนุญาต', 'NOT_FOUND');
      var stamp = nowStr_();
      if (decision === 'approve') {
        if (p.status !== 'pending') fail_('ใบอนุญาตนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
        if (!sign) fail_('กรุณาลงลายมือชื่อผู้อนุมัติ');
        var ins = jdec_(p.inspections, {});
        if (Array.isArray(ins)) ins = {};
        if (!ins.safety || typeof ins.safety !== 'object' || Array.isArray(ins.safety)) ins.safety = {};
        ins.safety.permit = { name: u.fullname, at: stamp };
        signFile = saveDriveFile_(sign, 'image/png', p.permit_no + '_approver_' + randomHex_(8) + '.png');
        p.status = 'approved'; p.approver_id = u.id; p.approver_name = u.fullname; p.approver_sign_file = signFile;
        p.approve_comment = comment; p.approved_at = stamp; p.inspections = JSON.stringify(ins);
        p.updated_at = stamp;
        writeRow_(t, p);
        addLog_(ctx, p.id, 'approve', u.fullname, comment || 'อนุมัติให้ปฏิบัติงาน');
      } else if (decision === 'reject') {
        if (p.status !== 'pending') fail_('ใบอนุญาตนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
        if (comment === '') fail_('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
        p.status = 'rejected'; p.approver_id = u.id; p.approver_name = u.fullname;
        p.approve_comment = comment; p.approved_at = stamp; p.updated_at = stamp;
        writeRow_(t, p);
        addLog_(ctx, p.id, 'reject', u.fullname, comment);
      } else {
        if (p.status !== 'approved') fail_('ปิดงานได้เฉพาะใบอนุญาตที่อนุมัติแล้ว');
        p.status = 'closed'; p.closed_at = stamp; p.updated_at = stamp;
        writeRow_(t, p);
        addLog_(ctx, p.id, 'close', u.fullname, comment || 'ตรวจสอบหลังเสร็จงาน ปิดใบอนุญาต');
      }
      return { status: p.status };
    });
  } catch (err) {
    trashDriveFile_(signFile);
    throw err;
  }
}

/** api.php?action=delete — removes the permit, its logs and its Drive files (to Drive trash). */
function apiDelete_(d, ctx) {
  requireAdmin_(d, ctx);
  return withLock_(function () {
    ctx.tables = {};
    ctx.user = null;
    requireAdmin_(d, ctx);
    var t = table_(ctx, 'permits');
    var p = findById_(t, d.id);
    if (!p) fail_('ไม่พบใบอนุญาต', 'NOT_FOUND');
    [p.attachment_file, p.requester_sign_file, p.owner_sign_file, p.approver_sign_file].forEach(trashDriveFile_);
    var lt = table_(ctx, 'permit_logs');
    deleteRows_(lt, lt.rows.filter(function (l) { return Number(l.permit_id) === Number(p.id); }));
    deleteRows_(t, [p]);
    return true;
  });
}
