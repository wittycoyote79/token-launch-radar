/* Token Launch Radar: the board, the detail view, the filters, the live set and
 * the method. No framework, no network: it reads window.RADAR, the dataset
 * main.ts wrote beside the page, and renders from that alone. */
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) {
    document.getElementById('board-wrap').innerHTML =
      '<p class="empty">No radar data found. Run main.ts to write data.js beside this page.</p>';
    return;
  }

  var state = {
    view: 'board',
    q: '',
    category: '',
    chain: '',
    minTvl: 0,
    watchlistOnly: false,
    sortKey: 'implied_value_usd',
    sortDir: -1,
    selected: null,
  };

  /* ------------------------------------------------------------ formatting */

  /** Escape a data string for HTML. */
  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Trim trailing zeros off a fixed-decimal number. */
  function trimFixed(value, decimals) {
    var s = value.toFixed(decimals);
    return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  }

  /** Compact dollars: $1.24B, $340.2M, $12.5K, $950. */
  function formatUsd(value) {
    if (value >= 1e9) return '$' + trimFixed(value / 1e9, 2) + 'B';
    if (value >= 1e6) return '$' + trimFixed(value / 1e6, 1) + 'M';
    if (value >= 1e3) return '$' + trimFixed(value / 1e3, 1) + 'K';
    return '$' + Math.round(value);
  }

  /** Full dollars with thousands separators. */
  function formatUsdFull(value) {
    return '$' + Math.round(value).toLocaleString('en-US');
  }

  /** A signed percent, or an em dash when unreported. */
  function formatPct(value) {
    if (value === null || value === undefined) return '—';
    return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
  }

  /** An age in days as years or days, or unknown when unreported. */
  function formatAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return trimFixed(days / 365, 1) + 'y';
    return days + 'd';
  }

  /** A class for a 7-day change: up, down, or flat when unreported. */
  function changeClass(value) {
    if (value === null || value === undefined || value === 0) return 'flat';
    return value > 0 ? 'up' : 'down';
  }

  /** Chains as a short list: the first three, then +n. */
  function chainList(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3);
  }

  /* ------------------------------------------------------------ filtering */

  /** The board rows after the current filters, in the current sort order. */
  function currentRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.on_watchlist) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    return sortRows(rows, state.sortKey, state.sortDir);
  }

  /** Sort rows by one key; nulls always last; ties break by slug, so the order is stable. */
  function sortRows(rows, key, dir) {
    function value(r) {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'age_days') return r.age_days;
      return r[key];
    }
    return rows.slice().sort(function (a, b) {
      var va = value(a);
      var vb = value(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /* ------------------------------------------------------------ the board */

  var COLUMNS = [
    { key: 'rank', label: 'Rank', num: true, sort: 'rank' },
    { key: 'name', label: 'Protocol', num: false, sort: 'name' },
    { key: 'category', label: 'Category', num: false, sort: null },
    { key: 'chains', label: 'Chains', num: false, sort: null },
    { key: 'tvl', label: 'TVL', num: true, sort: 'tvl_usd' },
    { key: 'change', label: '7d', num: true, sort: 'change_7d' },
    { key: 'age', label: 'Age', num: true, sort: 'age_days' },
    { key: 'implied', label: 'Implied value', num: true, sort: 'implied_value_usd' },
  ];

  /** One board row as HTML. */
  function rowHtml(r) {
    var selected = state.selected === r.slug ? ' selected' : '';
    var wl = r.on_watchlist ? ' <span class="chip wl">Watchlist</span>' : '';
    return (
      '<tr class="row' + selected + '" data-slug="' + esc(r.slug) + '" tabindex="0">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' + wl +
      '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td><span class="sub">' + esc(chainList(r.chains)) + '</span></td>' +
      '<td class="num">' + formatUsd(r.tvl_usd) + '</td>' +
      '<td class="num ' + changeClass(r.change_7d) + '">' + formatPct(r.change_7d) + '</td>' +
      '<td class="num">' + formatAge(r.age_days) + '</td>' +
      '<td class="num"><strong>' + formatUsd(r.implied_value_usd) + '</strong></td>' +
      '</tr>'
    );
  }

  /** Render the board table for the current filters and sort. */
  function renderBoard() {
    var rows = currentRows();
    var wrap = document.getElementById('board-wrap');
    var showing = document.getElementById('showing');
    showing.textContent = 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' protocols';
    if (rows.length === 0) {
      wrap.innerHTML = '<p class="empty">No protocols match these filters. <button type="button" id="clear-filters">Clear the filters</button></p>';
      document.getElementById('clear-filters').addEventListener('click', resetFilters);
      return;
    }
    var head = COLUMNS.map(function (c) {
      var cls = c.num ? ' class="num"' : '';
      if (!c.sort) return '<th' + cls + '>' + c.label + '</th>';
      var arrow = state.sortKey === c.sort ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '';
      return '<th' + cls + '><button type="button" data-sort="' + c.sort + '">' + c.label +
        '<span class="arrow" aria-hidden="true">' + arrow + '</span></button></th>';
    }).join('');
    wrap.innerHTML =
      '<table><thead><tr>' + head + '</tr></thead><tbody>' +
      rows.map(rowHtml).join('') + '</tbody></table>';
    wrap.querySelectorAll('th button').forEach(function (btn) {
      btn.addEventListener('click', function () { setSort(btn.getAttribute('data-sort')); });
    });
    wrap.querySelectorAll('tr.row').forEach(function (tr) {
      tr.addEventListener('click', function () { selectProtocol(tr.getAttribute('data-slug')); });
      tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectProtocol(tr.getAttribute('data-slug')); }
      });
    });
  }

  /** Change the sort: a new key sorts descending, the same key flips direction. */
  function setSort(key) {
    if (state.sortKey === key) {
      state.sortDir = -state.sortDir;
    } else {
      state.sortKey = key;
      state.sortDir = key === 'name' ? 1 : -1;
    }
    renderBoard();
  }

  /** Clear every filter back to the full board. */
  function resetFilters() {
    state.q = '';
    state.category = '';
    state.chain = '';
    state.minTvl = 0;
    state.watchlistOnly = false;
    document.getElementById('q').value = '';
    document.getElementById('f-category').value = '';
    document.getElementById('f-chain').value = '';
    document.getElementById('f-tvl').value = '0';
    document.getElementById('f-watchlist').checked = false;
    renderBoard();
  }

  /* ------------------------------------------------------------ the detail */

  /** The model breakdown of one row: each factor, what it multiplies, and the running value. */
  function breakdownRows(r) {
    var m = r.model;
    var base = r.tvl_usd * m.multiple;
    var afterGrowth = base * m.growth_multiplier;
    var afterMaturity = afterGrowth * m.maturity_multiplier;
    var afterBreadth = afterMaturity * m.breadth_multiplier;
    var basis = m.multiple_basis === 'category'
      ? 'category median of ' + m.comparables + ' live comparables'
      : 'whole-market median of ' + m.comparables + ' live comparables';
    function line(label, factor, value) {
      return '<tr><td>' + label + '</td><td class="num">' + factor + '</td><td class="num">' + value + '</td></tr>';
    }
    return (
      line('TVL', '—', formatUsdFull(r.tvl_usd)) +
      line('× comparable multiple (' + esc(basis) + ')', '× ' + m.multiple.toFixed(4), formatUsdFull(base)) +
      line('× growth (' + formatPct(m.growth_pct) + ' over 7 days)', '× ' + m.growth_multiplier.toFixed(4), formatUsdFull(afterGrowth)) +
      line('× maturity (' + m.age_days + ' days with no token)', '× ' + m.maturity_multiplier.toFixed(4), formatUsdFull(afterMaturity)) +
      line('× chain breadth (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')', '× ' + m.breadth_multiplier.toFixed(4), formatUsdFull(afterBreadth)) +
      '<tr class="total"><td>Implied value (the model’s exact figure)</td><td class="num"></td><td class="num">' + formatUsdFull(r.implied_value_usd) + '</td></tr>'
    );
  }

  /** A farm step as HTML: the action, then its cost and time muted. */
  function stepHtml(step) {
    var at = step.lastIndexOf(' Cost: ');
    if (at < 0) return '<li>' + esc(step) + '</li>';
    return '<li>' + esc(step.slice(0, at)) + ' <span class="cost-time">' + esc(step.slice(at + 1)) + '</span></li>';
  }

  /** Render the detail panel for one protocol, above the board. */
  function renderDetail() {
    var panel = document.getElementById('detail');
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === state.selected) row = DATA.rows[i];
    }
    if (!row) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    var wl = row.on_watchlist ? '<span class="chip wl">On the watchlist</span>' : '<span class="chip">Below the watchlist floor</span>';
    panel.innerHTML =
      '<div class="detail-head"><span class="rank-badge">#' + row.rank + '</span>' +
      '<div><h2>' + esc(row.name) + '</h2>' +
      '<p class="meta"><span class="slug">' + esc(row.slug) + '</span>' + wl +
      '<span class="chip pre">Records no token</span>' +
      '<span class="chip">' + esc(row.category || 'No category') + '</span></p></div>' +
      '<button type="button" class="detail-close" id="detail-close">Close ✕</button></div>' +
      '<dl class="facts">' +
      '<div><dt>TVL</dt><dd>' + formatUsdFull(row.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd class="' + changeClass(row.change_7d) + '">' + formatPct(row.change_7d) + '</dd></div>' +
      '<div><dt>Listed</dt><dd>' + esc(row.listed_at || 'unknown') + '</dd></div>' +
      '<div><dt>Age</dt><dd>' + formatAge(row.age_days) + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + esc(row.chains.join(', ') || '—') + '</dd></div>' +
      '<div><dt>Implied value</dt><dd>' + formatUsdFull(row.implied_value_usd) + '</dd></div>' +
      '</dl>' +
      '<h3>How the value follows</h3>' +
      '<table class="breakdown"><thead><tr><th>Step</th><th class="num">Factor</th><th class="num">Running value</th></tr></thead>' +
      '<tbody>' + breakdownRows(row) + '</tbody></table>' +
      '<p class="note">Factors are shown to four decimals; the total is the model’s exact figure. ' +
      'The implied value is this radar’s own claim from the snapshot’s figures, never a promise of a launch.</p>' +
      '<h3>Farm plan</h3><ol class="plan">' + row.farm_steps.map(stepHtml).join('') + '</ol>' +
      '<p class="note">This protocol records no token in the snapshot. That is the record, not proof: ' +
      'a token may exist that the record does not carry. Check the protocol’s own pages before you farm.</p>';
    panel.hidden = false;
    document.getElementById('detail-close').addEventListener('click', function () { selectProtocol(null); });
  }

  /** Select a protocol (or clear the selection) and show its detail view. */
  function selectProtocol(slug) {
    state.selected = slug;
    if (slug) {
      writeHash('#/protocol/' + slug);
    } else if (location.hash.indexOf('#/protocol/') === 0) {
      writeHash('#/board');
    }
    renderDetail();
    renderBoard();
    if (slug) {
      document.getElementById('detail').scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }

  /* ------------------------------------------------------------ live view */

  /** Render the Already trading view: live-token protocols at the market's own values. */
  function renderLive() {
    var wrap = document.getElementById('live-wrap');
    var rows = DATA.live.map(function (p) {
      var ratio = p.mcap_usd !== null && p.tvl_usd > 0 ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
      return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td><span class="sub">' + esc(chainList(p.chains)) + '</span></td>' +
        '<td class="num">' + formatUsd(p.mcap_usd || 0) + '</td>' +
        '<td class="num">' + formatUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + ratio + '</td>' +
        '<td class="num ' + changeClass(p.change_7d) + '">' + formatPct(p.change_7d) + '</td></tr>';
    }).join('');
    wrap.innerHTML =
      '<p class="note">These protocols already trade, so the radar shows the market’s own value for them ' +
      'and never ranks them as launches. Their mcap/TVL ratios are the comparables the value model anchors on.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap / TVL</th><th class="num">7d</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ------------------------------------------------------------ method view */

  /** Render the Method view: the formula, the calibration, and the selection rule. */
  function renderMethod() {
    var wrap = document.getElementById('method-wrap');
    var cal = DATA.calibration;
    var catRows = cal.categories.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.multiple.toFixed(4) + '×</td><td class="num">' + c.comparables + '</td></tr>';
    }).join('');
    wrap.innerHTML =
      '<div class="method">' +
      '<h2>The value model</h2>' +
      '<p>Every implied value follows from the snapshot’s own figures. The multiple is not a constant: ' +
      'it is the median mcap/TVL of the live-token protocols in the same category, falling back to the ' +
      'whole market’s median where a category holds too few comparables. The same function scores every row; ' +
      'no protocol name is ever special-cased.</p>' +
      '<p class="formula">implied = TVL × multiple × (1 + clamp(7d %, −50, 150) / 100 × 0.6)<br>' +
      '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;× (0.55 + 0.45 × (1 − e^(−age / 540 days)))<br>' +
      '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;× (1 + 0.04 × min(chains − 1, 4))</p>' +
      '<p>A protocol whose listing date is unreported is scored at 365 days, the neutral middle of the ' +
      'maturity curve. A missing 7-day change counts as 0%. The multiple is clamped to 0.05×–2.00×.</p>' +
      '<h2>Calibration from this snapshot</h2>' +
      '<p>Whole-market median multiple: <strong>' + cal.market_multiple.toFixed(4) + '×</strong> over ' +
      cal.market_comparables + ' live comparables. Category medians with at least three comparables:</p>' +
      '<table><thead><tr><th>Category</th><th class="num">Multiple</th><th class="num">Comparables</th></tr></thead>' +
      '<tbody>' + catRows + '</tbody></table>' +
      '<h2>What the board ranks</h2>' +
      '<ul>' +
      '<li><strong>Ranked:</strong> protocols that record no token (no market cap, no CoinGecko id, no symbol), ' +
      'are not a wrapped, staked or bridged product of a token that trades, are not an exchange, and carry no ' +
      'version marker in the name. That is the house watchlist’s rule, run without its $50M floor.</li>' +
      '<li><strong>Set aside:</strong> protocols whose token already trades, shown under Already trading at the ' +
      'market’s own value. They anchor the comparables; they are never ranked as launches.</li>' +
      '<li><strong>The watchlist is the floor, never the ceiling:</strong> every one of its ' + DATA.watchlist_size +
      ' protocols is on the board, and ' + DATA.early_size + ' more below the floor join them.</li>' +
      '</ul>' +
      '<div class="callout"><strong>Read it as a record, not a promise.</strong> The snapshot is frozen at ' +
      esc(DATA.as_of) + '. “Records no token” means the record carries none — a token may exist that the record ' +
      'does not carry. The radar does not predict whether or when any protocol issues a token, and every ' +
      'implied value is this entry’s own claim.</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------ chrome */

  /** Render the header stats, the model strip, and the footer. */
  function renderChrome() {
    document.getElementById('stats').innerHTML =
      '<div><dt>Snapshot</dt><dd>' + esc(DATA.as_of) + '</dd></div>' +
      '<div><dt>Protocols</dt><dd>' + DATA.protocols_total + '</dd></div>' +
      '<div><dt>Watchlist</dt><dd>' + DATA.watchlist_size + '</dd></div>' +
      '<div><dt>Ranked</dt><dd>' + DATA.board_size + '</dd></div>';
    document.getElementById('model-strip').innerHTML =
      '<strong>Model ' + esc(DATA.model_version) + ':</strong> implied value = TVL × comparable multiple ' +
      '(category median mcap/TVL, market median ' + DATA.calibration.market_multiple.toFixed(4) + '×) × growth × maturity × chain breadth. ' +
      'The Method tab shows every multiple. <code>TVL × multiple × growth × maturity × breadth</code>';
    document.getElementById('foot').innerHTML =
      '<p>Data: a sealed DefiLlama snapshot, fetched once and frozen at ' + esc(DATA.as_of) + '. ' +
      'The board ranks ' + DATA.board_size + ' pre-token protocols, including all ' + DATA.watchlist_size +
      ' on the watchlist and ' + DATA.early_size + ' below its floor.</p>' +
      '<p>Implied values are this radar’s own claim from the snapshot’s figures. Nothing here is financial advice; ' +
      'check each protocol’s own pages before you farm, and never pay anyone to claim an airdrop.</p>';
  }

  /** Fill the category and chain filter selects from the board rows. */
  function fillFilters() {
    var categories = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    categories.sort();
    chains.sort();
    document.getElementById('f-category').innerHTML =
      '<option value="">All categories</option>' + categories.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
    document.getElementById('f-chain').innerHTML =
      '<option value="">All chains</option>' + chains.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
  }

  /** Switch views: board, live, or method. */
  function selectView(view) {
    state.view = view;
    document.querySelectorAll('#tabs button').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-view') === view ? 'true' : 'false');
    });
    document.getElementById('board-wrap').hidden = view !== 'board';
    document.getElementById('controls').hidden = view !== 'board';
    document.getElementById('live-wrap').hidden = view !== 'live';
    document.getElementById('method-wrap').hidden = view !== 'method';
    if (view !== 'board') {
      state.selected = null;
      document.getElementById('detail').hidden = true;
    }
    if (view === 'live') renderLive();
    if (view === 'method') renderMethod();
    if (view === 'board') renderBoard();
  }

  /** Write the hash without adding a history entry for every click. */
  function writeHash(hash) {
    if (history.replaceState) {
      history.replaceState(null, '', hash);
    } else {
      location.hash = hash;
    }
  }

  /** Read the starting view and selection from the hash. */
  function readHash() {
    var hash = location.hash || '';
    var m = hash.match(/^#\/protocol\/(.+)$/);
    if (m) {
      var slug = decodeURIComponent(m[1]);
      if (DATA.rows.some(function (r) { return r.slug === slug; })) {
        state.selected = slug;
        selectView('board');
        renderDetail();
        return;
      }
    }
    if (hash === '#/live') selectView('live');
    else if (hash === '#/method') selectView('method');
    else selectView('board');
  }

  /* ------------------------------------------------------------ init */

  function init() {
    renderChrome();
    fillFilters();
    document.getElementById('q').addEventListener('input', function (ev) { state.q = ev.target.value; renderBoard(); });
    document.getElementById('f-category').addEventListener('change', function (ev) { state.category = ev.target.value; renderBoard(); });
    document.getElementById('f-chain').addEventListener('change', function (ev) { state.chain = ev.target.value; renderBoard(); });
    document.getElementById('f-tvl').addEventListener('change', function (ev) { state.minTvl = Number(ev.target.value); renderBoard(); });
    document.getElementById('f-watchlist').addEventListener('change', function (ev) { state.watchlistOnly = ev.target.checked; renderBoard(); });
    document.querySelectorAll('#tabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectView(btn.getAttribute('data-view'));
        writeHash('#/' + btn.getAttribute('data-view'));
      });
    });
    window.addEventListener('hashchange', readHash);
    readHash();
    renderBoard();
  }

  init();
})();
