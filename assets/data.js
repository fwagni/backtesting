/* data.js — load Notion CSV exports, normalize them, report data problems. */
(function () {
  const TB = (window.TB = window.TB || {});

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = (n) => String(n).padStart(2, '0');

  /** "Name (https://www.notion.so/...)" → "Name". Works on comma-joined lists too. */
  const stripUrls = (s) => String(s || '').replace(/\s*\((?:https?:\/\/|www\.)[^)]*\)/g, '').trim();
  const list = (s) => stripUrls(s).split(',').map((x) => x.trim()).filter(Boolean);
  const text = (s) => stripUrls(s);
  function num(s) {
    if (s === undefined || s === null) return null;
    const t = String(s).replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    if (t === '' || t === '-') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const bool = (s) => /^(yes|true|1|✓|__yes__)$/i.test(String(s || '').trim());

  /** Accepts "October 26, 2026", "2026-10-26", "2026/10/26", "10/26/2026", "26/10/2026" (+ trailing time). */
  function parseDate(s, order) {
    s = String(s || '').trim();
    if (!s) return null;
    s = s.replace(/\s*→.*$/, ''); // date ranges: keep the start
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
      const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
      if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(m[2])}`;
    }
    m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})/); // 26 October 2026
    if (m) {
      const mi = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3)));
      if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(m[1])}`;
    }
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (m) {
      let a = +m[1], b = +m[2];
      const dmy = order === 'DMY' || a > 12;
      const [mo, d] = dmy && b <= 12 ? [b, a] : [a, b];
      return `${m[3]}-${pad(mo)}-${pad(d)}`;
    }
    return null;
  }

  /** "09:52", "9:52 AM" → minutes after midnight. */
  function parseTime(s) {
    const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
    if (!m) return null;
    let h = +m[1];
    const ap = (m[3] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    return h * 60 + +m[2];
  }

  const dowOf = (iso) => DOW[new Date(iso + 'T12:00:00Z').getUTCDay()];

  function normalizeTrades(rows, schema) {
    const F = schema.trades;
    const get = (row, k) => (row[F[k]] !== undefined ? row[F[k]] : '');
    const issues = [];
    const seen = new Map();
    const trades = [];
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const missingCols = schema.required.filter((k) => !headers.includes(F[k]));
    if (rows.length && missingCols.length) {
      issues.push({ level: 'error', row: '—', id: '—', msg: `Missing columns: ${missingCols.map((k) => F[k]).join(', ')}. Check the export view shows every property, or update schema.json.` });
    }

    rows.forEach((row, i) => {
      const line = i + 2;
      const t = {
        id: text(get(row, 'id')) || `row-${line}`,
        title: text(get(row, 'title')),
        mode: text(get(row, 'mode')),
        model: list(get(row, 'model'))[0] || '',
        version: text(get(row, 'version')),
        account: list(get(row, 'account'))[0] || '',
        instrument: text(get(row, 'instrument')),
        date: parseDate(get(row, 'date'), schema.dateOrder),
        entryTime: parseTime(get(row, 'entryTime')),
        exitTime: parseTime(get(row, 'exitTime')),
        session: text(get(row, 'session')),
        killZone: text(get(row, 'killZone')),
        macro: text(get(row, 'macro')),
        direction: text(get(row, 'direction')),
        bias: text(get(row, 'bias')),
        biasTf: text(get(row, 'biasTf')),
        setupTf: text(get(row, 'setupTf')),
        entryTf: text(get(row, 'entryTf')),
        dailyProfile: text(get(row, 'dailyProfile')),
        asiaRange: text(get(row, 'asiaRange')),
        liquidity: list(get(row, 'liquidity')),
        confluences: list(get(row, 'confluences')),
        pdArray: text(get(row, 'pdArray')),
        premDisc: text(get(row, 'premDisc')),
        news: text(get(row, 'news')),
        plannedRR: num(get(row, 'plannedRR')),
        result: text(get(row, 'result')),
        r: num(get(row, 'r')),
        risk: num(get(row, 'risk')),
        mae: num(get(row, 'mae')),
        mfe: num(get(row, 'mfe')),
        exitReason: text(get(row, 'exitReason')),
        taken: text(get(row, 'taken')) || 'Taken',
        followed: bool(get(row, 'followed')),
        loggedBefore: bool(get(row, 'loggedBefore')),
        grade: text(get(row, 'grade')),
        confidence: text(get(row, 'confidence')),
        emoBefore: text(get(row, 'emoBefore')),
        emoDuring: text(get(row, 'emoDuring')),
        emoAfter: text(get(row, 'emoAfter')),
        mistakes: list(get(row, 'mistakes')),
        shotBefore: String(get(row, 'shotBefore') || '').trim(),
        shotAfter: String(get(row, 'shotAfter') || '').trim(),
        notes: text(get(row, 'notes')),
        line,
      };
      t.dow = t.date ? dowOf(t.date) : text(get(row, 'dow'));
      t.withBias = t.bias === 'Neutral' || !t.bias ? 'Neutral bias'
        : (t.direction === 'Long') === (t.bias === 'Bullish') ? 'With bias' : 'Against bias';
      t.hour = t.entryTime === null ? '' : `${pad(Math.floor(t.entryTime / 60))}:${pad(Math.floor((t.entryTime % 60) / 15) * 15)}`;
      t.month = t.date ? t.date.slice(0, 7) : '';

      const problems = [];
      schema.required.forEach((k) => {
        const v = t[k];
        if (v === null || v === '' || v === undefined) problems.push(`missing ${F[k]}`);
      });
      if (get(row, 'date') && !t.date) problems.push(`unreadable date "${get(row, 'date')}"`);
      const fatal = !t.date || t.r === null || !t.model;
      Object.entries(schema.allowed || {}).forEach(([k, vals]) => {
        if (t[k] && !vals.includes(t[k])) issues.push({ level: 'warn', row: line, id: t.id, msg: `Unknown ${F[k]} value "${t[k]}"` });
      });
      if (t.r !== null && t.result) {
        if (t.result === 'Win' && t.r <= 0) issues.push({ level: 'warn', row: line, id: t.id, msg: `Result is Win but R multiple is ${t.r}` });
        if (t.result === 'Loss' && t.r >= 0) issues.push({ level: 'warn', row: line, id: t.id, msg: `Result is Loss but R multiple is ${t.r}` });
      }
      if (seen.has(t.id)) issues.push({ level: 'warn', row: line, id: t.id, msg: `Duplicate ID (also row ${seen.get(t.id)})` });
      seen.set(t.id, line);
      if (problems.length) issues.push({ level: fatal ? 'error' : 'warn', row: line, id: t.id, msg: (fatal ? 'Excluded: ' : '') + problems.join(', ') });
      if (!fatal) trades.push(t);
    });
    trades.sort((a, b) => (a.date + pad3(a.entryTime)).localeCompare(b.date + pad3(b.entryTime)));
    return { trades, issues, total: rows.length };
  }
  const pad3 = (m) => String(m === null ? 9999 : m).padStart(4, '0');

  function normalizeAccounts(rows, schema) {
    const F = schema.accounts;
    return rows.map((row) => ({
      name: text(row[F.name]),
      type: text(row[F.type]),
      size: num(row[F.size]),
      risk: num(row[F.risk]),
      target: num(row[F.target]),
      dailyLoss: num(row[F.dailyLoss]),
      maxDD: num(row[F.maxDD]),
      ddType: text(row[F.ddType]),
      minDays: num(row[F.minDays]),
    })).filter((a) => a.name);
  }

  function parseCsvText(csvText) {
    const res = Papa.parse(csvText.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
    return res.data;
  }

  /** Which kind of export is this file? Decided by its headers. */
  function detectKind(rows, schema) {
    const h = rows.length ? Object.keys(rows[0]) : [];
    if (h.includes(schema.trades.r) || h.includes(schema.trades.result)) return 'trades';
    if (h.includes(schema.accounts.size) || h.includes(schema.accounts.maxDD)) return 'accounts';
    return null;
  }

  async function fetchFirst(paths) {
    for (const p of paths) {
      try {
        const res = await fetch(p, { cache: 'no-store' });
        if (res.ok) return { path: p, text: await res.text() };
      } catch (e) { /* try the next path */ }
    }
    return null;
  }

  TB.data = { parseDate, parseTime, stripUrls, list, num, bool, normalizeTrades, normalizeAccounts, parseCsvText, detectKind, fetchFirst };
})();
