(() => {
  'use strict';

  const REFRESH_MS = 10000;
  const TOP_KEYS = ['tw_night', 'ftse_taiwan', 'tsm_adr', 'tsm_future', 'sox', 'nq_future'];
  const SIGNAL_KEYS = [
    'tw_night', 'ftse_taiwan', 'tsm_adr', 'tsm_future', 'sox', 'nq_future',
    'vix', 'us10y', 'usdtwd', 'es_future', 'sp500', 'nasdaq', 'dxy', 'brent'
  ];
  const REQUIRED_KEYS = new Set(['tw_night', 'ftse_taiwan', 'tsm_adr', 'tsm_future', 'sox', 'nq_future', 'vix', 'us10y', 'usdtwd']);
  const state = {
    active: false,
    timer: null,
    inFlight: false,
    lastQuotes: {},
    samples: new Map(),
    lastHoldings: []
  };

  const byId = (id) => document.getElementById(id);
  const finite = (value) => value == null || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function formatNumber(value, digits = null) {
    const number = finite(value);
    if (number == null) return '—';
    const abs = Math.abs(number);
    const resolvedDigits = digits == null
      ? (abs >= 1000 ? 2 : abs >= 100 ? 2 : abs >= 10 ? 2 : 3)
      : digits;
    return number.toLocaleString('zh-TW', {
      minimumFractionDigits: 0,
      maximumFractionDigits: resolvedDigits
    });
  }

  function formatMove(value, { percent = false, forceSign = false } = {}) {
    const number = finite(value);
    if (number == null) return '—';
    const sign = number > 0 ? (forceSign ? '+' : '') : '';
    return `${sign}${formatNumber(number, 2)}${percent ? '%' : ''}`;
  }

  function directionClass(change) {
    const value = finite(change);
    if (value == null || value === 0) return 'flat';
    return value > 0 ? 'up' : 'down';
  }

  function moveArrow(change) {
    const value = finite(change);
    if (value == null || value === 0) return '•';
    return value > 0 ? '▲' : '▼';
  }

  function formatMarketTime(epochSeconds, fallback = '') {
    const epoch = finite(epochSeconds);
    if (epoch != null) {
      return new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(epoch * 1000));
    }
    return fallback || '—';
  }

  function sourceTimeText(quote) {
    const time = formatMarketTime(quote?.marketTime);
    const delay = finite(quote?.delayMinutes);
    const delayed = delay != null && delay >= 30 ? ` · 延遲 ${delay} 分` : '';
    return `${time}${delayed}`;
  }

  function addSample(key, quote) {
    const price = finite(quote?.price);
    if (price == null) return;
    const serverSeries = Array.isArray(quote.series)
      ? quote.series.map((point) => finite(point?.value)).filter((value) => value != null)
      : [];
    let values = state.samples.get(key) || [];
    if (serverSeries.length >= 2 && values.length < 2) values = serverSeries.slice(-160);
    if (!values.length || values[values.length - 1] !== price) values.push(price);
    state.samples.set(key, values.slice(-160));
  }

  function sparklineSvg(key, quote) {
    const values = state.samples.get(key) || [];
    const direction = directionClass(quote?.change);
    const color = direction === 'up' ? '#ef3e43' : direction === 'down' ? '#08a118' : '#7c8798';
    if (values.length < 2) {
      return `<svg viewBox="0 0 180 44" preserveAspectRatio="none" aria-hidden="true"><path d="M0 31 L180 31" stroke="#aeb8c7" stroke-width="1"/><path d="M0 25 L180 25" stroke="${color}" stroke-width="2" opacity=".45"/></svg>`;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 180;
      const y = 38 - ((value - min) / range) * 31;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const area = `0,42 ${points} 180,42`;
    return `<svg viewBox="0 0 180 44" preserveAspectRatio="none" aria-hidden="true"><path d="M0 31 L180 31" stroke="#aeb8c7" stroke-width="1"/><polygon points="${area}" fill="${color}" opacity=".09"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function renderTopCards(quotes) {
    const container = byId('market-monitor-cards');
    if (!container) return;
    container.innerHTML = TOP_KEYS.map((key) => {
      const quote = quotes[key] || { label: key };
      addSample(key, quote);
      const direction = directionClass(quote.change);
      return `<article class="market-monitor-card ${direction}">
        <div class="market-monitor-card-name">${escapeHtml(quote.label || key)}</div>
        <div><span class="market-monitor-card-price">${formatNumber(quote.price)}</span><span class="market-monitor-card-move">${moveArrow(quote.change)} ${formatMove(quote.changePct, { percent: true })}</span></div>
        <div class="market-monitor-card-time">${escapeHtml(sourceTimeText(quote))}</div>
        <div class="market-monitor-card-chart">${sparklineSvg(key, quote)}</div>
      </article>`;
    }).join('');
  }

  function quoteRow(quote, { tag = '', rowClass = '' } = {}) {
    const direction = directionClass(quote?.change);
    const css = direction === 'up' ? 'market-monitor-up' : direction === 'down' ? 'market-monitor-down' : 'market-monitor-flat';
    const tagHtml = tag ? `<span class="market-monitor-signal-tag ${tag}">${tag === 'required' ? '必要' : '輔助'}</span>` : '';
    return `<tr class="${rowClass}">
      <td><div class="market-monitor-table-name"><span>${escapeHtml(quote?.label || quote?.name || quote?.symbol || '—')}</span>${tagHtml}</div></td>
      <td>${formatNumber(quote?.price)}</td>
      <td class="${css}">${moveArrow(quote?.change)} ${formatMove(quote?.change)}</td>
      <td class="${css}">${formatMove(quote?.changePct, { percent: true })}</td>
      <td class="market-monitor-table-time">${escapeHtml(sourceTimeText(quote))}</td>
    </tr>`;
  }

  function holdingsFromSummary() {
    try {
      const summary = calculatePortfolioSummary();
      return (summary?.heldRows || []).map((row) => ({
        symbol: String(row?.stock?.symbol || '').trim().toUpperCase(),
        name: row?.stock?.name || row?.stock?.symbol || '未命名標的',
        fallbackPrice: finite(row?.price)
      })).filter((row) => row.symbol);
    } catch (error) {
      console.warn('[market-monitor] holdings summary unavailable', error);
      return [];
    }
  }

  async function fetchHoldingsQuotes() {
    const holdings = holdingsFromSummary();
    if (!holdings.length) return [];
    const batch = await priceProvider.fetchBatch(holdings.map((row) => row.symbol));
    return holdings.map((holding) => {
      const quote = batch?.quotes?.get(holding.symbol) || null;
      const price = finite(quote?.price) ?? holding.fallbackPrice;
      const prevClose = finite(quote?.prevClose);
      const change = price != null && prevClose != null ? price - prevClose : null;
      const changePct = finite(quote?.prevChangePct) ?? (change != null && prevClose ? (change / prevClose) * 100 : null);
      return {
        ...holding,
        label: `${holding.symbol} ${holding.name}`,
        price,
        prevClose,
        change,
        changePct,
        marketTime: finite(quote?.marketTime),
        source: quote?.source || quote?.via || ''
      };
    });
  }

  function renderHoldings(quotes, holdings) {
    const body = byId('market-monitor-holdings');
    if (!body) return;
    const taiex = quotes.taiex;
    const rows = [];
    if (taiex) rows.push(quoteRow(taiex, { rowClass: 'reference-row' }));
    rows.push(...holdings.map((quote) => quoteRow(quote)));
    body.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="5" class="market-monitor-empty">目前沒有可顯示的持股行情</td></tr>';
    const count = byId('market-monitor-holdings-count');
    if (count) count.textContent = `${holdings.length} 檔持股`;
  }

  function renderSignals(quotes) {
    const body = byId('market-monitor-signals');
    if (!body) return;
    body.innerHTML = SIGNAL_KEYS.map((key) => {
      const quote = quotes[key] || { key, label: signalFallbackLabel(key) };
      return quoteRow(quote, { tag: REQUIRED_KEYS.has(key) ? 'required' : 'auxiliary' });
    }).join('');
  }

  function signalFallbackLabel(key) {
    return ({
      tw_night: '台指期盤後', ftse_taiwan: '富台指', tsm_adr: '台積電 ADR',
      tsm_future: '台積電期貨盤後', sox: '費城半導體', nq_future: 'EM-ND期',
      vix: 'S&P 500 VIX', us10y: '美國公債 10 年期', usdtwd: '美元兌台幣',
      es_future: 'EM-S&P期', sp500: 'S&P 500', nasdaq: 'NASDAQ', dxy: '美元指數', brent: '布蘭特原油'
    })[key] || key;
  }

  function buildRiskGates(quotes) {
    const vix = quotes.vix || {};
    const us10y = quotes.us10y || {};
    const usdtwd = quotes.usdtwd || {};
    const brent = quotes.brent || {};
    const sox = quotes.sox || {};
    const tsm = quotes.tsm_adr || {};
    const directionKeys = ['tw_night', 'ftse_taiwan', 'tsm_adr', 'tsm_future', 'sox', 'nq_future'];
    const validDirections = directionKeys.map((key) => finite(quotes[key]?.changePct)).filter((value) => value != null);
    const negativeCount = validDirections.filter((value) => value < 0).length;

    const vixValue = finite(vix.price);
    const vixLevel = vixValue == null ? 'warn' : vixValue >= 24 ? 'stop' : vixValue >= 22 ? 'warn' : 'ok';

    const yieldValue = finite(us10y.price);
    const yieldFiveDay = finite(us10y.fiveDayChange);
    const yieldLevel = yieldValue == null ? 'warn'
      : (yieldValue >= 4.85 || yieldFiveDay >= 0.25) ? 'stop'
      : (yieldValue >= 4.70 || yieldFiveDay >= 0.15) ? 'warn' : 'ok';

    const fxFiveDay = finite(usdtwd.fiveDayChangePct);
    const fxLevel = fxFiveDay == null ? 'warn' : fxFiveDay >= 2.5 ? 'stop' : fxFiveDay >= 1.5 ? 'warn' : 'ok';

    const oilMove = finite(brent.changePct);
    const oilLevel = oilMove == null ? 'warn' : oilMove >= 5 ? 'stop' : oilMove >= 3 ? 'warn' : 'ok';

    const soxMove = finite(sox.changePct);
    const tsmMove = finite(tsm.changePct);
    const semiLevel = soxMove == null || tsmMove == null ? 'warn'
      : (soxMove <= -5 || tsmMove <= -5) ? 'stop'
      : (soxMove <= -2.5 && tsmMove < 0) || (tsmMove <= -2 && soxMove < 0) ? 'warn' : 'ok';

    const consensusLevel = validDirections.length < 4 ? 'warn' : negativeCount >= 5 ? 'stop' : negativeCount >= 3 ? 'warn' : 'ok';

    return [
      { name: 'VIX 安全閥', value: vixValue == null ? '—' : formatNumber(vixValue, 2), level: vixLevel, rule: '22–24 黃燈；≥ 24 觸發安全閥', action: vixLevel === 'stop' ? '暫停新增買單' : vixLevel === 'warn' ? '降低參與單與金額' : '未觸發' },
      { name: '半導體同步轉弱', value: `SOX ${formatMove(soxMove, { percent: true })} / ADR ${formatMove(tsmMove, { percent: true })}`, level: semiLevel, rule: 'SOX 與台積電 ADR 同弱；單日重挫視為紅燈', action: semiLevel === 'stop' ? '關閉衛星與追價單' : semiLevel === 'warn' ? '只留核心折價單' : '未觸發' },
      { name: '美債殖利率', value: `${formatNumber(yieldValue, 3)}%`, level: yieldLevel, rule: `≥ 4.70% 或 5 日 +15bp 黃燈；≥ 4.85% 或 +25bp 紅燈`, action: yieldLevel === 'stop' ? '停止擴張部位' : yieldLevel === 'warn' ? '縮小成交上限' : '未觸發' },
      { name: '美元兌台幣', value: `${formatNumber(usdtwd.price, 3)} · 5日 ${formatMove(fxFiveDay, { percent: true })}`, level: fxLevel, rule: '5 日升幅 1.5% 黃燈；2.5% 紅燈（台幣快速貶值）', action: fxLevel === 'stop' ? '暫停加碼，等待外資壓力緩解' : fxLevel === 'warn' ? '降低台股曝險增量' : '未觸發' },
      { name: '油價衝擊', value: `${formatNumber(brent.price, 2)} · ${formatMove(oilMove, { percent: true })}`, level: oilLevel, rule: '布蘭特單日 +3% 黃燈；+5% 紅燈', action: oilLevel === 'stop' ? '宏觀風險優先，不加碼' : oilLevel === 'warn' ? '避免積極參與價' : '未觸發' },
      { name: '六訊號一致性', value: validDirections.length ? `${negativeCount}/${validDirections.length} 負向` : '—', level: consensusLevel, rule: '六項中 3 項負向黃燈；5 項負向紅燈', action: consensusLevel === 'stop' ? '隔日以防守或 No Trade 為主' : consensusLevel === 'warn' ? '不追價，只保留低接條件單' : '未觸發' }
    ];
  }

  function renderRiskGates(quotes) {
    const container = byId('market-monitor-risk-gates');
    if (!container) return;
    const gates = buildRiskGates(quotes);
    container.innerHTML = gates.map((gate) => `<article class="market-monitor-risk-card ${gate.level}">
      <div class="market-monitor-risk-name">${escapeHtml(gate.name)}</div>
      <div class="market-monitor-risk-value">${escapeHtml(gate.value)}</div>
      <div class="market-monitor-risk-rule">判斷：${escapeHtml(gate.rule)}</div>
      <div class="market-monitor-risk-action">建議：${escapeHtml(gate.action)}</div>
    </article>`).join('');
    const summary = byId('market-monitor-risk-summary');
    if (!summary) return;
    const stopCount = gates.filter((gate) => gate.level === 'stop').length;
    const warnCount = gates.filter((gate) => gate.level === 'warn').length;
    summary.className = `market-monitor-risk-summary ${stopCount ? 'stop' : warnCount ? 'warn' : ''}`;
    summary.textContent = stopCount ? `${stopCount} 項紅燈 · 暫停加碼` : warnCount ? `${warnCount} 項黃燈 · 縮手` : '綠燈 · 依計畫執行';
  }

  function setStatus(kind, text) {
    const status = byId('market-monitor-status');
    if (!status) return;
    status.className = `market-monitor-status ${kind || ''}`.trim();
    status.textContent = text;
  }

  async function refreshMarketMonitor({ manual = false } = {}) {
    if (state.inFlight) return;
    state.inFlight = true;
    setStatus('loading', manual ? '手動更新中…' : '更新中…');
    const localBase = (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');
    try {
      const [monitorResult, holdingsResult] = await Promise.allSettled([
        fetch(`${localBase}/api/market-monitor`, { cache: 'no-store' }).then(async (response) => {
          const payload = await response.json();
          if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
          return payload;
        }),
        fetchHoldingsQuotes()
      ]);
      if (monitorResult.status === 'rejected') throw monitorResult.reason;
      const payload = monitorResult.value;
      state.lastQuotes = { ...state.lastQuotes, ...(payload.quotes || {}) };
      if (holdingsResult.status === 'fulfilled') state.lastHoldings = holdingsResult.value;
      renderTopCards(state.lastQuotes);
      renderHoldings(state.lastQuotes, state.lastHoldings);
      renderSignals(state.lastQuotes);
      renderRiskGates(state.lastQuotes);

      const missing = Array.isArray(payload.errors) ? payload.errors.length : 0;
      const timestamp = new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(new Date(payload.updatedAt || Date.now()));
      if (missing) setStatus('error', `${timestamp} · ${missing} 項來源暫缺`);
      else setStatus('', `${timestamp} · 10 秒更新`);
    } catch (error) {
      console.error('[market-monitor] refresh failed', error);
      if (Object.keys(state.lastQuotes).length) {
        renderTopCards(state.lastQuotes);
        renderHoldings(state.lastQuotes, state.lastHoldings);
        renderSignals(state.lastQuotes);
        renderRiskGates(state.lastQuotes);
        setStatus('error', '更新失敗 · 顯示上次成功資料');
      } else {
        setStatus('error', '行情來源暫時無法取得');
      }
    } finally {
      state.inFlight = false;
    }
  }

  function scheduleNextRefresh() {
    clearInterval(state.timer);
    state.timer = null;
    if (!state.active || document.hidden) return;
    state.timer = window.setInterval(() => refreshMarketMonitor(), REFRESH_MS);
  }

  function setMarketMonitorActive(active) {
    state.active = Boolean(active);
    scheduleNextRefresh();
    if (state.active && !document.hidden) refreshMarketMonitor();
  }

  byId('market-monitor-refresh')?.addEventListener('click', () => refreshMarketMonitor({ manual: true }));
  document.addEventListener('visibilitychange', () => {
    scheduleNextRefresh();
    if (state.active && !document.hidden) refreshMarketMonitor();
  });

  window.refreshMarketMonitor = refreshMarketMonitor;
  window.setMarketMonitorActive = setMarketMonitorActive;
})();
