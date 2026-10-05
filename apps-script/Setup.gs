/**
 * One-time setup. Run setupSystem() from the Apps Script editor and approve the
 * Google Sheets / Google Drive permissions. Safe to run again (idempotent):
 * existing spreadsheet, sheets, folder and users are kept; missing pieces are
 * created.
 *
 * Before the FIRST run set Script Property WP_INITIAL_ADMIN_PASSWORD
 * (Project Settings > Script properties). It becomes the password of user
 * `admin`; change it right after the first login, then delete the property.
 */
function setupSystem() {
  var props = props_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = null;
    var ssId = props.getProperty(WP_PROP_SPREADSHEET);
    if (ssId) {
      try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
    }

    // Decide whether an initial admin is needed BEFORE creating anything.
    var needAdmin = true;
    if (ss) {
      var us = ss.getSheetByName('users');
      if (us && us.getLastRow() > 1) needAdmin = false;
    }
    var initialPassword = props.getProperty(WP_PROP_INITIAL_ADMIN_PASSWORD) || '';
    if (needAdmin && initialPassword.length < 8) {
      throw new Error(
        'กรุณาตั้งค่า Script Property "' + WP_PROP_INITIAL_ADMIN_PASSWORD + '" (อย่างน้อย 8 ตัวอักษร) ก่อนรัน setupSystem() — ' +
        'Project Settings > Script properties. / Set Script Property ' + WP_PROP_INITIAL_ADMIN_PASSWORD +
        ' (min 8 characters) before running setupSystem().'
      );
    }

    var createdSpreadsheet = false;
    if (!ss) {
      ss = SpreadsheetApp.create('e-Work Permit (FM-MR-58) Database');
      createdSpreadsheet = true;
    }
    Object.keys(WP_SCHEMA).forEach(function (name, i) {
      var headers = WP_SCHEMA[name];
      var sh = ss.getSheetByName(name);
      if (!sh) {
        var first = ss.getSheets()[0];
        if (createdSpreadsheet && i === 0 && first && first.getLastRow() === 0) {
          sh = first;
          sh.setName(name);
        } else {
          sh = ss.insertSheet(name);
        }
      }
      var ensureCols = function (n) {
        if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
      };
      if (sh.getLastRow() === 0) {
        ensureCols(headers.length);
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      } else {
        // add any missing columns at the end (forward-compatible upgrades)
        var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
        var missing = headers.filter(function (h) { return cur.indexOf(h) < 0; });
        if (missing.length) {
          ensureCols(cur.length + missing.length);
          sh.getRange(1, cur.length + 1, 1, missing.length).setValues([missing]);
        }
      }
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
      // Everything is stored as plain text (phones keep leading zeros, dates/times stay strings).
      sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    });

    var folder = null;
    var folderId = props.getProperty(WP_PROP_FOLDER);
    if (folderId) {
      try { folder = DriveApp.getFolderById(folderId); } catch (e2) { folder = null; }
    }
    if (!folder) folder = DriveApp.createFolder('e-Work Permit (FM-MR-58) Files');

    props.setProperties({ WP_SPREADSHEET_ID: ss.getId(), WP_FOLDER_ID: folder.getId() }, false);

    var adminCreated = false;
    if (needAdmin) {
      var ctx = { tables: {}, ss: ss };
      var t = table_(ctx, 'users');
      if (!t.rows.length) {
        var pf = makePasswordFields_(initialPassword);
        pf.id = 1;
        pf.username = 'admin';
        pf.fullname = 'ผู้ดูแลระบบ จป.';
        pf.position = WP_DATA.config.defaultPosition;
        pf.active = '1';
        pf.must_change = '1';
        pf.created_at = nowStr_();
        appendRow_(t, pf);
        adminCreated = true;
      }
    }
    SpreadsheetApp.flush();
    bumpDataVersion_(); // cached reads must not survive a (re-)setup

    var result = {
      spreadsheetUrl: ss.getUrl(),
      folderUrl: folder.getUrl(),
      adminCreated: adminCreated,
      note: adminCreated
        ? 'สร้างผู้ใช้ admin แล้ว — เข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านทันที และลบ Script Property ' + WP_PROP_INITIAL_ADMIN_PASSWORD
        : 'ระบบพร้อมใช้งาน (ไม่ได้สร้างผู้ใช้ใหม่)'
    };
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}
