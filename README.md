# e-Work Permit (FM-MR-58) — GitHub Pages + Google Apps Script

ระบบใบขออนุญาตปฏิบัติงานออนไลน์ (พอร์ตจากเวอร์ชัน PHP/MySQL บน XAMPP)

- หน้าเว็บ (static) อยู่ใน `docs/` → เผยแพร่ด้วย GitHub Pages
- ระบบหลังบ้านอยู่ใน `apps-script/` → Google Apps Script Web App
- ข้อมูลเก็บใน Google Sheet (ชีต `users`, `permits`, `permit_logs`)
- ไฟล์แนบและภาพลายเซ็นเก็บใน Google Drive (โฟลเดอร์ส่วนตัว **ไม่แชร์สาธารณะ**) และส่งให้เฉพาะผู้มีสิทธิ์ผ่าน API

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `apps-script/Code.gs` | router (`doGet`/`doPost`), ตัวช่วยอ่าน/เขียน Sheet, LockService |
| `apps-script/Auth.gs` | รหัสผ่าน (salt + SHA-256 5000 รอบ), login/logout/session, จัดการผู้ใช้ |
| `apps-script/Permits.gs` | ยื่นคำขอ, ติดตาม, รายการ, ตรวจ/อนุมัติ/ไม่อนุมัติ/ปิดงาน/ลบ, ไฟล์แนบ |
| `apps-script/Setup.gs` | `setupSystem()` — รันครั้งเดียว |
| `apps-script/Data.gs` | ข้อมูลอ้างอิง (บริษัท, เช็คลิสต์, ระเบียบ) — **แหล่งข้อมูลเดียว** |
| `appsscript.json` | manifest ของ Apps Script |
| `docs/config.js` | ใส่ URL ของ Web App (`apiUrl`) |
| `docs/assets/js/data.js` | สำเนาของ `Data.gs` (สร้างด้วย `node tools/sync-data.js`) |
| `test/` | ชุดทดสอบ (mock Apps Script ในหน่วยความจำ) + dev server |

## 1) ตั้งค่า Google Apps Script

1. เปิด <https://script.google.com> → **New project** (ใช้บัญชี Google ที่จะเป็นเจ้าของข้อมูล)
2. สร้างไฟล์สคริปต์ 5 ไฟล์ชื่อ `Code`, `Auth`, `Permits`, `Setup`, `Data` แล้วคัดลอกเนื้อหาจาก `apps-script/*.gs` ไปวางให้ครบ (ลบโค้ดตัวอย่าง `myFunction` ออก)
3. **Project Settings** (รูปเฟือง) → ติ๊ก *Show "appsscript.json" manifest file in editor* → เปิด `appsscript.json` แล้วแทนที่ด้วยไฟล์ `appsscript.json` ของชุดนี้ (timeZone `Asia/Bangkok`, V8)
4. **Project Settings → Script properties → Add script property**
   - `WP_INITIAL_ADMIN_PASSWORD` = รหัสผ่านเริ่มต้นของผู้ใช้ `admin` (อย่างน้อย 8 ตัวอักษร)
   - (ไม่บังคับ) `WP_RESET_PASSWORD` = รหัสผ่านสำหรับปุ่ม "รีเซ็ตข้อมูล" ในแดชบอร์ด จป. (ลบใบอนุญาต/logs ทั้งหมด และย้ายไฟล์แนบ/ลายเซ็นไปถังขยะ Drive; ผู้ใช้ยังอยู่) — ไม่ตั้ง = ปุ่มรีเซ็ตใช้ไม่ได้
   - (ไม่บังคับ) `WP_SITE_URL` = URL ของ GitHub Pages เช่น `https://YOUR_USERNAME.github.io/work-permit` (ใช้สร้างลิงก์ติดตามแบบเต็มใน response)
5. เลือกฟังก์ชัน `setupSystem` → **Run** → อนุญาตสิทธิ์ Google Sheets และ Google Drive
   - ระบบจะสร้าง Spreadsheet "e-Work Permit (FM-MR-58) Database", โฟลเดอร์ Drive "e-Work Permit (FM-MR-58) Files" และผู้ใช้ `admin`
   - รันซ้ำได้ (ไม่สร้างซ้ำ/ไม่ลบข้อมูลเดิม) ถ้ายังไม่ได้ตั้ง `WP_INITIAL_ADMIN_PASSWORD` ระบบจะหยุดพร้อมข้อความแจ้ง
6. **Deploy → New deployment → Web app**
   - Execute as: **Me** (USER_DEPLOYING)
   - Who has access: **Anyone** (ANYONE_ANONYMOUS)
   - กด Deploy แล้วคัดลอก URL ที่ลงท้ายด้วย `/exec`
