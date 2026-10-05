// track.php — permit no + phone → tracking token → status page.
// The QR / tracking link (track.html?no=..&t=..) forwards straight to the status page.
(() => {
  const no = WP.qs('no'), t = WP.qs('t');
  if (no && t) {
    location.replace(`${WP.base}/status.html?no=${encodeURIComponent(no)}&t=${encodeURIComponent(t)}`);
    return;
  }
  const { $ } = WP;
  if (WP.qs('nf')) $('#nf').classList.remove('hide');
  $('#tf [name=permit_no]').placeholder = 'WP-' + WP.todayBkk().replace(/-/g, '') + '-001';
  $('#tf').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = $('button', f);
    btn.disabled = true;
    const r = await WP.api('track', { permit_no: f.permit_no.value, phone: f.phone.value, with_permit: true });
    btn.disabled = false;
    if (!r.ok) return Swal.fire({ icon: 'error', title: 'ไม่พบข้อมูล', text: r.msg });
    WP.handoff(r.data.permit_no, r.data.token, r.data.view); // status page paints it without another round-trip
    location.href = `${WP.base}/status.html?no=${encodeURIComponent(r.data.permit_no)}&t=${r.data.token}`;
  });
})();
