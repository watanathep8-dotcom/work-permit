// admin/dashboard.php
(async () => {
  if (WP.halt) return;
  const { $ } = WP, D = WP.data, E = WP.esc, WT = D.workTypes;
  const root = $('#dash-root');
  const r = await WP.api('dashboard');
  if (!r.ok) { root.innerHTML = `<div class="alert err"><i class="fa-solid fa-triangle-exclamation"></i><div>${E(r.msg)}</div></div>`; return; }
  const d = r.data, cnt = d.cnt;
  const B = WP.base;
  const tiles = [
    ['pending', 'รออนุมัติ', 'fa-hourglass-half', 'ic-spin', '#fbbf24'],
    ['approved', 'กำลังปฏิบัติงาน', 'fa-person-digging', 'ic-bob', '#34d399'],
    ['closed', 'ปิดงานแล้ว', 'fa-flag-checkered', 'ic-swing', '#60a5fa'],
    ['rejected', 'ไม่อนุมัติ', 'fa-ban', 'ic-beat', '#f87171'],
    ['expired', 'หมดอายุ', 'fa-clock-rotate-left', 'ic-wiggle', '#94a3b8']
  ];
  root.innerHTML = `
<div class="card hero-strip glow-border always reveal">
  <div class="hs-ic"><i class="fa-solid fa-user-shield ic-beat"></i></div>
  <div><h2>สวัสดี, ${E(d.user.fullname)}</h2><div class="meta"><span><i class="fa-solid fa-shield-heart"></i> Safety First — วันนี้มีใบขออนุญาตรออนุมัติ <b style="color:var(--gold)">${cnt.pending}</b> รายการ</span></div></div>
  <div class="actions"><a href="permits.html?status=pending" class="btn gold"><i class="fa-solid fa-gavel"></i> พิจารณาคำขอ</a></div>
</div>

<div class="stats">
  ${tiles.map(([k, lbl, ic, anim, c]) => `
    <a href="permits.html?status=${k}" class="card stat glow-border hover-lift reveal" style="--sc:${c}">
      <div class="s-ic"><i class="fa-solid ${ic} ${anim}"></i></div>
      <div><b data-n="${cnt[k] || 0}">0</b><span>${lbl}</span></div>
      <i class="fa-solid ${ic} s-bg"></i>
    </a>`).join('')}
</div>

<div class="dash-grid mb2">
  <div class="card reveal">
    <div class="card-h"><span class="ch-ic"><i class="fa-solid fa-chart-column ic-bob"></i></span><h3>ใบขออนุญาต 14 วันล่าสุด</h3></div>
    <div class="card-b"><div class="chart-box"><canvas id="c-days"></canvas></div></div>
  </div>
  <div class="card reveal">
    <div class="card-h"><span class="ch-ic"><i class="fa-solid fa-chart-pie ic-spin"></i></span><h3>แยกตามลักษณะงาน</h3></div>
    <div class="card-b"><div class="chart-box"><canvas id="c-types"></canvas></div></div>
  </div>
</div>

<div class="dash-grid">
  <div class="card reveal">
    <div class="card-h"><span class="ch-ic" style="color:var(--gold)"><i class="fa-solid fa-bell ic-ring"></i></span><h3>รออนุมัติ</h3><span class="spacer"></span><a href="permits.html?status=pending" class="btn sm ghost">ดูทั้งหมด <i class="fa-solid fa-arrow-right"></i></a></div>
    <div class="card-b" style="padding:0">
      ${!d.pending.length ? '<div class="empty"><i class="fa-solid fa-mug-hot"></i>ไม่มีคำขอค้างพิจารณา</div>' : `
      <div class="tbl-wrap" style="border:0;border-radius:0"><table class="tbl"><thead><tr><th>เลขที่</th><th>ผู้ขอ</th><th>ลักษณะงาน</th><th>วันที่ทำงาน</th><th></th></tr></thead><tbody>
      ${d.pending.map(p => `
        <tr><td class="p-no">${E(p.permit_no)}</td><td>${E(p.requester_name)}<br><small class="muted">${E(p.requester_company)}</small></td><td>${WP.wtTags(p.work_types)}</td>
          <td class="nowrap">${WP.thaiDate(p.work_date)}<br><small class="muted">${WP.hm(p.time_from)}–${WP.hm(p.time_to)}</small></td>
          <td><a class="btn sm" href="view.html?id=${p.id}"><i class="fa-solid fa-magnifying-glass"></i> ตรวจ</a></td></tr>`).join('')}
      </tbody></table></div>`}
    </div>
  </div>
  <div class="card reveal">
    <div class="card-h"><span class="ch-ic"><i class="fa-solid fa-person-digging ic-bob"></i></span><h3>กำลังปฏิบัติงานขณะนี้</h3></div>
    <div class="card-b">
      ${!d.activeNow.length ? '<div class="empty" style="padding:30px"><i class="fa-solid fa-helmet-safety"></i>ไม่มีงานที่กำลังดำเนินการ</div>' : ''}
      ${d.activeNow.map(p => `
        <a href="view.html?id=${p.id}" class="flex between" style="padding:10px 0;border-bottom:1px solid var(--line);color:inherit">
          <div><b class="p-no">${E(p.permit_no)}</b><br><small class="muted"><i class="fa-solid fa-location-dot"></i> ${E(p.location)}</small></div>
          <div style="text-align:right">${WP.wtTags(p.work_types)}<br><small class="text2"><i class="fa-regular fa-clock"></i> สิ้นสุด <span data-until="${p.end_ts}"></span></small></div>
        </a>`).join('')}
    </div>
  </div>
</div>`;
  WP.reveal(root);
  root.querySelectorAll('[data-n]').forEach(el => WP.countUp(el, +el.dataset.n));

  if (window.Chart) {
    Chart.defaults.color = '#a7d8bd'; Chart.defaults.font.family = 'Kanit'; Chart.defaults.borderColor = 'rgba(52,211,153,.12)';
    const ctx = document.getElementById('c-days').getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 280); g.addColorStop(0, 'rgba(163,230,53,.9)'); g.addColorStop(1, 'rgba(16,185,129,.15)');
    new Chart(ctx, { type: 'bar', data: { labels: d.days.map(x => new Date(x.date + 'T12:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })),
      datasets: [{ label: 'จำนวนคำขอ', data: d.days.map(x => x.count), backgroundColor: g, borderRadius: 8, borderSkipped: false, maxBarThickness: 34 }] },
      options: { maintainAspectRatio: false, animation: { duration: 1600, easing: 'easeOutElastic', delay: c => c.dataIndex * 60 },
        plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } } });
    const keys = Object.keys(WT);
    new Chart(document.getElementById('c-types'), { type: 'doughnut', data: { labels: keys.map(k => WT[k].short),
      datasets: [{ data: keys.map(k => d.byType[k] || 0), backgroundColor: keys.map(k => WT[k].color), borderColor: '#04170e', borderWidth: 3, hoverOffset: 14 }] },
      options: { maintainAspectRatio: false, cutout: '64%', animation: { animateRotate: true, duration: 1800 }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 14 } } } } });
  }

  const fmt = s => { if (s <= 0) return 'หมดเวลา'; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ' ชม. ' : '') + m + ' นาที'; };
  const tick = () => document.querySelectorAll('[data-until]').forEach(e => e.textContent = 'ในอีก ' + fmt(+e.dataset.until - Date.now() / 1000));
  tick(); setInterval(tick, 30000);
  document.addEventListener('wp:new', () => setTimeout(() => location.reload(), 4000));
})();
