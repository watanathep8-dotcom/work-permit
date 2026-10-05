// admin/view.php — review checklist, inspections, approve / reject / close / delete
(async () => {
  if (WP.halt) return;
  const { $, $$ } = WP, D = WP.data, E = WP.esc;
  const root = $('#view-root');
  const id = +WP.qs('id');
  if (!id) { location.replace('permits.html'); return; }
  const r = await WP.api('permit', { id, signs: true });
  if (!r.ok) {
    if (r.code === 'NOT_FOUND') { location.replace('permits.html'); return; }
    root.innerHTML = `<div class="alert err"><i class="fa-solid fa-triangle-exclamation"></i><div>${E(r.msg)}</div></div>`;
    return;
  }
  const p = r.data.permit, sg = r.data.signs || {}, es = p.es, types = p.work_types;
  const editable = ['pending', 'approved'].includes(p.status);
  const ins = p.inspections || {};
  const me = (WP.user && WP.user.fullname) || '';
  WP.setPage('พิจารณาใบอนุญาต ' + p.permit_no, p.status === 'pending' ? 'pending' : 'list');
  const P = { id: p.id, types, checklist: p.checklist || {}, loto: p.loto || [], confined: p.confined || {}, editable, me };

  const inspRows = Object.entries(D.inspectRoles).map(([rk, rl]) => `
            <tr><td class="role">${E(rl)}</td>
              ${Object.keys(D.inspectStages).map(sk => {
                const c = (ins[rk] || {})[sk];
                const enabled = editable && !(rk === 'safety' && sk === 'permit');
                return `<td><div class="insp-cell ${c ? 'filled' : ''}">
                  ${c ? '<i class="fa-solid fa-stamp stamp"></i>' : ''}
                  <input data-r="${rk}" data-s="${sk}" value="${E(c ? c.name : '')}" placeholder="ลงชื่อ..." ${enabled ? '' : 'disabled'}>
                  <small>${c ? WP.thaiDate(c.at, true) : '&nbsp;'}</small>
                  ${editable && rk === 'safety' && sk !== 'permit' && !c ? `<button type="button" class="btn sm ghost mt1 sign-me" data-r="${rk}" data-s="${sk}"><i class="fa-solid fa-signature"></i> ลงชื่อฉัน</button>` : ''}
                </div></td>`;
              }).join('')}
              <td><div class="insp-cell"><input data-r="${rk}" data-note="1" value="${E((ins[rk] || {}).note || '')}" placeholder="..." ${editable ? '' : 'disabled'}></div></td>
            </tr>`).join('');

  let side = '';
  if (p.status === 'pending') {
    side = `<div class="card mb2 glow-border always reveal">
      <div class="card-h"><span class="ch-ic" style="color:var(--gold)"><i class="fa-solid fa-gavel ic-wiggle"></i></span><h3>การพิจารณาของ จป.</h3></div>
      <div class="card-b">
        <div class="alert warn mb2"><i class="fa-solid fa-triangle-exclamation ic-flicker"></i><div>ข้าพเจ้าได้ตรวจสอบลักษณะงานและอุปกรณ์ป้องกันในบริเวณพื้นที่โครงการ ซึ่งเห็นว่าปลอดภัยตามความเหมาะสมที่จะให้ปฏิบัติงาน และเป็นไปตามเงื่อนไขตามรายการข้างต้นแล้ว</div></div>
        <div class="field mb2"><label><i class="fa-solid fa-comment-dots"></i> ความเห็น / เงื่อนไขเพิ่มเติม</label><textarea class="input" id="comment" placeholder="เช่น ต้องมีผู้เฝ้าระวังไฟ (Fire Watch) ตลอดเวลา"></textarea></div>
        <div id="sig-appr-box"></div>
        <div class="grid g2 mt2">
          <button class="btn danger" id="btn-reject"><i class="fa-solid fa-circle-xmark"></i> ไม่อนุมัติ</button>
          <button class="btn" id="btn-approve"><i class="fa-solid fa-circle-check"></i> อนุมัติ</button>
        </div>
      </div>
    </div>`;
  } else if (p.status === 'approved') {
    side = `<div class="card mb2 glow-border always reveal">
      <div class="card-h"><span class="ch-ic"><i class="fa-solid fa-circle-check ic-beat"></i></span><h3>อนุมัติแล้ว</h3></div>
      <div class="card-b">
        <p class="text2 mt0">โดย <b>${E(p.approver_name)}</b><br><small>${WP.thaiDate(p.approved_at, true)}</small></p>
        ${sg.approver ? `<img class="sig-img" src="${sg.approver}">` : ''}
        ${p.approve_comment ? `<p class="text2">เงื่อนไข: ${WP.nl2br(p.approve_comment)}</p>` : ''}
        <div class="alert info mt2"><i class="fa-solid fa-broom"></i><div>เมื่อเสร็จงาน: ตรวจสอบการจัดเก็บอุปกรณ์เครื่องมือ ทำความสะอาดพื้นที่ และไม่มีสิ่งที่ก่อให้เกิดอันตราย แล้วกดปิดงาน</div></div>
        <button class="btn blue w100 mt2" id="btn-close"><i class="fa-solid fa-flag-checkered"></i> ตรวจสอบหลังเสร็จงาน & ปิดงาน</button>
      </div>
    </div>`;
  } else {
    side = `<div class="card mb2 reveal"><div class="card-b">
      ${WP.statusBadge(es)}
      <p class="text2">โดย <b>${E(p.approver_name)}</b> · ${WP.thaiDate(p.approved_at, true)}</p>
      ${sg.approver ? `<img class="sig-img" src="${sg.approver}">` : ''}
      ${p.approve_comment ? `<p class="text2">${WP.nl2br(p.approve_comment)}</p>` : ''}
      ${p.closed_at ? `<p class="text2"><i class="fa-solid fa-flag-checkered"></i> ปิดงานเมื่อ ${WP.thaiDate(p.closed_at, true)}</p>` : ''}
    </div></div>`;
  }

  root.innerHTML = `
<div class="card hero-strip glow-border always reveal">
  <div class="hs-ic"><i class="fa-solid ${p.status === 'pending' ? 'fa-gavel ic-wiggle' : 'fa-file-shield ic-float'}"></i></div>
  <div>
    <h2>${E(p.permit_no)} ${WP.statusBadge(es)}</h2>
    <div class="meta"><span><i class="fa-solid fa-user"></i> ${E(p.requester_name)} (${E(p.requester_company)})</span><span><i class="fa-solid fa-location-dot"></i> ${E(p.location)}</span><span><i class="fa-regular fa-paper-plane"></i> ยื่นเมื่อ ${WP.thaiDate(p.created_at, true)}</span></div>
  </div>
  <div class="actions">
    <a class="btn ghost" href="../print.html?id=${p.id}" target="_blank"><i class="fa-solid fa-print"></i> พิมพ์</a>
    <button class="btn-icon" id="btn-del" title="ลบใบอนุญาต" style="color:var(--red)"><i class="fa-solid fa-trash-can"></i></button>
  </div>
</div>

<div class="card mb2 reveal"><div class="card-b">${WP.trackStepsHTML(p)}</div></div>

<div class="detail-grid">
  <div>
    ${WP.infoCardHTML(p)}

    <div class="card mb2 reveal">
      <div class="card-h"><span class="ch-ic"><i class="fa-solid fa-list-check ic-beat"></i></span><h3>รายการตรวจสอบความปลอดภัย</h3><span class="spacer"></span>
        ${editable ? '<small class="muted"><i class="fa-solid fa-pen"></i> จป. ปรับแก้ได้ตามหน้างาน</small>' : ''}</div>
      <div class="card-b" id="checklist"></div>
    </div>

    ${types.includes('electric') ? `<div class="card mb2 reveal">
      <div class="card-h"><span class="ch-ic" style="color:#facc15"><i class="fa-solid fa-lock ic-wiggle"></i></span><h3>ตาราง Lock Out / Tag Out</h3></div>
      <div class="card-b" id="loto"></div>
    </div>` : ''}

    ${types.includes('confined') ? `<div class="card mb2 reveal">
      <div class="card-h"><span class="ch-ic" style="color:#22d3ee"><i class="fa-solid fa-dungeon ic-float"></i></span><h3>บันทึกงานในที่อับอากาศ (FM-EMR-46 ข้อ 8–11)</h3></div>
      <div class="card-b" id="cs-box"></div>
    </div>` : ''}

    <div class="card mb2 reveal">
      <div class="card-h"><span class="ch-ic"><i class="fa-solid fa-clipboard-user ic-bob"></i></span><h3>การอนุญาต & การตรวจสอบ (ก่อน / ระหว่าง / หลัง)</h3></div>
      <div class="card-b" style="overflow-x:auto">
        <table class="insp" id="insp">
          <thead><tr><th></th>${Object.values(D.inspectStages).map(sl => `<th>${E(sl)}</th>`).join('')}<th>หมายเหตุ</th></tr></thead>
          <tbody>${inspRows}</tbody>
        </table>
        ${editable ? '<div class="flex mt2"><button class="btn" id="btn-save"><i class="fa-solid fa-floppy-disk"></i> บันทึกผลการตรวจสอบ</button><span class="hint">ระบบประทับเวลาให้อัตโนมัติเมื่อมีการลงชื่อ</span></div>' : ''}
      </div>
    </div>
  </div>

  <div style="position:sticky;top:90px">
    ${side}

    <div class="card mb2 reveal">
      <div class="card-h"><span class="ch-ic"><i class="fa-solid fa-signature ic-swing"></i></span><h3>ลายมือชื่อ</h3></div>
      <div class="card-b grid g2">
        <div class="center">${sg.requester ? `<img class="sig-img" src="${sg.requester}">` : ''}<br><small class="text2">ผู้ขออนุญาต (ผู้รับเหมา)<br>${E(p.requester_name)}</small></div>
        <div class="center">${sg.owner ? `<img class="sig-img" src="${sg.owner}">` : '<div class="muted" style="padding:24px 0">— ยังไม่ลงนาม —</div>'}<br><small class="text2">ผู้รับผิดชอบงานโครงการ<br>${E(p.owner_name)}</small></div>
      </div>
    </div>

    <div class="card reveal">
      <div class="card-h"><span class="ch-ic"><i class="fa-solid fa-timeline ic-bob"></i></span><h3>ประวัติการดำเนินการ</h3></div>
      <div class="card-b">${WP.timelineHTML(r.data.logs)}</div>
    </div>
  </div>
</div>`;
  WP.reveal(root);
  WP.bindAttachment(root, { id: p.id });

  // ---------- same client logic as view.php ----------
  WP.renderChecklist($('#checklist'), WP.defs, P.types, P.checklist, !P.editable);
  if ($('#loto')) WP.renderLoto($('#loto'), P.loto, !P.editable);
  if ($('#cs-box')) WP.renderConfined($('#cs-box'), P.confined, !P.editable, true);

  const collect = () => {
    const o = {};
    $$('#insp input[data-s]').forEach(i => { (o[i.dataset.r] ??= {})[i.dataset.s] = { name: i.value.trim() }; });
    $$('#insp input[data-note]').forEach(i => { (o[i.dataset.r] ??= {}).note = i.value.trim(); });
    return { id: P.id, checklist: WP.collectChecklist($('#checklist')), loto: $('#loto') ? WP.collectLoto($('#loto')) : [], ...($('#cs-box') ? { confined: WP.collectConfined($('#cs-box')) } : {}), inspections: o };
  };
  const save = async (log = true) => { const x = await WP.api('save_review', { ...collect(), log }); if (!x.ok) throw new Error(x.msg); return x; };

  $$('.sign-me').forEach(b => b.onclick = () => {
    const i = $(`#insp input[data-r="${b.dataset.r}"][data-s="${b.dataset.s}"]`); i.value = P.me;
    i.closest('.insp-cell').classList.add('filled'); b.remove();
  });
  $('#btn-save')?.addEventListener('click', async () => {
    try { await save(); Swal.fire({ icon: 'success', title: 'บันทึกเรียบร้อย', timer: 1300, showConfirmButton: false }).then(() => location.reload()); }
    catch (e) { Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: e.message }); }
  });

  let pad;
  if ($('#sig-appr-box')) { $('#sig-appr-box').innerHTML = WP.sigHTML('sig-appr', 'ลงชื่อผู้อนุมัติ (จป.) <span class="req">*</span>'); pad = new WP.SignaturePad($('#sig-appr')); }

  const decide = async (decision, comment, sign = '') => {
    const x = await WP.api('decide', { id: P.id, decision, comment, sign });
    if (!x.ok) { Swal.fire({ icon: 'error', title: 'ไม่สำเร็จ', text: x.msg }); return false; }
    return true;
  };

  $('#btn-approve')?.addEventListener('click', async () => {
    if (pad.empty) return Swal.fire({ icon: 'warning', title: 'กรุณาลงลายมือชื่อผู้อนุมัติ' });
    const c = await Swal.fire({ icon: 'question', title: 'ยืนยันอนุมัติใบอนุญาต?', html: 'ผู้ขอจะสามารถเริ่มปฏิบัติงานได้ตามเวลาที่ระบุ', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-circle-check"></i> อนุมัติ', cancelButtonText: 'ยกเลิก' });
    if (!c.isConfirmed) return;
    Swal.fire({ title: 'กำลังบันทึก...', showConfirmButton: false, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try { await save(false); } catch (e) { return Swal.fire({ icon: 'error', title: 'บันทึกเช็คลิสต์ไม่สำเร็จ', text: e.message }); }
    if (await decide('approve', $('#comment').value, pad.toData())) {
      WP.celebrate();
      Swal.fire({ icon: 'success', title: 'อนุมัติเรียบร้อย!', html: '<i class="fa-solid fa-helmet-safety fa-3x ic-swing" style="color:var(--gold);margin:10px"></i><br>ขอให้ปฏิบัติงานอย่างปลอดภัย', timer: 2600, showConfirmButton: false }).then(() => location.reload());
    }
  });
  $('#btn-reject')?.addEventListener('click', async () => {
    const x = await Swal.fire({ icon: 'warning', title: 'ไม่อนุมัติใบอนุญาต', input: 'textarea', inputValue: $('#comment').value, inputPlaceholder: 'ระบุเหตุผล / สิ่งที่ต้องแก้ไข', inputValidator: v => !v.trim() && 'กรุณาระบุเหตุผล', showCancelButton: true, confirmButtonText: 'ยืนยันไม่อนุมัติ', cancelButtonText: 'ยกเลิก' });
    if (x.isConfirmed && await decide('reject', x.value)) location.reload();
  });
  $('#btn-close')?.addEventListener('click', async () => {
    const x = await Swal.fire({ icon: 'question', title: 'ปิดงาน?', input: 'textarea', inputPlaceholder: 'บันทึกผลการตรวจสอบหลังเสร็จงาน (ถ้ามี)', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-flag-checkered"></i> ปิดงาน', cancelButtonText: 'ยกเลิก' });
    if (!x.isConfirmed) return;
    try { await save(false); } catch { }
    if (await decide('close', x.value)) { WP.celebrate(); setTimeout(() => location.reload(), 1500); }
  });
  $('#btn-del').onclick = async () => {
    const x = await Swal.fire({ icon: 'warning', title: 'ลบใบอนุญาตนี้ถาวร?', text: 'ไม่สามารถกู้คืนได้', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#dc2626' });
    if (!x.isConfirmed) return;
    const y = await WP.api('delete', { id: P.id });
    if (y.ok) location.href = 'permits.html'; else Swal.fire({ icon: 'error', title: y.msg });
  };
})();
