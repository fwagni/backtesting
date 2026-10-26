/* stats.js — every metric the dashboard shows. Pure functions, no DOM. */
(function () {
  const TB = (window.TB = window.TB || {});

  /** Seeded RNG so simulations give the same numbers on every redraw. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /** Largest peak-to-trough fall of a running total, as a positive number. */
  function maxDrawdown(values) {
    let eq = 0, peak = 0, dd = 0;
    for (const v of values) { eq += v; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
    return dd;
  }

  function longestLosingStreak(trades) {
    let cur = 0, best = 0;
    for (const t of trades) {
      if (t.r < 0) { cur++; best = Math.max(best, cur); } else if (t.r > 0) cur = 0;
    }
    return best;
  }

  /**
   * Summary of a set of trades. `val` converts a trade to the display unit (R, $ or %).
   * Win rate counts breakevens in the denominator.
   */
  function summary(trades, val = (t) => t.r) {
    const n = trades.length;
    const rs = trades.map((t) => t.r);
    const vs = trades.map(val);
    const wins = trades.filter((t) => t.r > 0), losses = trades.filter((t) => t.r < 0);
    const gp = sum(wins.map(val)), gl = -sum(losses.map(val));
    const planned = trades.map((t) => t.plannedRR).filter((x) => x !== null);
    return {
      n,
      wins: wins.length,
      losses: losses.length,
      breakeven: n - wins.length - losses.length,
      winRate: n ? wins.length / n : 0,
      expR: mean(rs),
      exp: mean(vs),
      total: sum(vs),
      totalR: sum(rs),
      pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
      maxDD: maxDrawdown(vs),
      maxDDR: maxDrawdown(rs),
      streak: longestLosingStreak(trades),
      avgWinR: mean(wins.map((t) => t.r)),
      avgPlannedRR: mean(planned),
      adherence: n ? trades.filter((t) => t.followed).length / n : 0,
    };
  }

  /** 95% bootstrap interval of the mean R. */
  function bootstrapCI(rs, iters = 1000, seed = 42) {
    if (rs.length < 2) return [NaN, NaN];
    const rand = rng(seed), n = rs.length, means = new Array(iters);
    for (let i = 0; i < iters; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += rs[(rand() * n) | 0];
      means[i] = s / n;
    }
    means.sort((a, b) => a - b);
    return [quantile(means, 0.025), quantile(means, 0.975)];
  }

  /**
   * Group trades by a key. The key function may return an array (multi-select
   * properties): the trade then counts once in every group it belongs to.
   */
  function groupBy(trades, keyFn) {
    const m = new Map();
    for (const t of trades) {
      let k = keyFn(t);
      const keys = Array.isArray(k) ? (k.length ? k : ['(none)']) : [k === '' || k === null || k === undefined ? '(blank)' : k];
      for (const key of keys) {
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(t);
      }
    }
    return m;
  }

  /** Reshuffle the order of R results to see how deep drawdowns can realistically get. */
  function monteCarloDD(rs, iters = 1000, seed = 7) {
    if (rs.length < 2) return { p50: NaN, p95: NaN };
    const rand = rng(seed), a = rs.slice(), dds = [];
    for (let i = 0; i < iters; i++) {
      for (let j = a.length - 1; j > 0; j--) { const k = (rand() * (j + 1)) | 0; [a[j], a[k]] = [a[k], a[j]]; }
      dds.push(maxDrawdown(a));
    }
    dds.sort((x, y) => x - y);
    return { p50: quantile(dds, 0.5), p95: quantile(dds, 0.95) };
  }

  /**
   * Prop-challenge simulation: draw trades at random (with replacement) from the
   * model's R results until the account hits the profit target or the max drawdown.
   * Static drawdown only; trailing drawdown is stricter than this estimate.
   */
  function propSim(rs, opts) {
    const { risk, target, maxDD, iters = 2000, maxTrades = 600, seed = 11, keepPaths = 40 } = opts;
    if (!rs.length || !risk || !target || !maxDD) return null;
    const rand = rng(seed);
    let pass = 0, fail = 0;
    const tradesToPass = [], paths = [];
    for (let i = 0; i < iters; i++) {
      let eq = 0, peak = 0, k = 0, outcome = 'open';
      const path = i < keepPaths ? [0] : null;
      while (k < maxTrades) {
        eq += rs[(rand() * rs.length) | 0] * risk;
        k++;
        if (path) path.push(eq);
        peak = Math.max(peak, eq);
        if (eq >= target) { outcome = 'pass'; break; }
        if (eq <= -maxDD) { outcome = 'fail'; break; }
      }
      if (outcome === 'pass') { pass++; tradesToPass.push(k); }
      else if (outcome === 'fail') fail++;
      if (path) paths.push({ path, outcome });
    }
    tradesToPass.sort((a, b) => a - b);
    return {
      passRate: pass / iters,
      failRate: fail / iters,
      medianTrades: tradesToPass.length ? quantile(tradesToPass, 0.5) : NaN,
      paths,
    };
  }

  /** Risk that fits the drawdown twice over the model's bad-case (95th pct) drawdown. */
  function suggestedRisk(maxDDDollars, ddP95R) {
    if (!maxDDDollars || !ddP95R || !Number.isFinite(ddP95R)) return NaN;
    return maxDDDollars / (ddP95R * 2);
  }

  TB.stats = { rng, sum, mean, quantile, maxDrawdown, longestLosingStreak, summary, bootstrapCI, groupBy, monteCarloDD, propSim, suggestedRisk };
})();
