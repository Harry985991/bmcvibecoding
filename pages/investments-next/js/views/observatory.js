(() => {
  'use strict';

  const PROXY = (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');
  const PRIVACY_KEY = 'next.observatory.privacy';
  const TIER_LABEL = { core: '核心', satellite: '衛星', tactical: '偵查／策略外', experiment: '實驗 B' };
  const STOP_LOSS_PCT = -10;
  const state = { privacy: false, snapshot: null, flow: null, ohlcv: {}, error: '' };
  const TIER_ORDER = ['core', 'satellite', 'experiment', 'tactical'];

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  function isPrivacy() {
    try { return localStorage.getItem(PRIVACY_KEY) === '1'; } catch { return state.privacy; }
  }

  function setPrivacy(on) {
    state.privacy = Boolean(on);
    try { localStorage.setItem(PRIVACY_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    const btn = $('observatory-privacy');
    if (btn) btn.textContent = `隱私模式：${on ? '開' : '關'}`;
  }

  function money(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    if (isPrivacy()) return '***';
    return Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  }

  function num(value, digits = 2) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('zh-TW', { maximumFractionDigits: digits });
  }

  function levelClass(level) {
    if (level === 'red') return 'merge-level red';
    if (level === 'amber' || level === 'warn') return 'merge-level amber';
    if (level === 'missing') return 'merge-level missing';
    return 'merge-level green';
  }

  function normalizeTier(row) {
    const symbol = String(row.stock?.symbol || '').trim().toUpperCase();
    const pools = typeof computeCapitalPools === 'function'
      ? computeCapitalPools(calculatePortfolioSummary())
      : { experimentSymbols: new Set() };
    if (pools.experimentSymbols?.has(symbol)) return 'experiment';
    const label = typeof getStockLabel === 'function' ? getStockLabel(row.stock.id) : {};
    const raw = String(label.tier || row.stock?.tier || '').toLowerCase();
    if (raw === 'core' || raw.includes('核心')) return 'core';
    if (raw === 'satellite' || raw.includes('衛星')) return 'satellite';
    return 'tactical';
  }

  function fillProbBuy(limit, low, close) {
    if (low == null) return 50;
    if (limit >= close) return 85;
    if (limit >= low) return 60;
    return 30;
  }

  function fillProbSell(limit, high, close) {
    if (high == null) return 50;
    if (limit <= close) return 85;
    if (limit <= high) return 60;
    return 30;
  }

  function qtyText(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    if (isPrivacy()) return '***';
    return Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  }

  function pctHtml(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const cls = value >= 0 ? 'market-monitor-up' : 'market-monitor-down';
    const sign = value >= 0 ? '+' : '';
    return `<span class="${cls}">${sign}${Number(value).toFixed(digits)}%</span>`;
  }

  function ohlcvFor(symbol) {
    return state.ohlcv[String(symbol || '').toUpperCase()] || {};
  }

  function heldHoldingRows() {
    try {
      const summary = calculatePortfolioSummary();
      const total = Number(summary.totalAssets) || 0;
      return (summary.heldRows || []).map((row) => {
        const symbol = String(row.stock?.symbol || '').toUpperCase();
        const bar = ohlcvFor(symbol);
        const close = Number(bar.close);
        const pnlPct = (Number.isFinite(close) && row.avgCost > 0)
          ? ((close - row.avgCost) / row.avgCost) * 100
          : null;
        return {
          symbol,
          name: row.stock?.name || '',
          tier: normalizeTier(row),
          qty: row.qty,
          avgCost: row.avgCost,
          weightPct: total > 0 ? (row.marketValue / total) * 100 : null,
          bar,
          pnlPct
        };
      }).sort((a, b) => {
        const ai = TIER_ORDER.indexOf(a.tier);
        const bi = TIER_ORDER.indexOf(b.tier);
        if (ai !== bi) return ai - bi;
        return a.symbol.localeCompare(b.symbol, 'zh-Hant');
      });
    } catch {
      return [];
    }
  }

  function renderHoldingsTable() {
    const rows = heldHoldingRows();
    const dates = [...new Set(rows.map((row) => row.bar.prev_date).filter(Boolean))];
    const dateNote = dates.length === 1
      ? `資料日 ${dates[0]}`
      : (dates.length ? `資料日 ${dates.join('、')}` : '最近一個交易日');
    if (!rows.length) {
      return `<section class="merge-card" style="margin-top:14px">
        <div class="merge-kicker">持股前一日技術</div>
        <p class="mini muted">目前沒有持股列可顯示。</p>
      </section>`;
    }
    return `<section class="merge-card" style="margin-top:14px">
      <div class="merge-kicker">持股前一日技術</div>
      <p class="mini muted">${escapeHtml(dateNote)} 的開／高／低／收。股數與均價只讀本頁資料。</p>
      <div class="market-monitor-table-wrap">
        <table class="market-monitor-table">
          <thead><tr>
            <th>代號</th><th>名稱</th><th>層別</th><th>股數</th><th>均價</th>
            <th>開</th><th>高</th><th>低</th><th>收</th><th>損益%</th><th>漲跌</th><th>權重</th>
          </tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.symbol)}</td>
              <td>${escapeHtml(row.name)}</td>
              <td>${escapeHtml(TIER_LABEL[row.tier] || row.tier)}</td>
              <td>${qtyText(row.qty)}</td>
              <td>${isPrivacy() ? '***' : num(row.avgCost)}</td>
              <td>${num(row.bar.open)}</td>
              <td>${num(row.bar.high)}</td>
              <td>${num(row.bar.low)}</td>
              <td>${num(row.bar.close)}</td>
              <td>${pctHtml(row.pnlPct)}</td>
              <td>${pctHtml(row.bar.change_pct)}</td>
              <td>${row.weightPct == null ? '—' : `${num(row.weightPct, 1)}%`}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    </section>`;
  }

  function buildRecommendations(snapshot) {
    const summary = calculatePortfolioSummary();
    const bias = snapshot?.scenario_bias;
    const overheated = snapshot?.overheat?.level === 'red';
    const fillCap = snapshot?.fill_window?.range?.[1] || 30000;
    return (summary.heldRows || []).map((row) => {
      const symbol = String(row.stock?.symbol || '').toUpperCase();
      const bar = ohlcvFor(symbol);
      const close = Number(bar.close ?? row.price);
      const tier = normalizeTier(row);
      const low = Number.isFinite(Number(bar.low)) ? Number(bar.low) : close;
      const high = Number.isFinite(Number(bar.high)) ? Number(bar.high) : close;
      let action = '續抱';
      let rationale = '';
      let limit = null;
      let fillProb = null;
      let estAmount = null;
      if (!Number.isFinite(close)) {
        action = '資料缺';
        rationale = '本頁沒有可用現價，暫不建議';
      } else if (tier === 'core') {
        if (bias != null && bias <= -0.3) {
          action = '買（逢低加碼）';
          limit = Number((close * 0.99).toFixed(2));
          fillProb = fillProbBuy(limit, low, close);
          estAmount = Math.round(limit * Math.max(0, Math.floor(fillCap / limit)));
          rationale = `偏空情境（bias ${bias}），核心買黑，掛前收 -1%`;
        } else if (bias != null && bias >= 0.5 && overheated) {
          action = '賣（部分了結）';
          limit = Number((close * 1.01).toFixed(2));
          fillProb = fillProbSell(limit, high, close);
          rationale = '市場過熱且偏多，核心可考慮極小部分了結';
        } else {
          rationale = `情境中性（bias ${bias ?? '—'}），核心續抱`;
        }
      } else if (tier === 'satellite') {
        if (overheated && bias != null && bias >= 0.5) {
          action = '賣（強勢了結）';
          limit = Number((close * 1.01).toFixed(2));
          fillProb = fillProbSell(limit, high, close);
          rationale = '過熱+偏多，強勢衛星可賣紅';
        } else {
          action = '買（奈米打卡）';
          limit = close;
          fillProb = fillProbBuy(limit, low, close);
          estAmount = Math.round(limit * 100);
          rationale = '衛星固定奈米打卡；禁止大跌重壓';
        }
      } else if (tier === 'experiment') {
        rationale = '實驗 B 依艙內規則，不套用一般核心／衛星建議';
      } else {
        rationale = `偵查／策略外不因大跌加碼；跌破累計成本 ${STOP_LOSS_PCT}% 無條件清場`;
      }
      return {
        symbol: row.stock.symbol,
        name: row.stock.name || '',
        tier,
        action,
        limit,
        fillProb,
        estAmount,
        rationale
      };
    });
  }

  function render() {
    const root = $('observatory-root');
    if (!root) return;
    if (state.error) {
      root.innerHTML = `<div class="empty">${escapeHtml(state.error)}</div>`;
      return;
    }
    const snap = state.snapshot;
    if (!snap) {
      root.innerHTML = '<div class="empty">載入中…</div>';
      return;
    }
    const overheat = snap.overheat || {};
    const recs = buildRecommendations(snap);
    const flow = state.flow || {};
    root.innerHTML = `
      <div class="merge-grid">
        <section class="merge-card">
          <div class="merge-kicker">過熱</div>
          <div class="${levelClass(overheat.level)}">${escapeHtml(overheat.verdict || '尚無判斷')}</div>
          <ul class="merge-list">${(overheat.reasons || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </section>
        <section class="merge-card">
          <div class="merge-kicker">CFO 風險</div>
          <div class="${levelClass(snap.cfo?.overall_level)}">${escapeHtml(snap.cfo?.status_label || '—')} · 紅 ${snap.cfo?.red_count ?? '—'} / 黃 ${snap.cfo?.amber_count ?? '—'}</div>
          <p class="mini muted">${escapeHtml(snap.cfo?.interpretation || '')}</p>
        </section>
        <section class="merge-card">
          <div class="merge-kicker">成交上限</div>
          <div>${escapeHtml(snap.fill_window?.label || 'normal')} · ${money(snap.fill_window?.range?.[0])}–${money(snap.fill_window?.range?.[1])}</div>
          <p class="mini muted">情境偏多分數 ${num(snap.scenario_bias, 3)}</p>
        </section>
      </div>
      ${renderHoldingsTable()}
      <section class="merge-card" style="margin-top:14px">
        <div class="merge-kicker">隔日情境</div>
        <table class="market-monitor-table">
          <thead><tr><th>情境</th><th>機率</th><th>策略</th></tr></thead>
          <tbody>${(snap.prediction?.scenarios || []).map((item) => `
            <tr><td>${escapeHtml(item.scenario)}</td><td>${item.probability}%</td><td class="merge-wrap">${escapeHtml(item.strategy)}</td></tr>
          `).join('')}</tbody>
        </table>
      </section>
      <section class="merge-card" style="margin-top:14px">
        <div class="merge-kicker">逐檔建議</div>
        <table class="market-monitor-table">
          <thead><tr><th>標的</th><th>分層</th><th>動作</th><th>限價</th><th>成交機率</th><th>預估金額</th><th>理由</th></tr></thead>
          <tbody>${recs.map((item) => `
            <tr>
              <td>${escapeHtml(item.symbol)} ${escapeHtml(item.name)}</td>
              <td>${escapeHtml(TIER_LABEL[item.tier] || item.tier)}</td>
              <td>${escapeHtml(item.action)}</td>
              <td>${item.limit == null ? '—' : num(item.limit)}</td>
              <td>${item.fillProb == null ? '—' : `${item.fillProb}%`}</td>
              <td>${money(item.estAmount)}</td>
              <td class="merge-wrap">${escapeHtml(item.rationale)}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </section>
      <section class="merge-card" style="margin-top:14px">
        <div class="merge-kicker">決策流程參考</div>
        <p class="mini muted">只供對照，不取代 battle-plan。</p>
        <div>${escapeHtml(flow.battle_plan?.title || flow.battle_plan_error || '尚無 battle-plan')}</div>
        <pre class="merge-log">${escapeHtml(flow.cfo_tail || '')}</pre>
        <pre class="merge-log">${escapeHtml(flow.buffett_tail || '')}</pre>
      </section>
    `;
  }

  async function load() {
    const root = $('observatory-root');
    if (root) root.textContent = '載入中…';
    state.error = '';
    try {
      const [snapRes, flowRes] = await Promise.all([
        fetch(`${PROXY}/api/observatory/snapshot`, { cache: 'no-store' }),
        fetch(`${PROXY}/api/decision-flow`, { cache: 'no-store' })
      ]);
      if (!snapRes.ok) throw new Error('觀測快照讀取失敗');
      state.snapshot = await snapRes.json();
      state.flow = flowRes.ok ? await flowRes.json() : {};
      try {
        const summary = calculatePortfolioSummary();
        const symbols = [...new Set((summary.heldRows || [])
          .map((row) => String(row.stock?.symbol || '').toUpperCase())
          .filter(Boolean))];
        if (symbols.length) {
          const ohlcvRes = await fetch(`${PROXY}/api/holding-ohlcv?symbols=${encodeURIComponent(symbols.join(','))}`, { cache: 'no-store' });
          const ohlcvJson = ohlcvRes.ok ? await ohlcvRes.json() : {};
          state.ohlcv = ohlcvJson.items || {};
        } else {
          state.ohlcv = {};
        }
      } catch {
        state.ohlcv = {};
      }
    } catch (error) {
      state.error = error.message || String(error);
    }
    render();
  }

  function bind() {
    $('observatory-refresh')?.addEventListener('click', () => load());
    $('observatory-privacy')?.addEventListener('click', () => {
      setPrivacy(!isPrivacy());
      render();
    });
  }

  window.renderObservatory = function renderObservatory() {
    setPrivacy(isPrivacy());
    if (!state.snapshot && !state.error) load();
    else render();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
