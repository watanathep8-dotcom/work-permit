// request.php — server-rendered lists now rendered from WP_DATA (runs before request.js)
(() => {
  const { $ } = WP, D = WP.data, E = WP.esc;
  $('#company-seg').innerHTML = D.companies.map((c, i) =>
    `<label><input type="radio" name="company" value="${E(c)}" ${i === 0 ? 'checked' : ''}><span><i class="fa-solid fa-building-flag"></i>${E(c)}</span></label>`).join('');
  $('#wt-grid').innerHTML = Object.entries(D.workTypes).map(([k, w]) => `
          <label class="wt" style="--wc:${w.color}">
            <input type="checkbox" name="work_types" value="${k}">
            <div class="wt-box">
              <span class="wt-check"><i class="fa-solid fa-check"></i></span>
              <span class="wt-ic"><i class="fa-solid ${w.icon}"></i></span>
              <span class="wt-name">${E(w.label)}</span>
            </div>
          </label>`).join('');
  const today = WP.todayBkk();
  const wd = $('input[name=work_date]');
  wd.value = today; wd.min = today;
  const li = arr => arr.map(r => `<li>${E(r)}</li>`).join('');
  $('#rules').innerHTML = li(D.safetyRules);
  $('#agreement').innerHTML = li(D.safetyAgreement);
  $('#remarks').innerHTML = li(D.remarks);
  $('#max-mb').textContent = D.config.uploadMaxMb;
  $('#attach').accept = D.config.uploadExt.map(x => '.' + x).join(',');
})();