7. หลังเข้าระบบครั้งแรก: ผู้ใช้เริ่มต้น `admin` / (รหัสจาก `WP_INITIAL_ADMIN_PASSWORD`) → **เปลี่ยนรหัสผ่านทันที** ที่เมนู "ผู้ใช้งาน จป." แล้วลบ Script Property `WP_INITIAL_ADMIN_PASSWORD` ทิ้ง

> ทุกครั้งที่แก้ไฟล์ `.gs` ต้อง **Deploy → Manage deployments → Edit → Version: New version** เพื่อให้ URL เดิมใช้โค้ดใหม่

## 2) ตั้งค่าหน้าเว็บ (GitHub Pages)

แก้ `docs/config.js`:

```js
window.WP_CONFIG = { apiUrl: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec" };
```

ถ้า `apiUrl` ว่าง ทุกหน้าจะแสดงแถบเตือนสีเหลืองภาษาไทย

จากนั้น push ขึ้น GitHub แล้วไปที่ **Settings → Pages → Deploy from a branch → `main` / `/docs`**

## การทำงาน

- ผู้รับเหมา/ผู้ขอ: `request.html` → กรอก 4 ขั้นตอน → ลงนาม → ได้เลขที่ (`WP-YYYYMMDD-NNN`) + QR สำหรับติดตาม (`track.html?no=…&t=…`)
- ติดตามสถานะ: สแกน QR หรือกรอกเลขที่ + เบอร์โทรที่ `track.html`
- จป.: `login.html` → แดชบอร์ดแจ้งเตือนทุก 15 วินาที (เสียง + toast) → ตรวจ/แก้เช็คลิสต์ → ลงนามอนุมัติ หรือไม่อนุมัติพร้อมเหตุผล
  → ลงชื่อตรวจ ก่อน/ระหว่าง/หลังงาน → ปิดงาน → พิมพ์ใบอนุญาต (A4, บันทึก PDF ได้)
- ใบอนุญาตที่อนุมัติแล้วจะแสดง "หมดอายุ" อัตโนมัติเมื่อเกินเวลาที่ระบุ หรือเกิน 24 ชม.

## ความปลอดภัย

- หน้าเว็บเปิดสาธารณะ แต่ **ข้อมูลใบอนุญาต** (รายละเอียด, ประวัติ, ลายเซ็น, ไฟล์แนบ) อ่านได้เฉพาะ
  (ก) จป. ที่เข้าสู่ระบบ หรือ (ข) ผู้ถือ token ของใบอนุญาตนั้น (เลขที่ + token ใน QR/ลิงก์)
- หน้าแรกแสดงเฉพาะตัวเลขสรุป (จำนวน) เท่านั้น
- รหัสผ่านเก็บแบบ salt + SHA-256 วนซ้ำ 5000 รอบ, session token สุ่มเก็บใน CacheService 6 ชม.
- เข้าสู่ระบบผิด 10 ครั้ง → ล็อกชื่อผู้ใช้นั้น 15 นาที; การค้นหาด้วยเลขที่+เบอร์โทรผิด 10 ครั้ง → ล็อก 15 นาที
- เปลี่ยนรหัสผ่าน/ปิดการใช้งานผู้ใช้ → session เดิมของผู้ใช้นั้นใช้ไม่ได้ทันที
- ไฟล์แนบ: ≤ 10MB, PDF/JPG/PNG/XLS/XLSX/DOC/DOCX (ตรวจทั้งนามสกุลและ signature ของไฟล์)
- การเขียนข้อมูลทุกครั้งอยู่ภายใต้ `LockService` ; ข้อความที่ขึ้นต้นด้วย `=` `+` `-` `@` ถูกบันทึกเป็นข้อความ (กันสูตร)

## ตั้งค่าข้อมูลอ้างอิง

แก้ `apps-script/Data.gs` (รายชื่อบริษัท, หัวข้อเช็คลิสต์, ระเบียบ, อายุใบอนุญาต, ขนาดไฟล์แนบ) แล้วรัน

```
node tools/sync-data.js
```

เพื่อคัดลอกไปที่ `docs/assets/js/data.js` จากนั้นอัปเดตทั้ง Apps Script (New version) และ GitHub Pages

## ทดสอบ

```
node test/run.js                     # ทดสอบ backend แบบ end-to-end (mock) + ตรวจ syntax หน้าเว็บ
node test/dev-server.js 8765         # เปิด docs/ พร้อม API จำลองที่ http://localhost:8765/ (admin / dev-admin-pass)
node test/dev-server.js 8765 --no-api  # เปิด docs/ ตามที่ส่งจริง (apiUrl ว่าง)
```
