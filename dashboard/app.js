// Token Radar v2 dashboard — renders window.TOKEN_RADAR_DATA, no network.
(function () {
  var D = window.TOKEN_RADAR_DATA;
  var rows = D.rows, meta = D.meta, method = D.method;
  var $ = function (id) { return document.getElementById(id); };

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // KPI strip
  var farmN = rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
  $('kpis').innerHTML = [
    [rows.length, 'protocols ranked'],
    [meta.watchlist_covered + '/' + meta.watchlist_total, 'watchlist covered'],
    [method.live_comps, 'live-token comps fitted'],
    [method.held_out.curve[0].toFixed(2) + ' / ' + method.held_out.curve[1].toFixed(2), 'held-out log-err (2 ways)'],
    [farmN, 'verdicts: FARM'],
    [meta.snapshot_as_of, 'snapshot date'],
  ].map(function (k) { return '<div class="kpi"><div class="v">' + k[0] + '</div><div class="l">' + k[1] + '</div></div>'; }).join('');

  $('methodLine').textContent =
    'implied value = TVL x fitted multiple x P(launch) x growth x maturity  —  ' +
    'multiple = size curve x category factor, fitted on ' + method.live_comps +
    ' traded tokens and tested held-out twice (median log-error ' +
    method.held_out.curve[0].toFixed(2) + ' / ' + method.held_out.curve[1].toFixed(2) +
    ' vs flat multiple ' + method.held_out.flat[0].toFixed(2) + ' / ' + method.held_out.flat[1].toFixed(2) + ').';
  $('snapDate').textContent = meta.snapshot_as_of;

  // filters
  var cats = [...new Set(rows.map(function (r) { return r.category || '(none)'; }))].sort();
  var chains = [...new Set(rows.flatMap(function (r) { return r.chains; }))].sort();
  cats.forEach(function (c) { $('fCat').add(new Option(c, c)); });
  chains.forEach(function (c) { $('fChain').add(new Option(c, c)); });

  var sortKey = 'rank', sortDir = 1;
  function applyHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get('detail')) return showDetail(h.get('detail'));
    if (h.get('category')) $('fCat').value = h.get('category');
    if (h.get('verdict')) $('fVerdict').value = h.get('verdict');
    render();
  }
  function filtered() {
    var q = $('q').value.toLowerCase(), cat = $('fCat').value, ch = $('fChain').value,
      vd = $('fVerdict').value, wl = $('fWatch').checked;
    return rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      if (cat && (r.category || '(none)') !== cat) return false;
      if (ch && r.chains.indexOf(ch) < 0) return false;
      if (vd && r.verdict !== vd) return false;
      if (wl && !r.watchlist) return false;
      return true;
    });
  }
  function render() {
    var list = filtered().slice();
    list.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (typeof x === 'string') return sortDir * x.localeCompare(y);
      return sortDir * (x - y);
    });
    $('rowCount').textContent = list.length + ' of ' + rows.length + ' rows';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><a href="#detail=' + esc(r.slug) + '">' + esc(r.name) + '</a>' +
        (r.watchlist ? ' <span class="wl">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(3) + '</td>' +
        '<td class="num">' + pct(r.p_launch) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.rank_low + '–' + r.rank_high + '</td>' +
        '<td><span class="pill ' + r.verdict + '">' + r.verdict + '</span></td>' +
        '<td class="num">$' + r.farm_cost_usd + '</td></tr>';
    }).join('');
  }

  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      render();
    });
  });
  ['q', 'fCat', 'fChain', 'fVerdict', 'fWatch'].forEach(function (id) {
    $(id).addEventListener('input', render);
  });

  function showDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; });
    var box = $('detail');
    if (!r) { box.hidden = true; render(); return; }
    var f = [
      ['TVL', money(r.tvl_usd), 'snapshot figure'],
      ['Multiple', r.multiple.toFixed(3), 'fitted curve x category factor'],
      ['P(launch)', pct(r.p_launch), 'peers in category x no-token age x growth'],
      ['Growth', 'x' + r.growth.toFixed(2), '7-day TVL change, clamped'],
      ['Maturity', 'x' + r.maturity.toFixed(2), 'time listed with no token'],
      ['Implied value', money(r.implied_value_usd), 'TVL x multiple x P x growth x maturity'],
      ['Rank', '#' + r.rank, 'range ' + r.rank_low + '–' + r.rank_high + ' over 200 refits'],
      ['Farm verdict', r.verdict, 'net = P x implied x 0.1% - farm cost'],
    ];
    box.innerHTML = '<h2>' + esc(r.name) + ' <span class="small">#' + r.rank + ' · ' +
      esc(r.category || '—') + ' · ' + esc(r.chains.join(', ')) + '</span></h2>' +
      '<div class="factors">' + f.map(function (x) {
        return '<div class="factor"><div class="v">' + x[1] + '</div><div class="l">' + x[0] + '</div><div class="d">' + x[2] + '</div></div>';
      }).join('') + '</div>' +
      '<h3>Farm plan — 6 steps, costed</h3><ol class="steps">' +
      r.farm_steps.map(function (s) {
        return '<li>' + esc(s.text) + '<span class="c">$' + s.cost_usd + ' · ' + s.minutes + ' min</span></li>';
      }).join('') + '</ol>' +
      '<div class="totals">Total: <b>$' + r.farm_cost_usd + '</b> · <b>' + r.farm_time_min +
      ' min</b> · Verdict: <b>' + r.verdict + '</b> &nbsp; <a href="#">← back to board</a></div>';
    box.hidden = false;
    render();
    // Scroll after the table has rendered, so the offset is measured
    // against the final layout (rendering 200 rows changes page height).
    requestAnimationFrame(function () { box.scrollIntoView(); });
  }

  window.addEventListener('hashchange', applyHash);

  // method section
  var h = method.held_out;
  $('methodBody').innerHTML =
    '<table><thead><tr><th>Predictor</th><th>Held-out A→B</th><th>Held-out B→A</th><th>Kept?</th></tr></thead><tbody>' +
    '<tr><td>Flat global median multiple</td><td class="num">' + h.flat[0].toFixed(3) + '</td><td class="num">' + h.flat[1].toFixed(3) + '</td><td>No — baseline</td></tr>' +
    '<tr><td>Flat category median (shrunk)</td><td class="num">' + h.cat_median[0].toFixed(3) + '</td><td class="num">' + h.cat_median[1].toFixed(3) + '</td><td>No — beaten by curve</td></tr>' +
    '<tr><td><b>Size curve x category factor (this board)</b></td><td class="num"><b>' + h.curve[0].toFixed(3) + '</b></td><td class="num"><b>' + h.curve[1].toFixed(3) + '</b></td><td><b>Yes — lowest error both ways</b></td></tr>' +
    '</tbody></table>' +
    '<p class="small">Median absolute log-error of predicting a held-out traded token\u2019s market-cap/TVL. ' +
    'Split-half by slug, fitted on one half and tested on the other, then swapped — tested held-out twice. ' +
    'Curve: log(multiple) = ' + method.curve_a.toFixed(3) + ' ' + (method.curve_b < 0 ? '− ' : '+ ') + Math.abs(method.curve_b).toFixed(3) +
    ' x log(TVL), log-multiples winsorized to [' + method.winsor_low.toFixed(2) + ', ' + method.winsor_high.toFixed(2) +
    '], category factor shrunk (k=3) and clamped to [0.3, 3], multiple clamped to [0.02, 5]. ' +
    'P(launch): category token rate shrunk to the global rate ' + (method.global_token_rate * 100).toFixed(1) +
    '% (k=5), x exp(−0.08 x years with no token), x growth adjustment. ' +
    'Sanity check: live-token protocols scored as-if-pre average P = ' + (method.mean_p_live * 100).toFixed(1) +
    '% vs pre-token ' + (method.mean_p_pre * 100).toFixed(1) + '%. ' +
    'Rank ranges come from 200 bootstrap refits of the 128 comps (seed 20261114). ' +
    'Farm verdicts assume a farmer captures 0.1% of launch value; gas is $18/step on Ethereum, $3 elsewhere.</p>';

  // anchors
  var anc = D.anchors.slice(0, 25);
  $('anchorBody').innerHTML = '<p class="small">' + D.anchors.length +
    ' traded-token protocols anchor the fit. Top 25 by market cap. ' +
    meta.token_unusable_mcap + ' more record a token but carry no usable market cap in the snapshot ' +
    '(mcap 0 or negative) and are not used as comps; ' + meta.token_no_mcap +
    ' more record a token with no market cap at all.</p><table><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>mcap / TVL</th></tr></thead><tbody>' +
    anc.map(function (a) {
      return '<tr><td>' + esc(a.name) + '</td><td>' + esc(a.category || '—') + '</td><td class="num">' + money(a.tvl_usd) + '</td><td class="num">' + money(a.mcap_usd) + '</td><td class="num">' + a.multiple.toFixed(3) + '</td></tr>';
    }).join('') + '</tbody></table>';

  // excluded
  var reasons = {};
  D.excluded.forEach(function (e) { reasons[e.reason] = (reasons[e.reason] || 0) + 1; });
  $('excludedBody').innerHTML = '<p class="small">' + D.excluded.length +
    ' protocols record no token but are not launch candidates — ' +
    Object.keys(reasons).map(function (k) { return reasons[k] + ' x ' + k; }).join(', ') +
    '. They are listed, not ranked:</p>' +
    D.excluded.slice(0, 60).map(function (e) { return '<span class="tag">' + esc(e.name) + ' · ' + esc(e.reason) + '</span>'; }).join('') +
    (D.excluded.length > 60 ? ' <span class="small">+ ' + (D.excluded.length - 60) + ' more in the data file</span>' : '');

  applyHash();
})();
