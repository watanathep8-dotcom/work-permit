// print.php — A4 printable permit (admin by ?id=, requester by ?no=&t=)
(async () => {
  const D = WP.data, E = WP.esc, WT = D.workTypes;
  const root = document.getElementById('print-root');
  const id = WP.qs('id'), no = WP.qs('no'), t = WP.qs('t');
  const notFound = msg => { root.innerHTML = `<div class="page" style="min-height:auto;text-align:center;font-size:16px">${E(msg || 'ไม่พบใบอนุญาต')}</div>`; };
  if (!WP.apiUrl) return notFound('ยังไม่ได้ตั้งค่า apiUrl ใน docs/config.js');
  let r;
  if (id && WP.session) r = await WP.api('permit', { id: +id, signs: true });
  else if (no && t) r = await WP.api('permit', { no, t, signs: true });
  else return notFound(id ? 'กรุณาเข้าสู่ระบบ จป. ก่อนพิมพ์' : 'ไม่พบใบอนุญาต');
  if (!r.ok) return notFound(r.msg);

  const p = r.data.permit, sg = r.data.signs || {};
  const types = p.work_types, cl = p.checklist || {}, loto = p.loto || [], ins = p.inspections || {}, es = p.es;
  document.title = p.permit_no + ' · ใบขออนุญาตปฏิบัติงาน';
  const box = on => on ? '<span class="cb on">✓</span>' : '<span class="cb"></span>';
  const par = on => on ? '(<b>✓</b>)' : '(&nbsp;&nbsp;)';
  const td = WP.thaiDate, hm = WP.hm;
  const sigImg = src => src ? `<img class="sig" src="${src}">` : '';

  const itemHtml = it => {
    const v = cl[it.id];
    switch (it.type) {
      case 'group': return `<div class="grp">${E(it.label)}</div>`;
      case 'check': return `<div class="it">${box(!!v)} ${E(it.label)}</div>`;
      case 'text': return `<div class="it">${E(it.label)} <u class="fill">${E(v || '')}</u></div>`;
      case 'checktext': return `<div class="it">${box(!!(v && v.on))} ${E(it.label)} <u class="fill">${E((v && v.text) || '')}</u></div>`;
      case 'ppe': {
        const sel = (v && v.sel) || [];
        return `<div class="it">${E(it.label)}</div><div class="ppe">` +
          it.options.map(o => `<span>${par(sel.includes(o))} ${E(o)}</span>`).join('') +
          `<span>${par(!!(v && v.other))} Other <u class="fill">${E((v && v.other) || '')}</u></span></div>`;
      }
    }
    return '';
  };
  const section = (k, withNote) => {
    const w = WT[k], on = types.includes(k);
    return `<div class="${on ? '' : 'wt-off'}"><div class="sec">${box(on)} ${E(w.label)}</div>
      <div style="padding:3px 6px">${withNote ? `<div class="small">${E(w.note)}</div>` : ''}${w.items.map(itemHtml).join('')}</div></div>`;
  };
  const stamp = `<div class="stamp ${es}">${E(D.status[es].label)}</div>`;
  const ol = arr => '<ol>' + arr.map(x => `<li>${E(x)}</li>`).join('') + '</ol>';

  // ---------------- page 1
  let h = `<div class="page">
  ${stamp}
  <table class="head">
    <tr>
      <td style="width:34%"><div class="co">${E(p.company)}</div><div class="small">เลขที่: <span class="no">${E(p.permit_no)}</span></div></td>
      <td class="title" style="width:32%">ใบขออนุญาตปฏิบัติงาน<br>(Work Permit)</td>
      <td style="width:34%">ประเภท ${box(p.permit_type === 'contractor')} งานผู้รับเหมา &nbsp; ${box(p.permit_type === 'internal')} งานภายใน<br>
        วันที่ <span class="val">${td(p.work_date)}</span> เวลา <span class="val">${hm(p.time_from)}</span> ถึง <span class="val">${hm(p.time_to)}</span></td>
    </tr>
    <tr><td colspan="3"><b>ลักษณะงาน</b> &nbsp;
      ${Object.entries(WT).map(([k, w]) => `<span style="margin-right:12px">${box(types.includes(k))} ${E(w.label)}</span>`).join('')}</td></tr>
    <tr><td colspan="3">
      ข้าพเจ้า <span class="val">${E((p.requester_title + ' ' + p.requester_name).trim())}</span> &nbsp; บริษัท / หน่วยงาน <span class="val">${E(p.requester_company)}</span> &nbsp; เบอร์โทรศัพท์ <span class="val">${E(p.requester_phone)}</span><br>
      ขออนุญาตนำพนักงานเข้าปฏิบัติงานในพื้นที่โครงการ จำนวน <span class="val">${+p.worker_count || 0}</span> คน โดยมีรายชื่อตามเอกสารแนบ<br>
      ชื่อผู้รับผิดชอบงานโครงการ <span class="val">${E(p.owner_name)}</span> &nbsp; เบอร์โทรศัพท์ <span class="val">${E(p.owner_phone || '-')}</span><br>
      รายละเอียดงานที่ปฏิบัติ <span class="val">${E(p.job_detail)}</span><br>
      สถานที่ปฏิบัติงาน <span class="val">${E(p.location)}</span>
    </td></tr>
    <tr><td colspan="3" class="sub">สำหรับผู้รับผิดชอบงาน/ผู้รับผิดชอบพื้นที่/ผู้ตรวจสอบงาน (หมายเหตุ : จป.วิชาชีพเป็นผู้กำหนดความจำเป็นของหัวข้อการตรวจสอบตามหน้างาน)</td></tr>
  </table>

  <table><tr>
    <td style="width:50%;padding:0">${['general', 'hot', 'chemical'].map(k => section(k, false)).join('')}</td>
    <td style="width:50%;padding:0">${section('height', false)}${section('electric', true)}</td>
  </tr></table>

  <table class="small">
    <tr class="sub"><th style="width:4%">#</th><th>รายการที่ทำการตัดระบบ</th><th>เวลาที่ติดตั้ง</th><th>ลงชื่อ</th><th>เวลาที่ปลดล็อค</th><th>ลงชื่อ</th><th>หมายเหตุ</th></tr>
    ${[0, 1, 2, 3, 4, 5].map(i => { const x = loto[i] || {}; return `<tr><td>${i + 1}.</td>${['item', 't_on', 'by_on', 't_off', 'by_off', 'note'].map(f => `<td class="val">${E(x[f] || '')}</td>`).join('')}</tr>`; }).join('')}
  </table>

  <table>
    <tr><td colspan="6" class="small">ข้าพเจ้าได้ตรวจสอบลักษณะงานและอุปกรณ์ป้องกันในบริเวณพื้นที่โครงการ ซึ่งเห็นว่าปลอดภัยตามความเหมาะสมที่จะให้ปฏิบัติงาน และเป็นไปตามเงื่อนไขตามรายการข้างต้นแล้ว จึงอนุญาตให้ปฏิบัติงานได้ในพื้นที่โครงการ และตลอดระยะเวลาปฏิบัติงานต้องปฏิบัติงานถูกต้องตามเงื่อนไขความปลอดภัย และเมื่อหลังเสร็จงาน ตรวจสอบ การจัดเก็บอุปกรณ์เครื่องมือ มีการทำความสะอาดพื้นที่ปฏิบัติงานเรียบร้อย และไม่มีสิ่งที่ก่อให้เกิดอันตรายเกิดขึ้น</td></tr>
    <tr class="sub center"><th style="width:22%"></th><th>การอนุญาตทำงาน<br>(ผู้อนุมัติ)</th><th>การตรวจสอบ<br>ก่อนเริ่มงาน</th><th>การตรวจสอบ<br>ระหว่างทำงาน</th><th>การตรวจสอบ<br>หลังเสร็จงาน</th><th>หมายเหตุ</th></tr>
    ${Object.entries(D.inspectRoles).map(([rk, rl]) => `<tr><td>${E(rl)}</td>
      ${Object.keys(D.inspectStages).map(sk => {
        const c = (ins[rk] || {})[sk];
        return `<td class="center small">${rk === 'safety' && sk === 'permit' ? sigImg(sg.approver) : ''}${c ? `<span class="val">${E(c.name)}</span><br>${td(c.at, true)}` : 'ลงชื่อ ................'}</td>`;
      }).join('')}
      <td class="small val">${E((ins[rk] || {}).note || '')}</td></tr>`).join('')}
  </table>
  ${p.approve_comment ? `<table><tr><td class="small"><b>ความเห็น จป.:</b> <span class="val">${WP.nl2br(p.approve_comment)}</span></td></tr></table>` : ''}

  <table class="small"><tr><td style="width:9%"><b>หมายเหตุ</b></td><td>${ol(D.remarks)}</td></tr></table>
  <div class="small" style="text-align:right;margin-top:4px">${E(D.config.formCode)}</div>
</div>`;

  // ---------------- page 2
  const ws = p.workers || [];
  h += `<div class="page">
  <table>
    <tr><td style="width:50%" class="sub">ระเบียบปฏิบัติเพื่อความปลอดภัย อาชีวอนามัย และสภาพแวดล้อมในการทำงาน</td><td class="sub">ข้อตกลงด้านความปลอดภัย อาชีวอนามัย และสภาพแวดล้อมในการทำงาน</td></tr>
    <tr><td>${ol(D.safetyRules)}</td>
      <td>${ol(D.safetyAgreement)}
        <p style="margin-top:14px">ข้าพเจ้าได้อ่านและเข้าใจข้อความเบื้องต้นแล้ว และยินดีที่จะปฏิบัติตามกฎระเบียบอย่างเคร่งครัด</p>
        <div class="center" style="margin-top:14px">
          ${sigImg(sg.requester)}
          ลงชื่อ ............................................ ผู้ขออนุญาต (ผู้รับเหมา)<br>( <span class="val">${E((p.requester_title + ' ' + p.requester_name).trim())}</span> )
        </div>
        <div class="center" style="margin-top:18px">
          ${sigImg(sg.owner)}
          ลงชื่อ ............................................ ผู้รับผิดชอบงานโครงการ<br>( <span class="val">${E(p.owner_name)}</span> )
        </div>
      </td></tr>
  </table>
  <table style="margin-top:10px">
    <tr><td colspan="4" class="sec">เอกสารแนบ: รายชื่อพนักงานเข้าปฏิบัติงาน (${ws.length} คน) — ${E(p.permit_no)}</td></tr>
    <tr class="sub"><th style="width:6%">#</th><th>ชื่อ - นามสกุล</th><th>ตำแหน่ง / หน้าที่</th><th>เลขบัตรประชาชน / บัตรพนักงาน</th></tr>
    ${(ws.length ? ws : [{}]).map((w, i) => `<tr><td>${ws.length ? i + 1 : ''}</td><td class="val">${E(w.name !== undefined ? w.name : (ws.length ? '' : '— ตามไฟล์แนบ —'))}</td><td class="val">${E(w.role || '')}</td><td class="val">${E(w.idno || '')}</td></tr>`).join('')}
  </table>
</div>`;

  // ---------------- confined space FM-EMR-46 (pages 3–4)
  if (types.includes('confined')) {
    const cw = WT.confined;
    const byId = {}; cw.items.forEach(it => { byId[it.id] = it; });
    const blank = { gas: Array.from({ length: 5 }, () => ({})), entries: Array.from({ length: 6 }, () => ({ name: '', t: Array.from({ length: 5 }, () => ({ in: '', out: '' })) })), renew: Array.from({ length: 3 }, () => ({})), close: {} };
    const cs = (p.confined && p.confined.gas) ? p.confined : blank;
    const tv = k => E(cl[k] || '');
    const grid = (prefix, n, cols) => {
      const half = Math.ceil(n / 2);
      let o = '<table class="small"><tr class="sub"><th></th>';
      [0, 1].forEach(x => { o += x ? '<th></th>' : ''; cols.forEach(c => { o += `<th class="center" style="width:7%">${E(c)}</th>`; }); });
      o += '</tr>';
      for (let rr = 1; rr <= half; rr++) {
        o += '<tr>';
        [rr, rr + half].forEach(k => {
          const it = byId[prefix + k];
          if (!it) { o += '<td></td>' + '<td></td>'.repeat(cols.length); return; }
          const v = cl[it.id];
          let lbl = E(it.label) + (it.other ? ` <u class="fill">${E(cl[it.id + '_t'] || '')}</u>` : '');
          if (it.type === 'checktext') lbl = `${E(it.label)} <u class="fill">${E((v && v.text) || '')}</u>`;
          o += `<td>${lbl}</td>`;
          if (it.type === 'choice') it.opts.forEach(op => { o += `<td class="center">${box(v === op)}</td>`; });
          else o += `<td class="center">${box(it.type === 'checktext' ? !!(v && v.on) : !!v)}</td>`;
        });
        o += '</tr>';
      }
      return o + '</table>';
    };
    const kind = (cl.cs_kind && cl.cs_kind.sel) || [];
    const ow = (ins.owner || {}).permit;
    const em = D.confinedEmergency;
    const chunks = []; for (let i = 0; i < em.length; i += 4) chunks.push(em.slice(i, i + 4));

    h += `<div class="page">
  ${stamp}
  <table class="head">
    <tr><td style="width:30%"><div class="co">${E(p.company)}</div><div class="small">อ้างอิง: <span class="no">${E(p.permit_no)}</span></div></td>
      <td class="title">ใบอนุญาตทำงานในที่อับอากาศ<br>(Confined Space Work Permit)</td>
      <td style="width:22%" class="small center">${E(cw.form)}, Rev : 00</td></tr>
    <tr><td colspan="3" class="small">${E(cw.note)}</td></tr>
    <tr><td colspan="3"><b>ประเภทงาน</b> &nbsp; ${byId.cs_kind.options.map(o => `<span style="margin-right:16px">${box(kind.includes(o))} ${E(o)}</span>`).join('')}</td></tr>
    <tr><td colspan="3">
      1. ผู้ควบคุมงาน ชื่อ <u class="fill">${tv('cs_sup')}</u> &nbsp; บริษัท/แผนก/หน่วย <u class="fill">${tv('cs_sup_co')}</u><br>
      สถานที่ปฏิบัติงาน <span class="val">${E(p.location)}</span> &nbsp; ปฏิบัติงานเกี่ยวกับ <u class="fill">${tv('cs_about') || E(Array.from(p.job_detail || '').slice(0, 80).join(''))}</u><br>
      เวลาปฏิบัติงาน <span class="val">${hm(p.time_from)}</span> ถึง <span class="val">${hm(p.time_to)}</span> น. &nbsp; วันที่ <span class="val">${td(p.work_date)}</span><br>
      2. ผู้ช่วยเหลือ ชื่อ 1. <u class="fill">${tv('cs_help1')}</u> &nbsp; 2. <u class="fill">${tv('cs_help2')}</u><br>
      3. ผู้ปฏิบัติงาน ชื่อ 1. <u class="fill">${tv('cs_work1')}</u> &nbsp; 2. <u class="fill">${tv('cs_work2')}</u>
    </td></tr>
  </table>
  <div class="sec">4. การชี้บ่งอันตรายการทำงานในที่อับอากาศ</div>${grid('cs4_', 12, ['ใช่', 'ไม่ใช่'])}
  <div class="sec">5. มาตรการความปลอดภัยก่อนเข้าปฏิบัติงานในที่อับอากาศ</div>${grid('cs5_', 18, ['ใช่', 'ไม่เกี่ยวข้อง'])}
  <div class="sec">6. อุปกรณ์ป้องกันอันตรายส่วนบุคคล (PPE) และอุปกรณ์เพิ่มเติมอื่นๆ ที่จำเป็นในงานที่อับอากาศ</div>${grid('cs6_', 18, ['จำเป็น'])}
  <div class="sec">7. แผนฉุกเฉิน แผนช่วยเหลือในที่อับอากาศ</div>
  <table class="small"><tr><td>เมื่อเกิดเหตุการณ์ฉุกเฉินในที่อับอากาศ ต้องปฏิบัติ ดังนี้<div class="cols" style="grid-template-columns:1fr 1fr">${chunks.map(ch => `<div style="border:0">${ch.map(l => `<div>${E(l)}</div>`).join('')}</div>`).join('')}</div></td></tr></table>
  <table class="small"><tr><td colspan="2">ได้ตรวจสอบมาตรการและการเตรียมการอื่นๆ เพื่อความปลอดภัยแล้วเห็นควรว่า การปฏิบัติงานในที่อับอากาศดำเนินได้อย่างปลอดภัย</td></tr>
    <tr><td class="center" style="width:50%">${sigImg(sg.approver)}ลงชื่อ ........................................ หน่วยงานความปลอดภัย<br>( <span class="val">${E(p.approver_name || '')}</span> ) ${p.approved_at ? td(p.approved_at, true) : ''}</td>
      <td class="center"><br>ลงชื่อ ........................................ ผู้อนุญาต<br>( <span class="val">${E((ow && ow.name) || '')}</span> )</td></tr></table>
</div>`;

    const gasRows = [['o2', '% O2 โดยปริมาตร'], ['lel', '% LEL'], ['by', 'ชื่อผู้ตรวจ'], ['time', 'เวลา']];
    h += `<div class="page">
  <div class="sec">8. การตรวจวัดบรรยากาศในที่อับอากาศ (ก่อนเข้าปฏิบัติงานและขณะปฏิบัติงาน) โดยผู้ช่วยเหลือ / จป.วิชาชีพ</div>
  <table class="small"><tr class="sub"><th>บันทึกผลการวัดก๊าซ</th>${[1, 2, 3, 4, 5].map(i => `<th class="center">ครั้งที่ ${i}</th>`).join('')}</tr>
    ${gasRows.map(([f, l]) => `<tr><td>${l}</td>${[0, 1, 2, 3, 4].map(i => `<td class="center val">${E((cs.gas[i] || {})[f] || '')}</td>`).join('')}</tr>`).join('')}</table>
  <div class="sec">9. บันทึกเวลาเข้าและออก ของผู้ปฏิบัติงานในที่อับอากาศ</div>
  <table class="small"><tr class="sub"><th>ชื่อ - สกุล</th>${[1, 2, 3, 4, 5].map(() => '<th class="center">เวลาเข้า - เวลาออก</th>').join('')}</tr>
    ${cs.entries.map(e => `<tr><td class="val" style="height:22px">${E(e.name)}</td>${(e.t || []).map(x => `<td class="center val">${E(x.in)}${(x.in || x.out) ? ' - ' : ''}${E(x.out)}</td>`).join('')}</tr>`).join('')}</table>
  <div class="sec">10. การต่อใบอนุญาต (ต้องตรวจสอบก่อนให้ต่อใบอนุญาต)</div>
  <table class="small"><tr class="sub"><th style="width:10%">ครั้งที่</th><th>เริ่มต้น (เวลา)</th><th>สิ้นสุด (เวลา)</th><th>ผู้อนุญาต</th><th style="width:34%">หมายเหตุ</th></tr>
    ${cs.renew.map((x, i) => `<tr><td class="center">${i + 1}</td><td class="center val">${E(x.start || '')}</td><td class="center val">${E(x.end || '')}</td><td class="val">${E(x.by || '')}</td>${i === 0 ? '<td rowspan="3">- การต่อใบอนุญาต ต้องต่อโดยผู้ควบคุมงาน<br>- เมื่อเกิดเหตุฉุกเฉินใบอนุญาตนี้ถูกยกเลิกโดยอัตโนมัติ</td>' : ''}</tr>`).join('')}</table>
  <div class="sec">11. การปิดใบอนุญาต</div>
  <table><tr><td>
    ${Object.entries(D.confinedClose).map(([k, l]) => `<div class="it">${box(!!cs.close[k])} ${E(l)}${k === 'cancel' ? ` <u class="fill">${E(cs.close.reason || '')}</u>` : ''}</div>`).join('')}
    <div class="cols" style="margin-top:14px"><div class="center" style="border:0">ลงชื่อ ........................................ (ผู้ควบคุมงาน)<br>( <span class="val">${tv('cs_sup')}</span> )</div>
      <div class="center">ลงชื่อ ........................................ (ผู้อนุญาต)<br>( <span class="val">${p.status === 'closed' ? E(p.approver_name) : ''}</span> )</div></div>
    <div class="center" style="margin-top:8px">วันที่ <span class="val">${p.closed_at ? td(p.closed_at, true) : '................/................/................ เวลา ................ น.'}</span></div>
  </td></tr></table>
  <div class="small" style="text-align:right;margin-top:4px">${E(cw.form)} · Effective Date : 30 June 2025</div>
</div>`;
  }
  root.innerHTML = h;
})();
