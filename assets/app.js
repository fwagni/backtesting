/* app.js — filters, pages, charts. Depends on data.js, stats.js, ECharts, PapaParse. */
(function () {
  const S = TB.stats, D = TB.data;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Dimensions: everything a trade can be grouped or filtered by ---------- */
  const DIMS = {
    model: { label: 'Model', get: (t) => t.model },
    version: { label: 'Model version', get: (t) => t.version },
    mode: { label: 'Mode', get: (t) => t.mode },
    instrument: { label: 'Instrument', get: (t) => t.instrument },
    session: { label: 'Session', get: (t) => t.session },
    killZone: { label: 'Kill zone', get: (t) => t.killZone },
    macro: { label: 'Macro window', get: (t) => t.macro },
    hour: { label: 'Entry time (15 min)', get: (t) => t.hour },
    dow: { label: 'Day of week', get: (t) => t.dow },
    direction: { label: 'Direction', get: (t) => t.direction },
    withBias: { label: 'Bias alignment', get: (t) => t.withBias },
    entryTf: { label: 'Entry timeframe', get: (t) => t.entryTf },
    setupTf: { label: 'Setup timeframe', get: (t) => t.setupTf },
    biasTf: { label: 'Bias timeframe', get: (t) => t.biasTf },
    dailyProfile: { label: 'Daily profile', get: (t) => t.dailyProfile },
    asiaRange: { label: 'Asia range', get: (t) => t.asiaRange },
    liquidity: { label: 'Liquidity taken', get: (t) => t.liquidity, multi: true },
    confluences: { label: 'Confluences', get: (t) => t.confluences, multi: true },
    pdArray: { label: 'PD array of entry', get: (t) => t.pdArray },
    premDisc: { label: 'Premium/Discount', get: (t) => t.premDisc },
    news: { label: 'News day', get: (t) => t.news },
    grade: { label: 'Setup grade', get: (t) => t.grade },
    confidence: { label: 'Confidence', get: (t) => t.confidence },
    emoBefore: { label: 'Emotion before', get: (t) => t.emoBefore },
    exitReason: { label: 'Exit reason', get: (t) => t.exitReason },
    followed: { label: 'Followed plan', get: (t) => (t.followed ? 'Followed plan' : 'Broke plan') },
    loggedBefore: { label: 'Logged before outcome', get: (t) => (t.loggedBefore ? 'Logged blind' : 'Logged after') },
    taken: { label: 'Taken or skipped', get: (t) => t.taken },
    month: { label: 'Month', get: (t) => t.month },
  };
  const ORDER = {
    dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    session: ['Asia', 'London', 'NY AM', 'NY Lunch', 'NY PM'],
    killZone: ['Asia KZ', 'London KZ', 'NY AM KZ', 'London Close', 'NY PM KZ', 'None'],
    grade: ['A+', 'A', 'B', 'C'],
    entryTf: ['M1', 'M3', 'M5', 'M15', 'H1'],
    setupTf: ['M15', 'H1', 'H4'],
    biasTf: ['Monthly', 'Weekly', 'Daily', 'H4'],
    news: ['None', 'Medium', 'High (pre)', 'High (post)'],
    confidence: ['1', '2', '3', '4', '5'],
    asiaRange: ['Small', 'Normal', 'Large'],
    withBias: ['With bias', 'Against bias', 'Neutral bias'],
    mode: ['Backtest', 'Paper', 'Live'],
  };
  function sortKeys(dim, keys) {
    const o = ORDER[dim];
    return keys.slice().sort((a, b) => {
      if (o) { const ia = o.indexOf(a), ib = o.indexOf(b); if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); }
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    });
  }
  const FILTER_DIMS = ['mode', 'model', 'version', 'instrument', 'entryTf', 'setupTf', 'session', 'killZone', 'dow', 'direction', 'withBias', 'grade', 'followed', 'news', 'confluences', 'taken'];
  const MATRIX_DIMS = ['model', 'session', 'killZone', 'macro', 'hour', 'dow', 'direction', 'withBias', 'entryTf', 'instrument', 'liquidity', 'confluences', 'dailyProfile', 'asiaRange', 'news', 'grade', 'pdArray', 'premDisc', 'version', 'mode'];
  const PLAYBOOK_DIMS = ['session', 'killZone', 'macro', 'dow', 'direction', 'withBias', 'entryTf', 'liquidity', 'confluences', 'asiaRange', 'dailyProfile', 'news', 'grade'];

  const TABS = [
    ['overview', 'Overview'], ['conditions', 'Conditions'], ['timing', 'Timing'], ['setups', 'Setups & sessions'],
    ['execution', 'Execution & mindset'], ['prop', 'Prop simulator'], ['trades', 'Trade log'], ['health', 'Data health'],
  ];

  /* ---------- State ---------- */
  const state = {
    schema: null, trades: [], accounts: [], issues: [], totalRows: 0, source: '',
    filters: {}, datePreset: 'all', from: '', to: '', unit: 'R', tab: 'overview',
    matrix: { row: 'session', col: 'dow', metric: 'exp', minN: 10 }, minN: 20,
    tradeSort: { key: 'date', dir: -1 }, tradeSearch: '', tradeLimit: 50,
    simAccount: '', simModel: '', cell: null,
  };
  let charts = [];

  /* ---------- Units ---------- */
  const accountOf = (t) => state.accounts.find((a) => a.name === t.account) || state.accounts[0] || null;
  const riskOf = (t) => t.risk ?? accountOf(t)?.risk ?? null;
  function val(t) {
    if (state.unit === 'R') return t.r;
    const risk = riskOf(t);
    if (risk === null) return 0;
    if (state.unit === '$') return t.r * risk;
    const size = accountOf(t)?.size;
    return size ? (t.r * risk / size) * 100 : 0;
  }
  function fmtV(v, unit = state.unit, sign = true) {
    if (!Number.isFinite(v)) return '—';
    const s = sign && v > 0 ? '+' : v < 0 ? '−' : '';
    const a = Math.abs(v);
    if (unit === 'R') return `${s}${a.toFixed(2)}R`;
    if (unit === '$') return `${s}$${a.toLocaleString('en-US', { maximumFractionDigits: a < 100 ? 2 : 0 })}`;
    return `${s}${a.toFixed(2)}%`;
  }
  const fmtR = (v) => fmtV(v, 'R');
  const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—');
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const fmtPF = (v) => (v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(2) : '—');

  /* ---------- Filtering ---------- */
  function dateBounds() {
    if (state.datePreset === 'custom') return [state.from || '0000', state.to || '9999'];
    if (state.datePreset === 'all') return ['0000', '9999'];
    const now = new Date(), iso = (d) => d.toISOString().slice(0, 10), today = iso(now);
    const back = (days) => iso(new Date(now.getTime() - days * 864e5));
    switch (state.datePreset) {
      case 'week': { const d = (now.getDay() + 6) % 7; return [back(d), today]; }
      case 'month': return [today.slice(0, 8) + '01', today];
      case '30d': return [back(30), today];
      case '90d': return [back(90), today];
      case 'ytd': return [today.slice(0, 4) + '-01-01', today];
      case '12m': return [back(365), today];
    }
    return ['0000', '9999'];
  }
  function applyFilters(trades, skip = []) {
    const [from, to] = dateBounds();
    const active = Object.entries(state.filters).filter(([k, v]) => v && v.length && !skip.includes(k));
    return trades.filter((t) => {
      if (t.date < from || t.date > to) return false;
      for (const [k, vals] of active) {
        const v = DIMS[k].get(t);
        if (DIMS[k].multi) { if (!vals.every((x) => v.includes(x))) return false; }
        else if (!vals.includes(v === '' ? '(blank)' : v)) return false;
      }
      return true;
    });
  }

  /* ---------- URL hash (bookmarkable views) ---------- */
  function writeHash() {
    const p = new URLSearchParams();
    p.set('tab', state.tab);
    if (state.unit !== 'R') p.set('unit', state.unit);
    if (state.datePreset !== 'all') p.set('period', state.datePreset);
    if (state.datePreset === 'custom') { if (state.from) p.set('from', state.from); if (state.to) p.set('to', state.to); }
    for (const [k, v] of Object.entries(state.filters)) if (v && v.length) p.set(k, v.join('~'));
    if (![...p.keys()].some((k) => k !== 'tab' && k !== 'unit')) p.set('f', 'none');
    history.replaceState(null, '', '#' + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const hasState = [...p.keys()].some((k) => k !== 'tab' && k !== 'unit');
    state.tab = TABS.some(([k]) => k === p.get('tab')) ? p.get('tab') : 'overview';
    state.unit = ['R', '$', '%'].includes(p.get('unit')) ? p.get('unit') : 'R';
    state.datePreset = p.get('period') || 'all';
    state.from = p.get('from') || ''; state.to = p.get('to') || '';
    state.filters = {};
    FILTER_DIMS.forEach((k) => { if (p.get(k)) state.filters[k] = p.get(k).split('~'); });
    return hasState;
  }

  /* ---------- Charts ---------- */
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function base() {
    return {
      animation: !reduceMotion,
      textStyle: { fontFamily: 'Archivo, Helvetica Neue, Arial, sans-serif', color: css('--muted') },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        backgroundColor: css('--surface'), borderColor: css('--line'), textStyle: { color: css('--ink'), fontSize: 13 },
        extraCssText: 'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);',
      },
      toolbox: { right: 0, top: -6, itemSize: 13, feature: { saveAsImage: { title: 'Save PNG', backgroundColor: css('--surface'), pixelRatio: 2 } }, iconStyle: { borderColor: css('--muted') } },
    };
  }
  const axisStyle = () => ({
    axisLine: { lineStyle: { color: css('--line') } }, axisTick: { show: false },
    splitLine: { lineStyle: { color: css('--line'), type: [3, 3] } }, axisLabel: { color: css('--muted') },
  });
  function mk(el, option) {
    if (!el) return null;
    const c = echarts.init(el, null, { renderer: 'canvas' });
    c.setOption(Object.assign(base(), option));
    charts.push(c);
    return c;
  }
  function disposeCharts() { charts.forEach((c) => c.dispose()); charts = []; }
  window.addEventListener('resize', () => charts.forEach((c) => c.resize()));

  /** Bar chart of expectancy by one dimension, bars coloured by sign. */
  function barByDim(el, trades, dim, opts = {}) {
    const groups = S.groupBy(trades, DIMS[dim].get);
    const keys = sortKeys(dim, [...groups.keys()]).filter((k) => !(opts.skipBlank && (k === '(blank)' || k === '(none)')));
    const rows = keys.map((k) => ({ k, s: S.summary(groups.get(k), val) }));
    if (!rows.length) { el.innerHTML = `<p class="notice">${esc(opts.emptyText || 'No trades with this field filled in for the current filters.')}</p>`; el.style.height = 'auto'; return; }
    const longest = Math.max(...keys.map((k) => String(k).length));
    const rotate = keys.length > 8 || (keys.length > 3 && longest > 9) ? 35 : 0;
    const metric = opts.metric || 'exp';
    const minN = opts.minN ?? 10;
    mk(el, {
      tooltip: Object.assign(base().tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps) => { const r = rows[ps[0].dataIndex]; return `<b>${esc(r.k)}</b><br>${r.s.n} trades${r.s.n < minN ? ' (small sample)' : ''}<br>Expectancy ${fmtV(r.s.exp)}<br>Win rate ${pct(r.s.winRate)}<br>Total ${fmtV(r.s.total)}`; },
      }),
      xAxis: Object.assign({ type: 'category', data: keys, axisLabel: { color: css('--muted'), interval: 0, rotate } }, { axisLine: { lineStyle: { color: css('--line') } }, axisTick: { show: false } }),
      yAxis: Object.assign({ type: 'value', axisLabel: { color: css('--muted'), formatter: (v) => (metric === 'winRate' ? pct(v) : fmtV(v, state.unit, false)) } }, { splitLine: axisStyle().splitLine }),
      series: [{
        type: 'bar', barMaxWidth: 36,
        data: rows.map((r) => {
          const v = metric === 'winRate' ? r.s.winRate : r.s.exp;
          const color = metric === 'winRate' ? css('--accent') : v >= 0 ? css('--win') : css('--loss');
          return { value: v, itemStyle: { color, opacity: r.s.n < minN ? 0.35 : 1, borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } };
        }),
        label: { show: keys.length <= 12, position: 'top', color: css('--muted'), fontSize: 11, formatter: (p) => `n ${rows[p.dataIndex].s.n}` },
      }],
    });
  }

  /* ---------- Small HTML helpers ---------- */
  const card = (span, title, sub, body) => `<section class="card span-${span}"><h2>${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${body}</section>`;
  const chartDiv = (id, extra = '') => `<div class="chart ${extra}" id="${id}" role="img" aria-label="${esc(id.replace(/-/g, ' '))}"></div>`;
  const emptyState = (title, body) => `<div class="card empty"><strong>${esc(title)}</strong>${body}</div>`;
  function statRow(label, s, extra = '') {
    return `<td>${esc(label)}</td><td class="n">${s.n}</td><td class="n">${pct(s.winRate)}</td><td class="n ${cls(s.exp)}">${fmtV(s.exp)}</td><td class="n">${fmtPF(s.pf)}</td><td class="n ${cls(s.total)}">${fmtV(s.total)}</td>${extra}`;
  }

  /* ================= PAGES ================= */

  function pageOverview(ts) {
    if (!ts.length) return noTrades();
    const s = S.summary(ts, val);
    const [lo, hi] = S.bootstrapCI(ts.map((t) => t.r));
    const low = s.n < 30;
    const kpi = (label, value, note, extra = '') => `<div class="kpi ${extra}"><div class="label">${label}</div><div class="value num">${value}</div><div class="note">${note}</div></div>`;
    const lowBadge = low ? '<span class="badge" title="Fewer than 30 trades: treat these numbers as noise">Low sample</span>' : '';
    const html = `
      <div class="kpis ${low ? 'lowsample' : ''}">
        ${kpi(`Expectancy per trade ${lowBadge}`, `<span class="${cls(s.exp)}">${fmtV(s.exp)}</span>`, `95% range ${fmtR(lo)} to ${fmtR(hi)} per trade. ${lo > 0 ? 'Edge is positive even at the low end.' : 'The range still includes zero or less, so the edge is not proven yet.'}`, 'hero')}
        ${kpi('Trades', s.n, `${s.wins} wins, ${s.losses} losses, ${s.breakeven} breakeven`)}
        ${kpi('Win rate', pct(s.winRate), `Average win ${fmtR(s.avgWinR)}, planned ${s.avgPlannedRR ? s.avgPlannedRR.toFixed(2) + 'R' : '—'}`)}
        ${kpi('Profit factor', fmtPF(s.pf), 'Gross profit ÷ gross loss')}
        ${kpi('Total', `<span class="${cls(s.total)}">${fmtV(s.total)}</span>`, state.unit === 'R' ? 'Sum of R results' : `${fmtR(s.totalR)} in R`)}
        ${kpi('Max drawdown', fmtV(-s.maxDD), state.unit === 'R' ? 'Peak to trough' : `${fmtR(-s.maxDDR)} in R`)}
        ${kpi('Longest losing streak', s.streak, 'Consecutive losing trades')}
        ${kpi('Rule adherence', pct(s.adherence), s.adherence >= 0.9 ? 'At or above the 90% target' : 'Below the 90% target')}
        ${kpi('Average R per month', fmtR(s.totalR / Math.max(1, new Set(ts.map((t) => t.month)).size)), `${new Set(ts.map((t) => t.month)).size} months with trades`)}
      </div>
      <div class="grid">
        ${card(12, 'Equity curve', `Running total in ${state.unit === 'R' ? 'R' : state.unit === '$' ? 'dollars' : 'percent of account'}, trade by trade. The shaded band underneath is the drawdown from the last peak.`, chartDiv('eq-chart', 'tall'))}
        ${card(6, 'Result distribution', 'How many trades ended at each R multiple. A healthy model has a cluster at −1R and a long tail to the right.', chartDiv('dist-chart'))}
        ${card(6, 'Result by month', 'Total per calendar month.', chartDiv('month-chart'))}
        ${card(12, 'Model leaderboard', 'Click a model to filter the whole dashboard to it. The 95% range shows how sure the expectancy is.', modelTable(ts))}
      </div>`;
    return { html, after: () => {
      let eq = 0, peak = 0;
      const xs = [], ys = [], dds = [];
      ts.forEach((t, i) => { eq += val(t); peak = Math.max(peak, eq); xs.push(i + 1); ys.push(+eq.toFixed(4)); dds.push(+(eq - peak).toFixed(4)); });
      mk($('#eq-chart'), {
        tooltip: Object.assign(base().tooltip, { trigger: 'axis', formatter: (ps) => { const i = ps[0].dataIndex, t = ts[i]; return `<b>Trade ${i + 1}</b>, ${t.date}<br>${esc(t.model)}<br>Result ${fmtV(val(t))}<br>Equity ${fmtV(ys[i])}<br>Drawdown ${fmtV(dds[i])}`; } }),
        grid: [{ left: 8, right: 16, top: 24, height: '60%', containLabel: true }, { left: 8, right: 16, top: '74%', bottom: 30, containLabel: true }],
        xAxis: [{ type: 'category', data: xs, gridIndex: 0, ...axisStyle(), axisLabel: { show: false } }, { type: 'category', data: xs, gridIndex: 1, ...axisStyle(), name: 'Trade number', nameLocation: 'middle', nameGap: 24 }],
        yAxis: [{ type: 'value', gridIndex: 0, ...axisStyle(), axisLabel: { color: css('--muted'), formatter: (v) => fmtV(v, state.unit, false) } }, { type: 'value', gridIndex: 1, ...axisStyle(), splitNumber: 2, axisLabel: { color: css('--muted'), formatter: (v) => fmtV(v, state.unit, false) } }],
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        series: [
          { type: 'line', data: ys, showSymbol: false, lineStyle: { width: 2, color: css('--accent') }, xAxisIndex: 0, yAxisIndex: 0 },
          { type: 'line', data: dds, showSymbol: false, lineStyle: { width: 1, color: css('--loss') }, areaStyle: { color: css('--loss'), opacity: 0.18 }, xAxisIndex: 1, yAxisIndex: 1 },
        ],
      });
      const bins = []; for (let b = -1.5; b <= 4; b += 0.5) bins.push(b);
      const counts = bins.map(() => 0);
      ts.forEach((t) => { let i = Math.floor((Math.min(Math.max(t.r, -1.5), 4.49) + 1.5) / 0.5); counts[Math.min(i, bins.length - 1)]++; });
      mk($('#dist-chart'), {
        tooltip: Object.assign(base().tooltip, { trigger: 'axis', formatter: (ps) => `${bins[ps[0].dataIndex].toFixed(1)}R to ${(bins[ps[0].dataIndex] + 0.5).toFixed(1)}R<br>${ps[0].value} trades` }),
        grid: { left: 8, right: 16, top: 24, bottom: 28, containLabel: true },
        xAxis: { type: 'category', data: bins.map((b) => b.toFixed(1)), ...axisStyle(), name: 'R multiple', nameLocation: 'middle', nameGap: 26 },
        yAxis: { type: 'value', ...axisStyle(), minInterval: 1 },
        series: [{ type: 'bar', barCategoryGap: '8%', data: counts.map((c, i) => ({ value: c, itemStyle: { color: bins[i] + 0.5 <= 0 ? css('--loss') : bins[i] <= 0 ? css('--neutral') : css('--win'), borderRadius: [3, 3, 0, 0] } })) }],
      });
      const months = S.groupBy(ts, (t) => t.month);
      const mkeys = [...months.keys()].sort();
      const mvals = mkeys.map((k) => S.sum(months.get(k).map(val)));
      mk($('#month-chart'), {
        tooltip: Object.assign(base().tooltip, { trigger: 'axis', formatter: (ps) => `<b>${mkeys[ps[0].dataIndex]}</b><br>${fmtV(mvals[ps[0].dataIndex])}, ${months.get(mkeys[ps[0].dataIndex]).length} trades` }),
        xAxis: { type: 'category', data: mkeys, ...axisStyle() },
        yAxis: { type: 'value', ...axisStyle(), axisLabel: { color: css('--muted'), formatter: (v) => fmtV(v, state.unit, false) } },
        series: [{ type: 'bar', barMaxWidth: 22, data: mvals.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? css('--win') : css('--loss') } })) }],
      });
      document.querySelectorAll('[data-model-row]').forEach((tr) => tr.addEventListener('click', () => { state.filters.model = [tr.dataset.modelRow]; update(); }));
    } };
  }

  function modelTable(ts) {
    const g = S.groupBy(ts, (t) => t.model);
    const rows = [...g.entries()].map(([m, list]) => ({ m, s: S.summary(list, val), ci: S.bootstrapCI(list.map((t) => t.r)) })).sort((a, b) => b.s.expR - a.s.expR);
    return `<div class="scroll-x"><table><thead><tr><th>Model</th><th class="n">Trades</th><th class="n">Win rate</th><th class="n">Expectancy</th><th class="n">Profit factor</th><th class="n">Total</th><th class="n">95% range (R)</th><th class="n">Max drawdown</th><th class="n">Adherence</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="click ${r.s.n < 30 ? 'dim' : ''}" data-model-row="${esc(r.m)}" tabindex="0">${statRow(r.m, r.s, `<td class="n">${fmtR(r.ci[0])} to ${fmtR(r.ci[1])}</td><td class="n">${fmtV(-r.s.maxDD)}</td><td class="n">${pct(r.s.adherence)}</td>`)}</tr>`).join('')}
    </tbody></table></div>`;
  }

  /* ---- Conditions ---- */
  function pageConditions(ts) {
    if (!ts.length) return noTrades();
    const m = state.matrix;
    const dimOpts = (sel) => MATRIX_DIMS.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${DIMS[k].label}</option>`).join('');
    const html = `<div class="grid">
      ${card(12, 'Conditions matrix', 'Each cell is the expectancy of the trades that match both conditions. Hatched grey cells have too few trades to trust. Click a cell to list its trades below.', `
        <div class="controls">
          <label>Rows<select id="mx-row">${dimOpts(m.row)}</select></label>
          <label>Columns<select id="mx-col">${dimOpts(m.col)}</select></label>
          <label>Colour by<select id="mx-metric">
            <option value="exp" ${m.metric === 'exp' ? 'selected' : ''}>Expectancy</option>
            <option value="winRate" ${m.metric === 'winRate' ? 'selected' : ''}>Win rate</option>
            <option value="total" ${m.metric === 'total' ? 'selected' : ''}>Total</option>
            <option value="n" ${m.metric === 'n' ? 'selected' : ''}>Number of trades</option></select></label>
          <label>Minimum trades per cell: <b id="mx-minN-v">${m.minN}</b><input type="range" id="mx-minN" min="3" max="50" value="${m.minN}"></label>
        </div>
        <div class="scroll-x"><div class="chart tall" id="matrix-chart" role="img" aria-label="Conditions matrix"></div></div>
        <div id="cell-trades"></div>`)}
      ${card(12, "Today's conditions", 'Pick what you see in the market today. The table shows how each model did under exactly those conditions.', conditionChecker())}
      ${card(12, 'Model playbooks', `Each model's best and worst single conditions with at least ${state.minN} trades, compared with the model's overall expectancy.`, playbooks(ts))}
    </div>`;
    return { html, after: () => {
      drawMatrix(ts);
      ['row', 'col', 'metric'].forEach((k) => $(`#mx-${k}`).addEventListener('change', (e) => { m[k] = e.target.value; state.cell = null; render(); }));
      $('#mx-minN').addEventListener('input', (e) => { $('#mx-minN-v').textContent = e.target.value; });
      $('#mx-minN').addEventListener('change', (e) => { m.minN = +e.target.value; render(); });
      wireChecker(ts);
      if (state.cell) showCell(ts);
    } };
  }

  function drawMatrix(ts) {
    const m = state.matrix, R = DIMS[m.row], C = DIMS[m.col];
    const rowKeys = sortKeys(m.row, [...S.groupBy(ts, R.get).keys()]);
    const colKeys = sortKeys(m.col, [...S.groupBy(ts, C.get).keys()]);
    const toKeys = (v) => (Array.isArray(v) ? (v.length ? v : ['(none)']) : [v === '' ? '(blank)' : v]);
    const cells = new Map();
    for (const t of ts) for (const r of toKeys(R.get(t))) for (const c of toKeys(C.get(t))) {
      const k = r + '\u0000' + c; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(t);
    }
    const good = [], low = [];
    let maxAbs = 0, maxN = 1;
    cells.forEach((list, k) => {
      const [r, c] = k.split('\u0000');
      const s = S.summary(list, val);
      const v = m.metric === 'n' ? s.n : m.metric === 'winRate' ? s.winRate : m.metric === 'total' ? s.total : s.exp;
      const item = { value: [colKeys.indexOf(c), rowKeys.indexOf(r), v], s, r, c };
      if (s.n >= m.minN) { good.push(item); maxAbs = Math.max(maxAbs, Math.abs(v)); } else low.push(item);
      maxN = Math.max(maxN, s.n);
    });
    const el = $('#matrix-chart');
    el.style.width = Math.max(el.parentElement.clientWidth, 140 + colKeys.length * 92) + 'px';
    el.style.height = Math.max(280, 70 + rowKeys.length * 46) + 'px';
    const fmtCell = (it) => (m.metric === 'winRate' ? pct(it.s.winRate) : m.metric === 'n' ? String(it.s.n) : m.metric === 'total' ? fmtV(it.s.total) : fmtV(it.s.exp));
    const diverging = m.metric === 'exp' || m.metric === 'total';
    const vm = diverging
      ? { min: -maxAbs || -1, max: maxAbs || 1, inRange: { color: [css('--loss'), css('--surface-2'), css('--win')] } }
      : m.metric === 'winRate' ? { min: 0, max: 1, inRange: { color: [css('--surface-2'), css('--accent')] } }
      : { min: 0, max: maxN, inRange: { color: [css('--surface-2'), css('--accent')] } };
    const chart = mk(el, {
      tooltip: Object.assign(base().tooltip, { formatter: (p) => { const it = p.data; return `<b>${esc(R.label)}: ${esc(it.r)}</b><br><b>${esc(C.label)}: ${esc(it.c)}</b><br>${it.s.n} trades${it.s.n < m.minN ? ' (too few to trust)' : ''}<br>Win rate ${pct(it.s.winRate)}<br>Expectancy ${fmtV(it.s.exp)}<br>Total ${fmtV(it.s.total)}`; } }),
      grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: colKeys, position: 'top', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: css('--ink'), interval: 0, fontWeight: 600 } },
      yAxis: { type: 'category', data: rowKeys, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: css('--ink'), fontWeight: 600 } },
      visualMap: Object.assign({ show: false, seriesIndex: 0, dimension: 2 }, vm),
      series: [
        { type: 'heatmap', data: good, itemStyle: { borderColor: css('--surface'), borderWidth: 3, borderRadius: 6 },
          label: { show: true, formatter: (p) => `{v|${fmtCell(p.data)}}\n{n|n ${p.data.s.n}}`, rich: { v: { fontSize: 13, fontWeight: 650, color: css('--ink') }, n: { fontSize: 10.5, color: css('--muted') } } },
          emphasis: { itemStyle: { borderColor: css('--ink'), borderWidth: 2 } } },
        { type: 'heatmap', data: low, itemStyle: { color: css('--surface-2'), borderColor: css('--surface'), borderWidth: 3, borderRadius: 6, decal: { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [1, 5], rotation: -Math.PI / 4, color: css('--line') } },
          label: { show: true, formatter: (p) => `{n|n ${p.data.s.n}}`, rich: { n: { fontSize: 10.5, color: css('--muted') } } } },
      ],
    });
    chart.on('click', (p) => { state.cell = { r: p.data.r, c: p.data.c }; showCell(ts); });
  }

  function showCell(ts) {
    const m = state.matrix, { r, c } = state.cell;
    const hit = (dim, key, t) => { const v = DIMS[dim].get(t); return Array.isArray(v) ? (v.length ? v.includes(key) : key === '(none)') : (v === '' ? '(blank)' : v) === key; };
    const list = ts.filter((t) => hit(m.row, r, t) && hit(m.col, c, t));
    const s = S.summary(list, val);
    $('#cell-trades').innerHTML = `<p class="notice"><b>${esc(DIMS[m.row].label)}: ${esc(r)}</b>, <b>${esc(DIMS[m.col].label)}: ${esc(c)}</b>. ${s.n} trades, win rate ${pct(s.winRate)}, expectancy ${fmtV(s.exp)}. <button class="link" id="cell-close">Clear</button></p>${tradeTable(list.slice().reverse().slice(0, 30), false)}`;
    $('#cell-close').addEventListener('click', () => { state.cell = null; $('#cell-trades').innerHTML = ''; });
  }

  function conditionChecker() {
    const sel = (id, dim, multi) => {
      const keys = sortKeys(dim, [...S.groupBy(state.trades, DIMS[dim].get).keys()]).filter((k) => k !== '(blank)' && k !== '(none)');
      return `<label>${DIMS[dim].label}<select id="cc-${id}" ${multi ? '' : ''}><option value="">Any</option>${keys.map((k) => `<option>${esc(k)}</option>`).join('')}</select></label>`;
    };
    return `<div class="controls">${sel('session', 'session')}${sel('dow', 'dow')}${sel('withBias', 'withBias')}${sel('liquidity', 'liquidity')}${sel('news', 'news')}${sel('asiaRange', 'asiaRange')}</div><div id="cc-out"></div>`;
  }
  function wireChecker(ts) {
    const ids = ['session', 'dow', 'withBias', 'liquidity', 'news', 'asiaRange'];
    const run = () => {
      const pick = Object.fromEntries(ids.map((k) => [k, $(`#cc-${k}`).value]));
      const list = ts.filter((t) => ids.every((k) => { if (!pick[k]) return true; const v = DIMS[k].get(t); return Array.isArray(v) ? v.includes(pick[k]) : v === pick[k]; }));
      const g = S.groupBy(list, (t) => t.model);
      const rows = [...g.entries()].map(([mname, l]) => ({ mname, s: S.summary(l, val) })).sort((a, b) => b.s.exp - a.s.exp);
      const dir = (l) => { const g2 = S.groupBy(l, (t) => t.direction); const best = [...g2.entries()].map(([d, x]) => [d, S.summary(x).expR, x.length]).filter((x) => x[2] >= 5).sort((a, b) => b[1] - a[1])[0]; return best ? `${best[0]} (${fmtR(best[1])}, n ${best[2]})` : '—'; };
      $('#cc-out').innerHTML = rows.length ? `<div class="scroll-x"><table><thead><tr><th>Model</th><th class="n">Trades</th><th class="n">Win rate</th><th class="n">Expectancy</th><th class="n">Profit factor</th><th class="n">Total</th><th>Better direction</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.s.n < 20 ? 'dim' : ''}">${statRow(r.mname, r.s, `<td>${dir(g.get(r.mname))}</td>`)}</tr>`).join('')}</tbody></table></div><p class="notice">Greyed rows have fewer than 20 matching trades.</p>` : '<p class="notice">No trades match these conditions yet.</p>';
    };
    ids.forEach((k) => $(`#cc-${k}`).addEventListener('change', run));
    run();
  }

  function playbooks(ts) {
    const g = S.groupBy(ts, (t) => t.model);
    const out = [...g.entries()].map(([model, list]) => {
      const baseS = S.summary(list, val);
      const slices = [];
      PLAYBOOK_DIMS.forEach((dim) => {
        S.groupBy(list, DIMS[dim].get).forEach((l, key) => {
          if (key === '(blank)' || key === '(none)' || key === 'None' && dim === 'macro') return;
          if (l.length >= state.minN && l.length < list.length) slices.push({ dim, key, s: S.summary(l, val) });
        });
      });
      slices.sort((a, b) => b.s.exp - a.s.exp);
      const best = slices.filter((x) => x.s.exp > baseS.exp).slice(0, 3);
      const worst = slices.filter((x) => x.s.exp < baseS.exp).slice(-3).reverse();
      const line = (x) => `<span>${esc(DIMS[x.dim].label)}: <b>${esc(x.key)}</b>, ${fmtV(x.s.exp)}, ${pct(x.s.winRate)} wins, n ${x.s.n}</span>`;
      return `<article class="pb"><h3>${esc(model)}</h3><p class="base">Overall ${fmtV(baseS.exp)} per trade over ${baseS.n} trades</p>
        ${list.length < state.minN * 2 ? `<p class="notice">Log at least ${state.minN * 2} trades for this model to see its best and worst conditions.</p>` : `<dl><dt class="best">Take more of</dt><dd>${best.map(line).join('') || '—'}</dd><dt class="worst">Avoid or size down</dt><dd>${worst.map(line).join('') || '—'}</dd></dl>`}</article>`;
    });
    return `<div class="playbook">${out.join('')}</div>`;
  }

  /* ---- Timing ---- */
  function pageTiming(ts) {
    if (!ts.length) return noTrades();
    const html = `<div class="grid">
      ${card(12, 'Expectancy by entry time', 'New York time, 15-minute buckets. Faded bars have fewer than 10 trades.', chartDiv('t-hour'))}
      ${card(6, 'By day of week', '', chartDiv('t-dow'))}
      ${card(6, 'By kill zone', '', chartDiv('t-kz'))}
      ${card(6, 'By macro window', '', chartDiv('t-macro'))}
      ${card(6, 'By session', '', chartDiv('t-session'))}
    </div>`;
    return { html, after: () => {
      barByDim($('#t-hour'), ts, 'hour', { skipBlank: true });
      barByDim($('#t-dow'), ts, 'dow');
      barByDim($('#t-kz'), ts, 'killZone');
      barByDim($('#t-macro'), ts, 'macro');
      barByDim($('#t-session'), ts, 'session');
    } };
  }

  /* ---- Setups & sessions ---- */
  function pageSetups(ts) {
    if (!ts.length) return noTrades();
    const minN = state.minN;
    // Confluence lift
    const all = [...new Set(ts.flatMap((t) => t.confluences))].sort();
    const lift = all.map((c) => {
      const w = ts.filter((t) => t.confluences.includes(c)), wo = ts.filter((t) => !t.confluences.includes(c));
      const sw = S.summary(w, val), so = S.summary(wo, val);
      return { c, sw, so, lift: sw.exp - so.exp };
    }).sort((a, b) => b.lift - a.lift);
    // Combinations of 2 and 3 confluences
    const combos = new Map();
    ts.forEach((t) => {
      const cs = t.confluences.slice().sort();
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const k2 = cs[i] + ' + ' + cs[j]; (combos.get(k2) || combos.set(k2, []).get(k2)).push(t);
        for (let k = j + 1; k < cs.length; k++) { const k3 = k2 + ' + ' + cs[k]; (combos.get(k3) || combos.set(k3, []).get(k3)).push(t); }
      }
    });
    const topCombos = [...combos.entries()].filter(([, l]) => l.length >= minN).map(([k, l]) => ({ k, s: S.summary(l, val) })).sort((a, b) => b.s.exp - a.s.exp).slice(0, 10);
    // Session interaction decision table
    const rules = new Map();
    ts.forEach((t) => (t.liquidity.length ? t.liquidity : ['(none)']).forEach((lq) => {
      const k = [lq, t.session, t.direction].join('\u0000'); if (!rules.has(k)) rules.set(k, []); rules.get(k).push(t);
    }));
    const ruleRows = [...rules.entries()].filter(([, l]) => l.length >= minN).map(([k, l]) => {
      const [lq, ses, dir] = k.split('\u0000');
      const bm = [...S.groupBy(l, (t) => t.model).entries()].filter(([, x]) => x.length >= 5).map(([mm, x]) => [mm, S.summary(x).expR]).sort((a, b) => b[1] - a[1])[0];
      return { lq, ses, dir, s: S.summary(l, val), bm };
    }).sort((a, b) => b.s.exp - a.s.exp);
    const html = `<div class="controls"><label>Minimum trades per row in the tables on this page and in the playbooks: <b id="minN-v">${minN}</b><input type="range" id="minN" min="5" max="60" value="${minN}"></label></div>
    <div class="grid">
      ${card(12, 'Session interactions', `Which liquidity was taken earlier, which session you traded and in which direction. Only combinations with at least ${minN} trades are shown, best first. Read each row as a rule: if this liquidity was taken, trade this session in this direction.`,
        ruleRows.length ? `<div class="scroll-x"><table><thead><tr><th>Liquidity taken</th><th>Session</th><th>Direction</th><th class="n">Trades</th><th class="n">Win rate</th><th class="n">Expectancy</th><th class="n">Total</th><th>Best model here</th></tr></thead><tbody>
        ${ruleRows.map((r) => `<tr><td>${esc(r.lq)}</td><td>${esc(r.ses)}</td><td>${esc(r.dir)}</td><td class="n">${r.s.n}</td><td class="n">${pct(r.s.winRate)}</td><td class="n ${cls(r.s.exp)}">${fmtV(r.s.exp)}</td><td class="n ${cls(r.s.total)}">${fmtV(r.s.total)}</td><td>${r.bm ? `${esc(r.bm[0])} (${fmtR(r.bm[1])})` : '—'}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="notice">No combination has ${minN} trades yet. Keep logging, or lower the minimum below.</p>`)}
      ${card(6, 'What each confluence adds', 'Expectancy of trades with the confluence minus trades without it. Positive lift means the confluence helps.',
        `<div class="scroll-x"><table><thead><tr><th>Confluence</th><th class="n">Trades with</th><th class="n">With</th><th class="n">Without</th><th class="n">Lift</th></tr></thead><tbody>
        ${lift.map((x) => `<tr class="${x.sw.n < minN ? 'dim' : ''}"><td>${esc(x.c)}</td><td class="n">${x.sw.n}</td><td class="n">${fmtV(x.sw.exp)}</td><td class="n">${fmtV(x.so.exp)}</td><td class="n ${cls(x.lift)}">${fmtV(x.lift)}</td></tr>`).join('')}</tbody></table></div>`)}
      ${card(6, 'Best confluence combinations', `Combinations of 2 or 3 confluences with at least ${minN} trades.`,
        topCombos.length ? `<div class="scroll-x"><table><thead><tr><th>Combination</th><th class="n">Trades</th><th class="n">Win rate</th><th class="n">Expectancy</th></tr></thead><tbody>
        ${topCombos.map((x) => `<tr><td>${esc(x.k)}</td><td class="n">${x.s.n}</td><td class="n">${pct(x.s.winRate)}</td><td class="n ${cls(x.s.exp)}">${fmtV(x.s.exp)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="notice">Not enough trades per combination yet.</p>')}
      ${card(6, 'By liquidity taken', '', chartDiv('s-liq'))}
      ${card(6, 'By PD array of entry', '', chartDiv('s-pd'))}
    </div>`;
    return { html, after: () => {
      barByDim($('#s-liq'), ts, 'liquidity', { skipBlank: true });
      barByDim($('#s-pd'), ts, 'pdArray', { skipBlank: true });
      $('#minN').addEventListener('input', (e) => { $('#minN-v').textContent = e.target.value; });
      $('#minN').addEventListener('change', (e) => { state.minN = +e.target.value; render(); });
    } };
  }

  /* ---- Execution & mindset ---- */
  function pageExecution(ts) {
    if (!ts.length) return noTrades();
    const allModes = applyFilters(state.trades, ['mode']);
    const models = [...new Set(allModes.map((t) => t.model))].sort();
    const bvp = models.map((m) => {
      const b = allModes.filter((t) => t.model === m && t.mode === 'Backtest'), p = allModes.filter((t) => t.model === m && t.mode === 'Paper');
      return { m, b: S.summary(b), p: S.summary(p) };
    }).filter((x) => x.b.n || x.p.n);
    // tilt: next trade after a win / loss
    const after = { 'After a win': [], 'After a loss': [] };
    for (let i = 1; i < ts.length; i++) { if (ts[i - 1].r > 0) after['After a win'].push(ts[i]); else if (ts[i - 1].r < 0) after['After a loss'].push(ts[i]); }
    const days = S.groupBy(ts, (t) => t.date);
    const perDay = [...days.values()].map((l) => [l.length, S.sum(l.map(val))]);
    const html = `<div class="grid">
      ${card(12, 'Backtest compared with paper trading', 'The same model in both modes. A big gap usually means hindsight in the backtest or execution problems live. Ignores the Mode filter.',
        bvp.length ? `<div class="scroll-x"><table><thead><tr><th>Model</th><th class="n">Backtest trades</th><th class="n">Backtest win rate</th><th class="n">Backtest expectancy</th><th class="n">Paper trades</th><th class="n">Paper win rate</th><th class="n">Paper expectancy</th><th class="n">Win-rate gap</th></tr></thead><tbody>
        ${bvp.map((x) => { const gap = x.p.n && x.b.n ? x.p.winRate - x.b.winRate : NaN; return `<tr><td>${esc(x.m)}</td><td class="n">${x.b.n}</td><td class="n">${x.b.n ? pct(x.b.winRate) : '—'}</td><td class="n ${cls(x.b.expR)}">${x.b.n ? fmtR(x.b.expR) : '—'}</td><td class="n">${x.p.n}</td><td class="n">${x.p.n ? pct(x.p.winRate) : '—'}</td><td class="n ${cls(x.p.expR)}">${x.p.n ? fmtR(x.p.expR) : '—'}</td><td class="n ${Math.abs(gap) > 0.1 ? 'neg' : ''}">${Number.isFinite(gap) ? (gap > 0 ? '+' : '') + (gap * 100).toFixed(0) + ' pts' : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="notice">No trades yet.</p>')}
      ${card(6, 'Stops and targets (MAE vs MFE)', 'Each dot is a trade: how far it went against you (MAE) and in your favour (MFE), in R. Many losers with high MFE suggest taking partials or moving stops earlier.', chartDiv('x-mae'))}
      ${card(6, 'By setup grade', 'If A+ setups do not beat C setups, the grading needs work.', chartDiv('x-grade'))}
      ${card(4, 'Following the plan', '', chartDiv('x-followed'))}
      ${card(4, 'Exit reason', '', chartDiv('x-exit'))}
      ${card(4, 'Logged before outcome', 'Blind-logged trades are the honest benchmark.', chartDiv('x-blind'))}
      ${card(6, 'Emotion before entry', 'Paper and live trades only.', chartDiv('x-emo'))}
      ${card(6, 'Confidence calibration', 'Win rate by your confidence score. A calibrated trader wins more often at 5 than at 2.', chartDiv('x-conf'))}
      ${card(6, 'The trade after a win or a loss', 'A drop after losses points to tilt or revenge trading.',
        `<table><thead><tr><th></th><th class="n">Trades</th><th class="n">Win rate</th><th class="n">Expectancy</th><th class="n">Profit factor</th><th class="n">Total</th></tr></thead><tbody>${Object.entries(after).map(([k, l]) => `<tr>${statRow(k, S.summary(l, val))}</tr>`).join('')}</tbody></table>`)}
      ${card(6, 'Trades per day and daily result', 'Each dot is a day. A downward slope means more trades make worse days: a sign of overtrading.', chartDiv('x-perday'))}
    </div>`;
    return { html, after: () => {
      const pts = (res) => ts.filter((t) => t.result === res && t.mae !== null && t.mfe !== null).map((t) => [t.mae, t.mfe]);
      mk($('#x-mae'), {
        legend: { top: 0, left: 'center', textStyle: { color: css('--muted') } },
        grid: { left: 28, right: 16, top: 36, bottom: 28, containLabel: true },
        tooltip: Object.assign(base().tooltip, { formatter: (p) => `${p.seriesName}<br>MAE ${p.value[0]}R, MFE ${p.value[1]}R` }),
        xAxis: { type: 'value', name: 'MAE (R)', nameLocation: 'middle', nameGap: 24, ...axisStyle() },
        yAxis: { type: 'value', name: 'MFE (R)', nameLocation: 'middle', nameGap: 30, ...axisStyle() },
        series: [
          { name: 'Wins', type: 'scatter', symbolSize: 7, data: pts('Win'), itemStyle: { color: css('--win'), opacity: 0.7 } },
          { name: 'Losses', type: 'scatter', symbolSize: 7, data: pts('Loss'), itemStyle: { color: css('--loss'), opacity: 0.7 } },
          { name: 'Breakeven', type: 'scatter', symbolSize: 7, data: pts('Breakeven'), itemStyle: { color: css('--neutral'), opacity: 0.7 } },
        ],
      });
      barByDim($('#x-grade'), ts, 'grade', { skipBlank: true });
      barByDim($('#x-followed'), ts, 'followed');
      barByDim($('#x-exit'), ts, 'exitReason', { skipBlank: true });
      barByDim($('#x-blind'), ts, 'loggedBefore');
      barByDim($('#x-emo'), ts.filter((t) => t.emoBefore), 'emoBefore', { skipBlank: true, emptyText: 'No emotions logged for these trades. Emotions are logged on paper and live trades; add Paper to the Mode filter.' });
      barByDim($('#x-conf'), ts, 'confidence', { skipBlank: true, metric: 'winRate' });
      mk($('#x-perday'), {
        grid: { left: 8, right: 16, top: 24, bottom: 28, containLabel: true },
        tooltip: Object.assign(base().tooltip, { formatter: (p) => `${p.value[0]} trades, ${fmtV(p.value[1])}` }),
        xAxis: { type: 'value', name: 'Trades that day', nameLocation: 'middle', nameGap: 24, minInterval: 1, min: 0, max: (v) => Math.max(3, v.max + 1), ...axisStyle() },
        yAxis: { type: 'value', ...axisStyle(), axisLabel: { color: css('--muted'), formatter: (v) => fmtV(v, state.unit, false) } },
        series: [{ type: 'scatter', symbolSize: 8, data: perDay, itemStyle: { color: (p) => (p.value[1] >= 0 ? css('--win') : css('--loss')), opacity: 0.6 } }],
      });
    } };
  }

  /* ---- Prop simulator ---- */
  function pageProp(ts) {
    if (!ts.length) return noTrades();
    if (!state.accounts.length) return { html: emptyState('No account settings found', '<p>Export the Accounts database from Notion as <code>accounts.csv</code> and put it in <code>backtesting/data/</code>, or load it with Load CSV.</p>') };
    const acc = state.accounts.find((a) => a.name === state.simAccount) || state.accounts[0];
    state.simAccount = acc.name;
    const missing = ['risk', 'target', 'maxDD'].filter((k) => !acc[k]);
    if (missing.length) return { html: emptyState(`${acc.name} is missing settings`, `<p>Fill in ${missing.map((k) => ({ risk: 'Risk per trade', target: 'Profit target', maxDD: 'Max drawdown' }[k])).join(', ')} in the Notion Accounts database and export again.</p>`) };
    const groups = [['All filtered trades', ts], ...[...S.groupBy(ts, (t) => t.model).entries()].sort()];
    const rows = groups.map(([name, l]) => {
      const rs = l.map((t) => t.r), mc = S.monteCarloDD(rs), sim = S.propSim(rs, { risk: acc.risk, target: acc.target, maxDD: acc.maxDD, keepPaths: 0 });
      return { name, n: l.length, exp: S.mean(rs), mc, sim, sug: S.suggestedRisk(acc.maxDD, mc.p95) };
    });
    if (!state.simModel || !groups.some(([n]) => n === state.simModel)) state.simModel = groups[1] ? groups[1][0] : groups[0][0];
    const money = (v) => (Number.isFinite(v) ? '$' + Math.round(v).toLocaleString('en-US') : '—');
    const html = `<div class="grid">
      ${card(12, 'Prop challenge simulator', `Draws trades at random from each model's results until the account reaches the profit target or the max drawdown. 2,000 runs per row. Uses a static drawdown, so a trailing drawdown will pass less often than shown.`, `
        <div class="controls"><label>Account<select id="p-acc">${state.accounts.map((a) => `<option ${a.name === acc.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
        <p class="notice">${esc(acc.name)}: ${money(acc.size)} account, ${money(acc.risk)} risk per trade, ${money(acc.target)} target, ${money(acc.maxDD)} max drawdown${acc.ddType ? ` (${esc(acc.ddType)})` : ''}. That is ${(acc.maxDD / acc.risk).toFixed(1)}R of room and a ${(acc.target / acc.risk).toFixed(1)}R target.</p>
        <div class="scroll-x" style="margin-top:12px"><table><thead><tr><th>Trades from</th><th class="n">Trades</th><th class="n">Expectancy</th><th class="n">Bad-case drawdown (95%)</th><th class="n">Suggested risk</th><th class="n">Pass rate at ${money(acc.risk)}</th><th class="n">Fail rate</th><th class="n">Median trades to pass</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.n < 100 ? 'dim' : ''}"><td>${esc(r.name)}</td><td class="n">${r.n}</td><td class="n ${cls(r.exp)}">${fmtR(r.exp)}</td><td class="n">${Number.isFinite(r.mc.p95) ? r.mc.p95.toFixed(1) + 'R' : '—'}</td><td class="n" title="${r.n < 100 ? 'Needs 100 trades; keep your account risk until then' : 'Max drawdown ÷ (bad-case drawdown × 2)'}">${r.n < 100 ? `<span class="badge">n &lt; 100</span>` : money(r.sug)}</td><td class="n ${r.sim && r.sim.passRate >= 0.5 ? 'pos' : 'neg'}">${r.sim ? pct(r.sim.passRate) : '—'}</td><td class="n">${r.sim ? pct(r.sim.failRate) : '—'}</td><td class="n">${r.sim && Number.isFinite(r.sim.medianTrades) ? Math.round(r.sim.medianTrades) : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="notice">Suggested risk = max drawdown ÷ (bad-case drawdown in R × 2). It stays hidden until a model has 100 trades. Greyed rows have fewer than 100 trades.</p>`)}
      ${card(12, '40 simulated challenges', 'Each line is one possible challenge using the selected trades, in dollars. Green lines reached the target, red lines hit the drawdown.', `
        <div class="controls"><label>Trades from<select id="p-model">${groups.map(([n]) => `<option ${n === state.simModel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>${chartDiv('p-paths', 'tall')}`)}
    </div>`;
    return { html, after: () => {
      $('#p-acc').addEventListener('change', (e) => { state.simAccount = e.target.value; render(); });
      $('#p-model').addEventListener('change', (e) => { state.simModel = e.target.value; render(); });
      const l = groups.find(([n]) => n === state.simModel)[1];
      const sim = S.propSim(l.map((t) => t.r), { risk: acc.risk, target: acc.target, maxDD: acc.maxDD, keepPaths: 40, iters: 200 });
      const longest = Math.max(...sim.paths.map((p) => p.path.length));
      mk($('#p-paths'), {
        tooltip: { show: false },
        grid: { left: 8, right: 90, top: 24, bottom: 28, containLabel: true },
        xAxis: { type: 'value', name: 'Trade number', nameLocation: 'middle', nameGap: 24, max: Math.ceil(longest / 25) * 25, ...axisStyle() },
        yAxis: { type: 'value', min: -Math.ceil((acc.maxDD * 1.1) / 500) * 500, max: Math.ceil((acc.target * 1.12) / 500) * 500, ...axisStyle(), axisLabel: { color: css('--muted'), formatter: (v) => fmtV(v, '$', false) } },
        series: sim.paths.map((p, i) => ({
          type: 'line', showSymbol: false, silent: true, data: p.path.map((y, x) => [x, y]),
          lineStyle: { width: 1.2, color: p.outcome === 'pass' ? css('--win') : p.outcome === 'fail' ? css('--loss') : css('--neutral'), opacity: 0.55 },
          markLine: i === 0 ? { silent: true, symbol: 'none', label: { color: css('--muted'), formatter: '{b}' }, lineStyle: { color: css('--ink'), type: 'dashed' }, data: [{ yAxis: acc.target, name: 'Target' }, { yAxis: -acc.maxDD, name: 'Max drawdown' }] } : undefined,
        })),
      });
    } };
  }

  /* ---- Trade log ---- */
  function tradeTable(list, sortable = true) {
    const cols = [['date', 'Date'], ['model', 'Model'], ['instrument', 'Inst.'], ['session', 'Session'], ['direction', 'Dir.'], ['result', 'Result'], ['r', 'R', 'n'], ['val', state.unit === 'R' ? 'Result' : state.unit, 'n'], ['grade', 'Grade'], ['followed', 'Plan'], ['shot', '']];
    const ts = state.tradeSort;
    const pill = (r) => `<span class="pill ${r === 'Win' ? 'win' : r === 'Loss' ? 'loss' : 'be'}">${esc(r)}</span>`;
    return `<div class="scroll-x"><table><thead><tr>${cols.filter((c) => !(c[0] === 'val' && state.unit === 'R')).map(([k, l, n]) => `<th class="${n || ''} ${sortable && k !== 'shot' ? 'sort' : ''}" data-sort="${k}" ${sortable && ts.key === k ? `aria-sort="${ts.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${l}</th>`).join('')}</tr></thead><tbody>
      ${list.map((t) => `<tr><td class="num">${t.date}${t.entryTime !== null ? ' ' + t.hour.slice(0, 2) + ':' + String(t.entryTime % 60).padStart(2, '0') : ''}</td><td>${esc(t.model)}${t.version ? ` <span class="badge">${esc(t.version)}</span>` : ''}</td><td>${esc(t.instrument)}</td><td>${esc(t.session)}</td><td>${esc(t.direction)}</td><td>${pill(t.result)}</td><td class="n ${cls(t.r)}">${fmtR(t.r)}</td>${state.unit === 'R' ? '' : `<td class="n ${cls(val(t))}">${fmtV(val(t))}</td>`}<td>${esc(t.grade)}</td><td>${t.followed ? 'Followed' : '<span class="neg">Broke</span>'}</td><td>${t.shotBefore ? `<a href="${esc(t.shotBefore)}" target="_blank" rel="noopener">Chart</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  function pageTrades(ts) {
    const q = state.tradeSearch.toLowerCase();
    let list = q ? ts.filter((t) => [t.id, t.title, t.model, t.notes, t.instrument, t.session, t.liquidity.join(' '), t.confluences.join(' ')].join(' ').toLowerCase().includes(q)) : ts.slice();
    const { key, dir } = state.tradeSort;
    const get = (t) => (key === 'val' ? val(t) : key === 'date' ? t.date + String(t.entryTime ?? 0).padStart(4, '0') : t[key]);
    list.sort((a, b) => { const x = get(a), y = get(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
    const shown = list.slice(0, state.tradeLimit);
    const html = `<div class="card">
      <div class="controls"><label style="flex:1;min-width:220px">Search trades<input type="search" id="tr-search" value="${esc(state.tradeSearch)}" placeholder="ID, model, notes, confluence…"></label>
      <button class="btn" id="tr-export">Download ${list.length} trades as CSV</button></div>
      ${list.length ? tradeTable(shown) : '<p class="notice">No trades match.</p>'}
      ${list.length > shown.length ? `<div class="more"><button class="btn" id="tr-more">Show 50 more (${list.length - shown.length} hidden)</button></div>` : ''}
    </div>`;
    return { html, after: () => {
      const s = $('#tr-search');
      s.addEventListener('input', () => { state.tradeSearch = s.value; state.tradeLimit = 50; const pos = s.selectionStart; render(); const n = $('#tr-search'); n.focus(); n.setSelectionRange(pos, pos); });
      document.querySelectorAll('th.sort').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.sort; state.tradeSort = { key: k, dir: state.tradeSort.key === k ? -state.tradeSort.dir : -1 }; render(); }));
      $('#tr-more')?.addEventListener('click', () => { state.tradeLimit += 50; render(); });
      $('#tr-export').addEventListener('click', () => {
        const csv = Papa.unparse(list.map((t) => ({ ID: t.id, Date: t.date, 'Entry time': t.hour, Model: t.model, Version: t.version, Mode: t.mode, Instrument: t.instrument, Session: t.session, 'Kill zone': t.killZone, Direction: t.direction, 'HTF bias': t.bias, Result: t.result, 'R multiple': t.r, 'Risk ($)': riskOf(t), 'Setup grade': t.grade, 'Followed plan': t.followed ? 'Yes' : 'No', Confluences: t.confluences.join(', '), 'Liquidity taken': t.liquidity.join(', ') })));
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'filtered-trades.csv'; a.click(); URL.revokeObjectURL(a.href);
      });
    } };
  }

  /* ---- Data health ---- */
  function pageHealth() {
    const errors = state.issues.filter((i) => i.level === 'error'), warns = state.issues.filter((i) => i.level === 'warn');
    const html = `<div class="grid">
      ${card(12, 'Data health', `${state.totalRows} rows read from ${esc(state.source)}. ${state.trades.length} trades used, ${state.totalRows - state.trades.length} excluded. ${state.accounts.length} account${state.accounts.length === 1 ? '' : 's'} loaded.`,
        state.issues.length ? `<div class="scroll-x"><table><thead><tr><th>Level</th><th>CSV row</th><th>Trade ID</th><th>Problem</th></tr></thead><tbody>
        ${state.issues.slice(0, 500).map((i) => `<tr class="issue-${i.level}"><td>${i.level === 'error' ? 'Excluded' : 'Check'}</td><td class="n">${i.row}</td><td>${esc(i.id)}</td><td>${esc(i.msg)}</td></tr>`).join('')}</tbody></table></div>
        <p class="notice">${errors.length} rows excluded (missing date, R multiple or model), ${warns.length} warnings. Fix them in Notion, export again and reload.</p>`
        : '<p class="notice">No problems found. Every row has its required fields and consistent results.</p>')}
      ${card(12, 'How to update the data', '', `<ol>
        <li>In Notion, open each database (Trades, Accounts), click ⋯ then Export, choose <b>Markdown &amp; CSV</b> and <b>Current view</b>.</li>
        <li>Unzip and rename the files to <code>trades.csv</code> and <code>accounts.csv</code>.</li>
        <li>Put them in <code>backtesting/data/</code> and push to GitHub. Pages redeploys in about a minute.</li>
        <li>For a quick private look, use <b>Load CSV</b> at the top instead. Nothing is uploaded; the data stays in this tab.</li></ol>`)}
    </div>`;
    return { html };
  }

  function noTrades() {
    return { html: emptyState('No trades match these filters', '<p>Widen the period or remove a filter chip above.</p>') };
  }

  /* ================= SHELL ================= */

  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${state.tab === k}" tabindex="${state.tab === k ? 0 : -1}">${l}</button>`).join('');
    $('#tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; state.cell = null; update(); }));
    $('#tabs').onkeydown = (e) => {
      if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
      const i = TABS.findIndex(([k]) => k === state.tab), j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      state.tab = TABS[j][0]; update(); $(`#tabs [data-tab="${state.tab}"]`).focus();
    };
  }

  function renderFilters() {
    const counts = (dim) => { const m = new Map(); state.trades.forEach((t) => { let v = DIMS[dim].get(t); (Array.isArray(v) ? v : [v === '' ? '(blank)' : v]).forEach((x) => m.set(x, (m.get(x) || 0) + 1)); }); return m; };
    $('#filterControls').innerHTML = FILTER_DIMS.map((dim) => {
      const m = counts(dim);
      const keys = sortKeys(dim, [...m.keys()]).filter((k) => k !== '(blank)' || m.size > 1);
      if (keys.length < 2 && !(state.filters[dim] || []).length) return '';
      const sel = state.filters[dim] || [];
      return `<section class="fgroup"><h3>${DIMS[dim].label}</h3><div class="opts">${keys.map((k) => `<button class="opt" data-dim="${dim}" data-val="${esc(k)}" aria-pressed="${sel.includes(k)}" title="${m.get(k) || 0} trades">${esc(k)}</button>`).join('')}</div>${DIMS[dim].multi ? '<p class="fhint">Trades must have all selected.</p>' : ''}</section>`;
    }).join('');
    $('#filterControls').querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
      const { dim, val: v } = b.dataset, cur = new Set(state.filters[dim] || []);
      cur.has(v) ? cur.delete(v) : cur.add(v);
      state.filters[dim] = [...cur];
      update();
    }));
    $('#datePreset').value = state.datePreset;
    $('#dateFrom').value = state.datePreset === 'custom' ? state.from : dateBounds()[0].replace('0000', '');
    $('#dateTo').value = state.datePreset === 'custom' ? state.to : dateBounds()[1].replace('9999', '');
  }

  function renderChips() {
    const chips = [];
    if (state.datePreset !== 'all') {
      const [a, b] = dateBounds();
      chips.push(`<span class="chip">${state.datePreset === 'custom' ? `${a === '0000' ? 'Start' : a} to ${b === '9999' ? 'today' : b}` : $('#datePreset').selectedOptions[0].textContent}<button data-chip="date" aria-label="Remove period filter">✕</button></span>`);
    }
    Object.entries(state.filters).forEach(([k, vals]) => vals.forEach((v) => chips.push(`<span class="chip">${esc(DIMS[k].label)}: ${esc(v)}<button data-chip="${k}" data-v="${esc(v)}" aria-label="Remove ${esc(v)}">✕</button></span>`)));
    $('#chips').innerHTML = chips.join('');
    $('#filterCount').textContent = chips.length || '';
    $('#chips').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.chip === 'date') { state.datePreset = 'all'; state.from = state.to = ''; }
      else state.filters[b.dataset.chip] = state.filters[b.dataset.chip].filter((x) => x !== b.dataset.v);
      update();
    }));
  }

  function render() {
    disposeCharts();
    const ts = applyFilters(state.trades);
    const pages = { overview: pageOverview, conditions: pageConditions, timing: pageTiming, setups: pageSetups, execution: pageExecution, prop: pageProp, trades: pageTrades, health: pageHealth };
    const out = state.trades.length || state.tab === 'health' ? pages[state.tab](ts) : { html: emptyState('No trades loaded', '<p>Put your Notion export at <code>backtesting/data/trades.csv</code>, or use Load CSV at the top.</p>') };
    $('#view').innerHTML = out.html;
    if (out.after) out.after();
    document.querySelectorAll('.seg [data-unit]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unit === state.unit)));
    $('.seg [data-unit="%"]').disabled = !state.accounts.some((a) => a.size);
    $('.seg [data-unit="$"]').disabled = !state.trades.some((t) => t.risk !== null) && !state.accounts.some((a) => a.risk);
  }

  function update() {
    renderTabs(); renderFilters(); renderChips(); render(); writeHash();
  }

  function setSource() {
    const issues = state.issues.length ? ` ${state.issues.length} data warnings, see Data health.` : '';
    $('#source').textContent = `${state.trades.length} trades from ${state.source}.${issues}`;
  }

  function defaultFilters() {
    state.filters = {};
    if (state.trades.some((t) => t.mode === 'Backtest')) state.filters.mode = ['Backtest'];
    if (state.trades.some((t) => t.taken === 'Skipped')) state.filters.taken = ['Taken'];
  }

  /* ---------- Loading ---------- */
  async function loadSchema() {
    const fallback = { dateOrder: 'MDY', files: { trades: ['data/trades.csv', 'data/sample/trades.csv'], accounts: ['data/accounts.csv', 'data/sample/accounts.csv'] } };
    try { const r = await fetch('schema.json', { cache: 'no-store' }); if (r.ok) return Object.assign(fallback, await r.json()); } catch (e) { /* use embedded */ }
    if (window.TB_SCHEMA) return Object.assign(fallback, window.TB_SCHEMA);
    throw new Error('schema.json not found');
  }

  function ingest(kind, rows, label) {
    if (kind === 'trades') {
      const res = D.normalizeTrades(rows, state.schema);
      state.trades = res.trades; state.issues = res.issues; state.totalRows = res.total; state.source = label;
    } else if (kind === 'accounts') {
      state.accounts = D.normalizeAccounts(rows, state.schema);
    }
  }

  async function init() {
    const saved = (() => { try { return localStorage.getItem('tb-theme'); } catch (e) { return null; } })();
    if (saved) document.documentElement.dataset.theme = saved;
    try {
      state.schema = await loadSchema();
    } catch (e) {
      $('#view').innerHTML = emptyState('Setup problem', '<p>schema.json is missing next to index.html.</p>'); return;
    }
    if (window.TB_EMBEDDED) {
      ingest('trades', D.parseCsvText(window.TB_EMBEDDED.trades), 'sample data (embedded preview)');
      ingest('accounts', D.parseCsvText(window.TB_EMBEDDED.accounts), '');
    } else {
      const tr = await D.fetchFirst(state.schema.files.trades);
      if (tr) ingest('trades', D.parseCsvText(tr.text), tr.path.includes('sample') ? 'sample data (data/sample). Add your export at data/trades.csv' : tr.path);
      const ac = await D.fetchFirst(state.schema.files.accounts);
      if (ac) ingest('accounts', D.parseCsvText(ac.text), '');
    }
    if (!readHash()) defaultFilters();
    setSource();
    update();
  }

  /* ---------- Global controls ---------- */
  document.querySelectorAll('.seg [data-unit]').forEach((b) => b.addEventListener('click', () => { state.unit = b.dataset.unit; update(); }));
  $('#themeToggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('tb-theme', document.documentElement.dataset.theme); } catch (e) { /* private mode */ }
    render();
  });
  $('#datePreset').addEventListener('change', (e) => { state.datePreset = e.target.value; if (state.datePreset === 'custom' && !state.from) { state.from = $('#dateFrom').value; state.to = $('#dateTo').value; } update(); });
  ['dateFrom', 'dateTo'].forEach((id) => $('#' + id).addEventListener('change', () => { state.datePreset = 'custom'; state.from = $('#dateFrom').value; state.to = $('#dateTo').value; update(); }));
  $('#resetFilters').addEventListener('click', () => { defaultFilters(); state.datePreset = 'all'; state.from = state.to = ''; update(); });
  $('#fileInput').addEventListener('change', async (e) => {
    const names = [];
    for (const f of e.target.files) {
      const rows = D.parseCsvText(await f.text());
      const kind = D.detectKind(rows, state.schema);
      if (kind) { ingest(kind, rows, `${f.name} (loaded in this tab, not saved)`); names.push(f.name); }
      else alert(`${f.name} does not look like a Trades or Accounts export. Its columns did not match schema.json.`);
    }
    e.target.value = '';
    if (names.length) { defaultFilters(); setSource(); update(); }
  });
  const drawer = $('#filters');
  $('#openFilters').addEventListener('click', () => { drawer.classList.add('open'); $('#openFilters').setAttribute('aria-expanded', 'true'); $('#closeFilters').focus(); });
  $('#closeFilters').addEventListener('click', () => { drawer.classList.remove('open'); $('#openFilters').setAttribute('aria-expanded', 'false'); $('#openFilters').focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('open')) $('#closeFilters').click(); });

  window.addEventListener('hashchange', () => { if (!readHash()) defaultFilters(); update(); });

  init();
})();
