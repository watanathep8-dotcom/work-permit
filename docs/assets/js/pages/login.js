// login.php — returns a session token (kept server-side in CacheService for 6 h)
(() => {
  const { $ } = WP;
  if (WP.session) { location.replace(WP.base + '/admin/dashboard.html'); return; }
  const showErr = msg => { $('#err-msg').textContent = msg; $('#err').classList.remove('hide'); };
  if (WP.qs('expired')) showErr('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = $('button', f);
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบ...';
    const r = await WP.api('login', { username: f.username.value.trim(), password: f.password.value });
    btn.disabled = false; btn.innerHTML = old;
    if (!r.ok) { f.password.value = ''; return showErr(r.msg); }
    WP.saveSession(r.data.session, r.data.user, r.data.expires_in);
    location.href = WP.base + '/admin/dashboard.html';
  });
})();
