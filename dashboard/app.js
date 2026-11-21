// Token Radar — dashboard logic. Reads window.RADAR (written by main.ts
// into data.js beside this page) and renders the board, the filters and the
// detail view. Fully offline: no network calls of any kind.

(function () {
  'use strict';

  var DATA = window.RADAR || { model: '', rows: [], watchlistCovered: 0, already_trading: [] };
  var ROWS = DATA.rows || [];

  var $ = function (id) { return document.getElementById(id); };
  var searchInput = $('search');
  var verdictChips = $('verdict-chips');
  var categoryFilter = $('category-filter');
  var chainFilter = $('chain-filter');
  var rowsEl = $('rows');
  var countEl = $('count');
  var emptyEl = $('empty');
  var detailEl = $('detail');
  var statsEl = $('stats');

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    verdict: params.get('verdict') || '',
    category: params.get('cat') || '',
    chain: params.get('chain') || '',
    sortKey: 'rank',
    sortDir: 1,
    detailRank: params.get('detail') ? parseInt(params.get('detail'), 10) : null,
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function dollars(value) {
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(1) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(value);
  }

  function dollarsFull(value) {
    return '$' + value.toLocaleString('en-US');
  }

  function pct(value) {
    if (value === null || value === undefined) return '—';
    var sign = value > 0 ? '+' : '';
    return sign + (value * 100).toFixed(2) + '%';
  }

  function verdictRank(v) { return v === 'FARM' ? 0 : v === 'THIN' ? 1 : 2; }
  function confidenceRank(c) { return c === 'HIGH' ? 0 : c === 'MEDIUM' ? 1 : 2; }

  function sortValue(row, key) {
    if (key === 'confidence') return confidenceRank(row.confidence);
    if (key === 'verdict') return verdictRank(row.verdict);
    if (key === 'change7d') return row.change7d === null ? -Infinity : row.change7d;
    return row[key];
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = ROWS.filter(function (row) {
      if (state.verdict && row.verdict !== state.verdict) return false;
      if (state.category && row.category !== state.category) return false;
      if (state.chain && row.chains.indexOf(state.chain) === -1) return false;
      if (q && row.name.toLowerCase().indexOf(q) === -1 && row.slug.indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (a, b) {
      var va = sortValue(a, state.sortKey);
      var vb = sortValue(b, state.sortKey);
      if (va < vb) return -1 * state.sortDir;
      if (va > vb) return 1 * state.sortDir;
      return (a.rank - b.rank) * state.sortDir;
    });
    return list;
  }

  function renderStats() {
    var farm = ROWS.filter(function (r) { return r.verdict === 'FARM'; }).length;
    statsEl.innerHTML =
      '<div class="stat"><b>' + ROWS.length + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + DATA.watchlistCovered + '</b><span>watchlist rows</span></div>' +
      '<div class="stat"><b>' + farm + '</b><span>FARM verdicts</span></div>' +
      '<div class="stat"><b>' + (DATA.already_trading || []).length + '</b><span>tokens already trading</span></div>';
  }

  function renderFilters() {
    var categories = [];
    var chains = [];
    ROWS.forEach(function (row) {
      if (row.category && categories.indexOf(row.category) === -1) categories.push(row.category);
      row.chains.forEach(function (chain) {
        if (chains.indexOf(chain) === -1) chains.push(chain);
      });
    });
    categories.sort();
    chains.sort();
    categories.forEach(function (category) {
      var option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categoryFilter.appendChild(option);
    });
    chains.forEach(function (chain) {
      var option = document.createElement('option');
      option.value = chain;
      option.textContent = chain;
      chainFilter.appendChild(option);
    });
    searchInput.value = state.q;
    categoryFilter.value = state.category;
    chainFilter.value = state.chain;
  }

  function renderTable() {
    var list = filteredRows();
    countEl.textContent = 'Showing ' + list.length + ' of ' + ROWS.length + ' protocols, ranked by implied value.';
    emptyEl.hidden = list.length !== 0;
    var html = list.map(function (row) {
      var changeClass = row.change7d === null ? '' : row.change7d >= 0 ? 'pos' : 'neg';
      var chainChips = row.chains.slice(0, 4).map(function (chain) {
        return '<span class="chain-chip">' + escapeHtml(chain) + '</span>';
      }).join('');
      var extraChains = row.chains.length > 4 ? ' <span class="chain-chip">+' + (row.chains.length - 4) + '</span>' : '';
      var sub = (row.symbol ? escapeHtml(row.symbol) + ' · ' : '') + escapeHtml(row.slug);
      if (row.watchlist) sub += ' · <span class="tag watch">watchlist</span>';
      if (row.variant) sub += ' · variant';
      return '<tr data-rank="' + row.rank + '"' + (state.detailRank === row.rank ? ' class="selected"' : '') + '>' +
        '<td class="num">' + row.rank + '</td>' +
        '<td class="name">' + escapeHtml(row.name) + '<small>' + sub + '</small></td>' +
        '<td>' + escapeHtml(row.category || '—') + '</td>' +
        '<td>' + chainChips + extraChains + '</td>' +
        '<td class="num">' + dollars(row.tvl) + '</td>' +
        '<td class="num ' + changeClass + '">' + pct(row.change7d) + '</td>' +
        '<td class="num">' + dollars(row.implied) + '</td>' +
        '<td><span class="tag ' + row.confidence.toLowerCase() + '">' + row.confidence + '</span></td>' +
        '<td><span class="tag ' + row.verdict.toLowerCase() + '">' + row.verdict + '</span></td>' +
        '</tr>';
    }).join('');
    rowsEl.innerHTML = html;
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sortKey);
      th.classList.toggle('sort-asc', th.getAttribute('data-sort') === state.sortKey && state.sortDir === 1);
      th.classList.toggle('sort-desc', th.getAttribute('data-sort') === state.sortKey && state.sortDir === -1);
    });
  }

  function renderDetail() {
    if (!state.detailRank) {
      detailEl.hidden = true;
      detailEl.innerHTML = '';
      return;
    }
    var row = null;
    ROWS.forEach(function (candidate) {
      if (candidate.rank === state.detailRank) row = candidate;
    });
    if (!row) {
      detailEl.hidden = true;
      detailEl.innerHTML = '';
      return;
    }
    var evidenceLine = '';
    if (row.tokenEvidence) {
      evidenceLine = '<p class="sub">Token ' + escapeHtml(row.tokenEvidence.symbol) +
        ' already trades (' + escapeHtml(row.tokenEvidence.name) + ', CoinGecko rank ' +
        row.tokenEvidence.rank + ', market cap ' + dollars(row.tokenEvidence.market_cap) +
        '). This row is capped at THIN and is not a pre-token bet.</p>';
    } else {
      evidenceLine = '<p class="sub">Records no token in the snapshot. ' +
        (row.watchlist ? 'On the house watchlist. ' : '') +
        'Implied value if its record stayed as it is.</p>';
    }
    detailEl.innerHTML =
      '<button class="close" id="detail-close">Close ×</button>' +
      '<h2>#' + row.rank + ' — ' + escapeHtml(row.name) + '</h2>' +
      '<p class="sub">' + escapeHtml(row.category || 'Uncategorised') + ' · ' +
      row.chains.map(escapeHtml).join(', ') + ' · ' +
      '<span class="tag ' + row.verdict.toLowerCase() + '">' + row.verdict + '</span> ' +
      '<span class="tag ' + row.confidence.toLowerCase() + '">' + row.confidence + ' confidence</span>' +
      (row.variant ? ' <span class="tag watch">versioned variant</span>' : '') + '</p>' +
      evidenceLine +
      '<div class="facts">' +
      '<div class="fact"><b>' + dollarsFull(row.implied) + '</b><span>implied value</span><small>TVL × multiple × growth × maturity × breadth</small></div>' +
      '<div class="fact"><b>' + dollarsFull(row.tvl) + '</b><span>TVL</span><small>' + pct(row.change7d) + ' over 7 days</small></div>' +
      '<div class="fact"><b>' + row.multiple.toFixed(3) + '×</b><span>multiple</span><small>TVL → market cap, from same-category comps</small></div>' +
      '<div class="fact"><b>' + row.growth.toFixed(3) + '×</b><span>growth</span><small>from the 7-day TVL change</small></div>' +
      '<div class="fact"><b>' + row.maturity.toFixed(3) + '×</b><span>maturity</span><small>age since first tracked</small></div>' +
      '<div class="fact"><b>' + row.breadth.toFixed(3) + '×</b><span>breadth</span><small>' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + '</small></div>' +
      '</div>' +
      '<h3>Risks</h3><ul>' +
      row.risks.map(function (risk) { return '<li>' + escapeHtml(risk) + '</li>'; }).join('') +
      '</ul>' +
      '<h3>How to farm it</h3><ol>' +
      row.farm_steps.map(function (step) { return '<li>' + escapeHtml(step) + '</li>'; }).join('') +
      '</ol>';
    detailEl.hidden = false;
    $('detail-close').addEventListener('click', function () {
      state.detailRank = null;
      renderDetail();
      renderTable();
    });
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function refresh() {
    renderTable();
    renderDetail();
  }

  // Events.
  searchInput.addEventListener('input', function () {
    state.q = searchInput.value;
    renderTable();
  });
  verdictChips.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-verdict]');
    if (!button) return;
    state.verdict = button.getAttribute('data-verdict');
    verdictChips.querySelectorAll('.chip').forEach(function (chip) {
      chip.classList.toggle('active', chip === button);
    });
    renderTable();
  });
  categoryFilter.addEventListener('change', function () {
    state.category = categoryFilter.value;
    renderTable();
  });
  chainFilter.addEventListener('change', function () {
    state.chain = chainFilter.value;
    renderTable();
  });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === 'name' || key === 'category' ? 1 : -1;
      }
      renderTable();
    });
  });
  rowsEl.addEventListener('click', function (event) {
    var tr = event.target.closest('tr[data-rank]');
    if (!tr) return;
    var rank = parseInt(tr.getAttribute('data-rank'), 10);
    state.detailRank = state.detailRank === rank ? null : rank;
    refresh();
  });

  // Initial state from the query string (?verdict=FARM&cat=Lending etc.).
  if (state.verdict) {
    verdictChips.querySelectorAll('.chip').forEach(function (chip) {
      chip.classList.toggle('active', chip.getAttribute('data-verdict') === state.verdict);
    });
  }

  renderStats();
  renderFilters();
  refresh();
})();
