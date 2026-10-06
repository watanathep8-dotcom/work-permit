// admin/users.php — user accounts (จป. only): add / edit / roles / e-mail / reset password / enable-disable
(async () => {
  if (WP.halt) return;
  const { $, $$ } = WP, E = WP.esc, ROLES = WP.data.roles || {};
  const roleBadges = rs => (rs || []).map(k => `<span class="badge role">${E(ROLES[k] || k)}</span>`).join('');
  // Painted at once from this tab's last copy (if any), then again only if the server's answer differs.
  const render = r => {
  if (!r.ok) { $('#users-body').innerHTML = `<tr><td colspan="7"><div class="alert err"><i class="fa-solid fa-triangle-exclamation"></i><div>${E(r.msg)}</div></div></td></tr>`; return; }
  const { users, me, initial_password_warning } = r.data;
  $('#pw-warn').classList.toggle('hide', !initial_password_warning);
  $('#users-body').innerHTML = users.map(x => `
    <tr><td class="p-no">${E(x.username)}</td><td>${E(x.fullname)}</td><td>${E(x.position)}</td>
      <td>${roleBadges(x.roles)}</td>
      <td>${x.email ? `<small>${E(x.email)}</small>` : '<small class="muted">— (ไม่มี: แจ้งเตือนแบบไม่ @mention)</small>'}</td>
      <td>${x.active ? '<span class="badge st-approved"><i class="fa-solid fa-circle-check"></i> ใช้งาน</span>' : '<span class="badge st-expired"><i class="fa-solid fa-ban"></i> ปิดใช้งาน</span>'}</td>
      <td class="nowrap"><button class="btn sm ghost edit" data-id="${x.id}"><i class="fa-solid fa-pen"></i> แก้ไข</button>
        ${x.id !== me ? `<button class="btn-icon toggle" data-id="${x.id}" title="เปิด/ปิดการใช้งาน"><i class="fa-solid fa-power-off"></i></button>` : ''}</td></tr>`).join('');

  const form = (x = {}) => {
    const cur = x.id ? (x.roles || []) : ['safety'];
    return Swal.fire({
    title: x.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้',
    html: `<input id="f-user" class="swal2-input" placeholder="ชื่อผู้ใช้ (a-z, 0-9)" value="${E(x.username || '')}" ${x.id ? 'disabled' : ''}>
      <input id="f-name" class="swal2-input" placeholder="ชื่อ - นามสกุล (ชื่อที่แสดงใน Teams)" value="${E(x.fullname || '')}">
      <input id="f-pos" class="swal2-input" placeholder="ตำแหน่ง" value="${E(x.id ? x.position || '' : WP.data.config.defaultPosition)}">
      <input id="f-email" type="email" class="swal2-input" autocomplete="off" placeholder="อีเมลบริษัท / Teams (สำหรับ @mention)" value="${E(x.email || '')}">
      <div class="role-chips" id="f-roles">${Object.entries(ROLES).map(([k, l]) => `<label><input type="checkbox" value="${k}" ${cur.includes(k) ? 'checked' : ''}> ${E(l)}</label>`).join('')}</div>
      <input id="f-pass" type="password" class="swal2-input" autocomplete="new-password" placeholder="${x.id ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน (≥ 6 ตัว)'}">`,
    showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
    preConfirm: async () => {
      const roles = $$('#f-roles input:checked').map(i => i.value);
      if (!roles.length) { Swal.showValidationMessage('กรุณาเลือกบทบาทอย่างน้อย 1 บทบาท'); return false; }
      const res = await WP.api('user_save', { id: x.id || 0, username: $('#f-user').value, fullname: $('#f-name').value, position: $('#f-pos').value, email: $('#f-email').value, roles, password: $('#f-pass').value });
      if (!res.ok) { Swal.showValidationMessage(res.msg); return false; }
      if (res.data.session) WP.saveSession(res.data.session, res.data.user); // own password changed → fresh session
      else if (res.data.user) WP.updateSessionUser(res.data.user);
      return true;
    }
  }).then(res => { if (res.isConfirmed) location.reload(); });
  };
  $('#add').onclick = () => form();
  $$('.edit').forEach(b => b.onclick = () => form(users.find(u => u.id === +b.dataset.id)));
  $$('.toggle').forEach(b => b.onclick = async () => { const res = await WP.api('user_toggle', { id: +b.dataset.id }); res.ok ? location.reload() : Swal.fire({ icon: 'error', title: res.msg }); });
  };
  await WP.swr('users', {}, render);
})();
