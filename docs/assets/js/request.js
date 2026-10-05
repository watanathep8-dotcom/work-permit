// request.php wizard — ported; submits JSON (+ base64 attachment) to Google Apps Script
(() => {
  const { $, $$ } = WP;
  const CFG = WP.data.config;
  const form = $('#wp-form');
  let step = 0, pads = {}, lastTypes = '';
  const panels = $$('.wz-panel'), stepEls = $$('.step');

  // ---------- Draft autosave (per-browser convenience) ----------
  const DKEY = 'wp_draft_v1';
  const saveDraft = () => {
    try {
      const d = {};
      ['requester_name', 'requester_company', 'requester_phone', 'owner_name', 'owner_phone', 'location', 'job_detail'].forEach(n => d[n] = form[n].value);
      localStorage.setItem(DKEY, JSON.stringify(d));
    } catch { }
  };
  try {
    const d = JSON.parse(localStorage.getItem(DKEY) || 'null');
    if (d) Object.entries(d).forEach(([k, v]) => { if (form[k] && !form[k].value) form[k].value = v; });
  } catch { }
  form.addEventListener('input', saveDraft);

  // ---------- Workers ----------
  const wb = $('#workers tbody');
  const renumber = () => {
    $$('tr', wb).forEach((tr, i) => tr.firstElementChild.textContent = i + 1);
    const n = $$('tr', wb).filter(tr => $('input', tr).value.trim()).length;
    $('#worker-count').textContent = n;
  };
  const addWorker = (focus = true) => {
    const tr = document.createElement('tr'); tr.className = 'row-in';
    tr.innerHTML = `<td></td><td><input class="input" data-w="name" placeholder="ชื่อ - นามสกุล"></td><td><input class="input" data-w="role" placeholder="เช่น ช่างเชื่อม / หัวหน้างาน"></td><td><input class="input" data-w="idno" placeholder="(ถ้ามี)"></td>
      <td><button type="button" class="btn-icon" title="ลบ"><i class="fa-solid fa-trash-can"></i></button></td>`;
    $('button', tr).onclick = () => { tr.style.opacity = 0; tr.style.transform = 'translateX(30px)'; tr.style.transition = '.3s'; setTimeout(() => { tr.remove(); renumber(); }, 300); };
    $('input', tr).addEventListener('input', renumber);
    wb.appendChild(tr); renumber();
    if (focus) $('input', tr).focus();
  };
  $('#add-worker').onclick = () => addWorker();
  addWorker(false); addWorker(false);

  // ---------- Signatures ----------
  $('#sig-area').innerHTML = WP.sigHTML('sig-req', 'ลงชื่อ ผู้ขออนุญาต (ผู้รับเหมา) <span class="req">*</span>') + WP.sigHTML('sig-own', 'ลงชื่อ ผู้รับผิดชอบงานโครงการ (ถ้าลงนามได้ทันที)');

  // ---------- File ----------
  const fileIn = $('#attach'), drop = $('#drop');
  const showFile = () => { const f = fileIn.files[0]; $('#fname').innerHTML = f ? `<i class="fa-solid fa-file-circle-check" style="display:inline;font-size:16px;animation:none"></i> ${WP.esc(f.name)} (${(f.size / 1048576).toFixed(2)} MB)` : ''; };
  fileIn.addEventListener('change', showFile);
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) { fileIn.files = e.dataTransfer.files; showFile(); } });

  // ---------- Steps ----------
  const types = () => $$('input[name=work_types]:checked').map(c => c.value);
  const buildChecklist = () => {
    const t = types(), key = t.join(',');
    if (key === lastTypes) return;
    const prev = lastTypes ? WP.collectChecklist($('#checklist')) : {};
    lastTypes = key;
    WP.renderChecklist($('#checklist'), WP.defs, t, prev);
    const hasLoto = t.includes('electric');
    $('#loto-card').classList.toggle('hide', !hasLoto);
    if (hasLoto && !$('#loto table')) WP.renderLoto($('#loto'));
    const hasCs = t.includes('confined');
    $('#cs-card').classList.toggle('hide', !hasCs);
    if (hasCs && !$('#cs-box table')) {
      const names = $$('#workers input[data-w=name]').map(i => i.value.trim()).filter(Boolean);
      WP.renderConfined($('#cs-box'), { entries: names.map(name => ({ name })) }, false, false);
    }
  };

  const validate = s => {
    const p = panels[s];
    let ok = true, first = null;
    $$('[required]', p).forEach(i => {
      const bad = !i.value.trim();
      i.classList.toggle('invalid', bad);
      if (bad) { ok = false; first = first || i; }
    });
    if (s === 0 && !types().length) {
      Swal.fire({ icon: 'warning', title: 'กรุณาเลือกลักษณะงาน', text: 'เลือกอย่างน้อย 1 ลักษณะงาน' });
      return false;
    }
    if (s === 0) {
      const tf = form.time_from.value, tt = form.time_to.value;
      if (tf && tt && tf === tt) { form.time_to.classList.add('invalid'); Swal.fire({ icon: 'warning', title: 'เวลาไม่ถูกต้อง', text: 'เวลาเริ่มและสิ้นสุดต้องไม่เท่ากัน' }); return false; }
    }
    if (s === 1 && form.requester_phone.value && !/^[0-9+\-\s()]{6,20}$/.test(form.requester_phone.value)) {
      form.requester_phone.classList.add('invalid'); first = form.requester_phone; ok = false;
    }
    if (!ok) { first?.focus(); first?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return ok;
  };

  const setBar = () => {
    const first = stepEls[0].getBoundingClientRect(), cur = stepEls[step].getBoundingClientRect();
    $('#steps-bar').style.width = (cur.left - first.left) + 'px';
  };
  const go = n => {
    step = Math.max(0, Math.min(3, n));
    panels.forEach((p, i) => p.classList.toggle('active', i === step));
    stepEls.forEach((e, i) => { e.classList.toggle('active', i === step); e.classList.toggle('done', i < step); e.querySelector('.s-ic i').className = i < step ? 'fa-solid fa-check' : e.dataset.ic; });
    setBar();
    $('#prev').style.visibility = step ? 'visible' : 'hidden';
    $('#next').classList.toggle('hide', step === 3);
    $('#submit').classList.toggle('hide', step !== 3);
    if (step === 2) buildChecklist();
    if (step === 3) {
      ['sig-req', 'sig-own'].forEach(id => { if (!pads[id]) pads[id] = new WP.SignaturePad($('#' + id)); });
    }
    scrollTo({ top: 0, behavior: 'smooth' });
  };
  stepEls.forEach(e => e.dataset.ic = e.querySelector('.s-ic i').className);
  stepEls.forEach((e, i) => e.addEventListener('click', () => {
    if (i <= step) return go(i);
    for (let s = step; s < i; s++) if (!validate(s)) return go(s);
    go(i);
  }));
  $('#next').onclick = () => { if (validate(step)) go(step + 1); };
  $('#prev').onclick = () => go(step - 1);
  form.addEventListener('input', e => e.target.classList.remove('invalid'));
  addEventListener('resize', setBar);

  // ---------- Submit ----------
  $('#submit').onclick = async () => {
    for (let s = 0; s < 3; s++) if (!validate(s)) return go(s);
    if (!$('#agree').checked) {
      $('#agree').closest('.card').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' }, { transform: 'translateX(0)' }], { duration: 350 });
      return Swal.fire({ icon: 'warning', title: 'กรุณายอมรับระเบียบความปลอดภัย' });
    }
    if (pads['sig-req'].empty) return Swal.fire({ icon: 'warning', title: 'กรุณาลงลายมือชื่อผู้ขออนุญาต' });
    const f = fileIn.files[0];
    if (f && f.size > CFG.uploadMaxMb * 1048576) return Swal.fire({ icon: 'error', title: `ไฟล์ใหญ่เกิน ${CFG.uploadMaxMb}MB` });
    if (f && !CFG.uploadExt.includes(f.name.split('.').pop().toLowerCase())) return Swal.fire({ icon: 'error', title: 'ชนิดไฟล์ไม่รองรับ', text: 'PDF/JPG/PNG/XLS/DOC เท่านั้น' });

    const data = {
      company: form.company.value, permit_type: form.permit_type.value, work_types: types(),
      work_date: form.work_date.value, time_from: form.time_from.value, time_to: form.time_to.value,
      requester_title: form.requester_title.value, requester_name: form.requester_name.value.trim(),
      requester_company: form.requester_company.value.trim(), requester_phone: form.requester_phone.value.trim(),
      owner_name: form.owner_name.value.trim(), owner_phone: form.owner_phone.value.trim(),
      location: form.location.value.trim(), job_detail: form.job_detail.value.trim(),
      workers: $$('tr', wb).map(tr => { const o = {}; $$('input', tr).forEach(i => o[i.dataset.w] = i.value.trim()); return o; }).filter(w => w.name),
      checklist: WP.collectChecklist($('#checklist')),
      loto: types().includes('electric') && $('#loto table') ? WP.collectLoto($('#loto')) : [],
      confined: types().includes('confined') && $('#cs-box table') ? WP.collectConfined($('#cs-box')) : null,
      requester_sign: pads['sig-req'].toData(), owner_sign: pads['sig-own'].empty ? '' : pads['sig-own'].toData(),
    };
    const ok = await Swal.fire({
      icon: 'question', title: 'ยืนยันส่งใบขออนุญาต?',
      html: `ส่งไปยัง <b>เจ้าหน้าที่ความปลอดภัย (จป.)</b> เพื่อพิจารณาอนุมัติ<br><small>${WP.esc(data.location)} · ${data.work_date} ${data.time_from}-${data.time_to}</small>`,
      showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-paper-plane"></i> ยืนยันส่ง', cancelButtonText: 'ตรวจสอบอีกครั้ง'
    });
    if (!ok.isConfirmed) return;
    Swal.fire({ title: 'กำลังส่งข้อมูล...', html: '<i class="fa-solid fa-paper-plane fa-2x ic-float" style="color:var(--lime)"></i>', showConfirmButton: false, allowOutsideClick: false });
    if (f) {
      try {
        const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f); });
        data.attachment = { name: f.name, mimeType: f.type || '', base64: String(url).slice(String(url).indexOf(',') + 1) };
      } catch { return Swal.fire({ icon: 'error', title: 'อ่านไฟล์แนบไม่สำเร็จ' }); }
    }
    const r = await WP.api('submit', data);
    if (!r.ok) return Swal.fire({ icon: 'error', title: 'ส่งไม่สำเร็จ', text: r.msg });
    try { localStorage.removeItem(DKEY); } catch { }
    location.href = `${WP.base}/status.html?no=${encodeURIComponent(r.data.permit_no)}&t=${r.data.token}&new=1`;
  };
})();
