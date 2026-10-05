// status.php — requester view, authorised by permit no + tracking token
(async () => {
  const { $ } = WP, E = WP.esc;
  const no = WP.qs('no'), t = WP.qs('t'), isNew = !!WP.qs('new');
  if (!no || !t) { location.replace(WP.base + '/track.html?nf=1'); return; }
  const root = $('#status-root');
  if (!WP.apiUrl) { root.innerHTML = ''; return; }

  const r = await WP.api('permit', { no, t });
  if (!r.ok) {
    if (r.code === 'NOT_FOUND') { location.replace(WP.base + '/track.html?nf=1'); return; }
    root.innerHTML = `<div class="alert err"><i class="fa-solid fa-triangle-exclamation"></i><div>${E(r.msg)}</div></div>`;
    return;
  }
  const p = r.data.permit, es = p.es;
  const q = `no=${encodeURIComponent(p.permit_no)}&t=${encodeURIComponent(t)}`;
  const link = `${WP.base}/track.html?${q}`;
  const printUrl = `${WP.base}/print.html?${q}`;
  document.title = 'สถานะ ' + p.permit_no + ' · ' + WP.data.config.appName;

  let h = '';
  if (isNew) h += `<div class="card success-wrap glow-border always mb2">
  <svg class="check-anim" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54"/><path d="M36 62 l16 16 l32 -36"/></svg>
  <h2 style="margin:0;font-weight:500">ส่งใบขออนุญาตเรียบร้อยแล้ว!</h2>
  <p class="text2">ระบบได้แจ้งเตือนไปยัง <b>เจ้าหน้าที่ความปลอดภัย (จป.)</b> แล้ว กรุณาบันทึกเลขที่ใบอนุญาตไว้เพื่อติดตามสถานะ</p>
  <div class="big-no">${E(p.permit_no)}</div>
  <div class="qr-box"><div id="qr"></div></div>
  <p class="hint">สแกน QR หรือบันทึกลิงก์นี้เพื่อติดตามสถานะ</p>
  <div class="flex" style="justify-content:center">
    <button class="btn ghost" id="copy"><i class="fa-solid fa-copy"></i> คัดลอกลิงก์</button>
    <a class="btn ghost" href="${printUrl}" target="_blank"><i class="fa-solid fa-print"></i> พิมพ์ใบคำขอ</a>
    <a class="btn" href="${WP.base}/request.html"><i class="fa-solid fa-plus"></i> ขอใบอนุญาตใหม่</a>
  </div>
</div>`;

  h += `<div class="card hero-strip glow-border always reveal">
  <div class="hs-ic"><i class="fa-solid fa-file-shield ic-float"></i></div>
  <div>
    <h2>${E(p.permit_no)} ${WP.statusBadge(es)}</h2>
    <div class="meta"><span><i class="fa-solid fa-location-dot"></i> ${E(p.location)}</span><span><i class="fa-regular fa-calendar"></i> ${WP.thaiDate(p.work_date)} ${WP.hm(p.time_from)}–${WP.hm(p.time_to)}</span></div>
  </div>
  <div class="actions"><a class="btn ${['approved', 'closed'].includes(p.status) ? 'gold' : 'ghost'}" href="${printUrl}" target="_blank"><i class="fa-solid fa-print"></i> พิมพ์ใบอนุญาต</a></div>
</div>`;

  h += `<div class="card mb2 reveal"><div class="card-b">${WP.trackStepsHTML(p)}`;
  if (p.status === 'rejected') {
    h += `<div class="alert err mt2"><i class="fa-solid fa-circle-xmark"></i><div><b>เหตุผลที่ไม่อนุมัติ:</b> ${WP.nl2br(p.approve_comment)}<br><small>โดย ${E(p.approver_name)} · ${WP.thaiDate(p.approved_at, true)}</small><br><a href="${WP.base}/request.html">ยื่นคำขอใหม่ <i class="fa-solid fa-arrow-right"></i></a></div></div>`;
  } else if (p.status === 'approved' && es !== 'expired') {
    h += `<div class="alert info mt2"><i class="fa-solid fa-circle-check ic-beat"></i><div><b>อนุมัติให้ปฏิบัติงานได้</b> โดย ${E(p.approver_name)} · ${WP.thaiDate(p.approved_at, true)}${p.approve_comment ? '<br>เงื่อนไข/หมายเหตุ: ' + WP.nl2br(p.approve_comment) : ''}</div></div>`;
  } else if (p.status === 'pending') {
    h += `<div class="alert warn mt2"><i class="fa-solid fa-hourglass-half ic-spin"></i><div>อยู่ระหว่างรอ จป. พิจารณา — <b>ห้ามเริ่มปฏิบัติงานจนกว่าจะได้รับอนุมัติ</b> <span class="muted">(หน้านี้จะอัปเดตอัตโนมัติ)</span></div></div>`;
  }
  h += `</div></div>`;

  h += `<div class="detail-grid">
  <div>${WP.infoCardHTML(p)}</div>
  <div class="card reveal"><div class="card-h"><span class="ch-ic"><i class="fa-solid fa-timeline ic-bob"></i></span><h3>ประวัติการดำเนินการ</h3></div><div class="card-b">${WP.timelineHTML(r.data.logs)}</div></div>
</div>`;
  root.innerHTML = h;
  WP.reveal(root);
  WP.bindAttachment(root, { no: p.permit_no, t });

  if (isNew) {
    if (window.QRCode) new QRCode(document.getElementById('qr'), { text: link, width: 150, height: 150, colorDark: '#04170e' });
    setTimeout(WP.celebrate, 900);
    $('#copy').onclick = () => navigator.clipboard.writeText(link).then(() => Swal.fire({ icon: 'success', title: 'คัดลอกลิงก์แล้ว', timer: 1400, showConfirmButton: false }));
    history.replaceState(null, '', `status.html?${q}`);
  }
  if (p.status === 'pending') setTimeout(() => location.reload(), 30000);
})();
