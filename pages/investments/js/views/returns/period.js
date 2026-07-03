  // ========= Returns / 週期報酬（#view-period-return） =========
  // 從 returns.js 拆出（2026-05-17）
  // 主入口：renderPeriodicReturnDashboard()，被 app.js / watchlist.js 呼叫
  // 依賴：shared.js（getLocalDateOnly、parseLocalDateOnly、getRenderableSnapshots 等）

  // ========= 週期報酬 =========
  const PERIOD_RETURN_RANGE_CONFIG = Object.freeze({
    day: {
      label: '當日',
      note: '當日維度以昨收到目前 / 收盤價為基準，明細會另外顯示今日開盤價。'
    },
    week: {
      label: '近一週',
      note: '近一週採往前 6 個自然日到今天的區間，起始價取該日前最近交易日收盤價。'
    },
    month: {
      label: '近30天',
      note: '近 30 天採往前回推 30 天到今天的區間，起始價取該日前最近交易日收盤價。'
    }
  });
  const PERIOD_RETURN_QUOTE_TTL_MS = 60 * 1000;
  const PERIOD_RETURN_AUTO_REFRESH_MS = 60 * 1000;
  const periodReturnState = {
    range: 'day',
    rows: [],
    renderSeq: 0,
    lastLoadedAt: '',
    quoteCache: {},
    autoTimer: null
  };

  function shiftLocalDays(date, days){
    const d = getLocalDateOnly(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function getFirstFinitePositive(...values){
    for(const value of values){
      const num = Number(value);
      if(Number.isFinite(num) && num > 0){
        return num;
      }
    }
    return null;
  }

  function getPeriodReturnMinHoldingDays(rangeKey){
    if(rangeKey === 'week') return 7;
    if(rangeKey === 'month') return 30;
    return 0;
  }

  function formatPeriodReturnPrice(value){
    return Number.isFinite(value) && value > 0 ? fmt2.format(value) : '—';
  }

  function formatPeriodReturnSignedAmount(value){
    if(!Number.isFinite(value)) return '—';
    return `${value >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(Math.round(value)))}`;
  }

  function formatPeriodReturnSignedPrice(value){
    if(!Number.isFinite(value)) return '—';
    return `${value >= 0 ? '+' : '-'}${fmt2.format(Math.abs(value))}`;
  }

  function formatPeriodReturnSignedPct(value){
    if(!Number.isFinite(value)) return '—';
    return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`;
  }

  function getPeriodReturnToneClass(value){
    if(!Number.isFinite(value)) return '';
    if(value > 0) return 'positive';
    if(value < 0) return 'negative';
    return '';
  }

  function formatPeriodReturnDateShort(dateStr){
    const text = String(dateStr || '').slice(0, 10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    return text.slice(5).replace('-', '/');
  }

  function getPeriodReturnQuoteSourceMeta(quote, fallbackLabel = ''){
    const source = String(quote?.source || quote?.via || '').trim();
    const marketState = String(quote?.marketState || '').toUpperCase();
    const tradeDate = String(quote?.tradeDate || '').slice(0, 10);
    const tradeTime = String(quote?.tradeTime || '').slice(0, 5);
    const priceSource = String(quote?.priceSource || '').trim();

    if(source === 'twse-mis'){
      if(marketState === 'REGULAR'){
        return {
          tone: 'live',
          label: tradeTime ? `即時 ${tradeTime}` : '即時',
          hint: `TWSE MIS 即時報價${priceSource ? `（${priceSource}）` : ''}`
        };
      }
      if(marketState === 'PREPRE'){
        return {
          tone: 'live',
          label: tradeTime ? `試撮 ${tradeTime}` : '試撮',
          hint: 'TWSE MIS 盤前試撮報價'
        };
      }
      return {
        tone: 'close',
        label: tradeDate ? `盤後 ${formatPeriodReturnDateShort(tradeDate)}` : '盤後',
        hint: 'TWSE MIS 盤後報價'
      };
    }

    if(source === 'official-eod'){
      return {
        tone: 'close',
        label: tradeDate ? `收盤 ${formatPeriodReturnDateShort(tradeDate)}` : '收盤',
        hint: '官方日收盤價 fallback，非盤中即時價'
      };
    }

    if(source === 'yahoo' || source.includes('local-quote')){
      return {
        tone: 'live',
        label: tradeTime ? `報價 ${tradeTime}` : '報價',
        hint: '本機 proxy quote 報價'
      };
    }

    return {
      tone: fallbackLabel ? 'cache' : '',
      label: fallbackLabel,
      hint: fallbackLabel ? '使用持股資料或歷史收盤價 fallback' : ''
    };
  }

  function renderPeriodReturnSourceTag(label, tone = ''){
    if(!label) return '';
    return `<span class="period-source-tag ${tone || ''}">${escapeHtml(label)}</span>`;
  }

  function isPeriodReturnViewActive(){
    return $('#view-period-return')?.classList.contains('active');
  }

  function syncPeriodReturnAutoRefresh(){
    if(isPeriodReturnViewActive()){
      if(!periodReturnState.autoTimer){
        periodReturnState.autoTimer = window.setInterval(() => {
          if(!isPeriodReturnViewActive()){
            syncPeriodReturnAutoRefresh();
            return;
          }
          renderPeriodicReturnDashboard(calculatePortfolioSummary(), { forceQuote: true });
        }, PERIOD_RETURN_AUTO_REFRESH_MS);
      }
      return;
    }
    if(periodReturnState.autoTimer){
      window.clearInterval(periodReturnState.autoTimer);
      periodReturnState.autoTimer = null;
    }
  }

  function getPeriodReturnLatestHistoryPoint(history){
    if(!Array.isArray(history)) return null;
    for(let i = history.length - 1; i >= 0; i -= 1){
      const point = history[i];
      const close = Number(point?.close);
      const date = String(point?.date || '').slice(0, 10);
      if(date && Number.isFinite(close) && close > 0){
        return { date, close };
      }
    }
    return null;
  }

  function getPeriodReturnHistoryPointOnOrBefore(history, targetDateStr){
    if(!Array.isArray(history) || !targetDateStr) return null;
    const target = String(targetDateStr).slice(0, 10);
    for(let i = history.length - 1; i >= 0; i -= 1){
      const point = history[i];
      const date = String(point?.date || '').slice(0, 10);
      const close = Number(point?.close);
      if(date && date <= target && Number.isFinite(close) && close > 0){
        return { date, close };
      }
    }
    return null;
  }

  async function fetchPeriodReturnQuote(symbol, force = false){
    const sym = String(symbol || '').trim().toUpperCase();
    if(!sym) return null;
    const cached = periodReturnState.quoteCache[sym];
    if(!force && cached && (Date.now() - cached.fetchedAt) < PERIOD_RETURN_QUOTE_TTL_MS){
      return cached.data;
    }
    const result = await priceProvider.fetchQuote(sym);
    const payload = (result && !result.error)
      ? {
          livePrice: Number.isFinite(result.livePrice) ? Number(result.livePrice) : null,
          prevClose: Number.isFinite(result.prevClose) ? Number(result.prevClose) : null,
          prevChangePct: Number.isFinite(result.prevChangePct) ? Number(result.prevChangePct) : null,
          todayOpen: Number.isFinite(result.todayOpen) ? Number(result.todayOpen) : null,
          symbol: result.symbol || sym,
          marketTime: Number.isFinite(result.marketTime) ? Number(result.marketTime) : null,
          marketState: result.marketState || '',
          source: result.source || result.via || '',
          via: result.via || '',
          tradeDate: result.tradeDate || '',
          tradeTime: result.tradeTime || '',
          marketPhase: result.marketPhase || '',
          priceSource: result.priceSource || '',
          updatedAt: new Date().toISOString()
        }
      : null;
    periodReturnState.quoteCache[sym] = {
      fetchedAt: Date.now(),
      data: payload
    };
    return payload;
  }

  function buildPeriodReturnMetric(row, rangeKey, payload = {}){
    const qty = parseN(row?.qty);
    const startPrice = Number(payload.startPrice);
    const endPrice = Number(payload.endPrice);
    const holdingDays = Number.isFinite(payload.holdingDays) ? Number(payload.holdingDays) : null;
    const minHoldingDays = getPeriodReturnMinHoldingDays(rangeKey);
    const hiddenByHoldingDays = Number.isFinite(holdingDays) && minHoldingDays > 0 && holdingDays < minHoldingDays;
    const base = {
      rangeKey,
      label: PERIOD_RETURN_RANGE_CONFIG[rangeKey]?.label || rangeKey,
      available: false,
      reason: payload.reason || (hiddenByHoldingDays ? `持有未滿 ${minHoldingDays} 天` : '資料不足'),
      qty,
      holdingDays,
      minHoldingDays,
      hiddenByHoldingDays,
      startPrice: Number.isFinite(startPrice) ? startPrice : null,
      endPrice: Number.isFinite(endPrice) ? endPrice : null,
      startDate: payload.startDate || '',
      endDate: payload.endDate || '',
      openPrice: Number.isFinite(payload.openPrice) ? Number(payload.openPrice) : null,
      referenceLabel: payload.referenceLabel || '',
      note: payload.note || '',
      sourceHint: payload.sourceHint || '',
      startSourceLabel: payload.startSourceLabel || '',
      startSourceTone: payload.startSourceTone || '',
      endSourceLabel: payload.endSourceLabel || '',
      endSourceTone: payload.endSourceTone || '',
      updatedAt: payload.updatedAt || ''
    };
    if(hiddenByHoldingDays){
      return base;
    }
    if(!(qty > 0) || !(startPrice > 0) || !(endPrice > 0)){
      return base;
    }
    const priceDiff = endPrice - startPrice;
    const priceDiffPct = startPrice !== 0 ? (priceDiff / startPrice) * 100 : null;
    return {
      ...base,
      available: true,
      priceDiff,
      priceDiffPct,
      pnlAmount: priceDiff * qty,
      pnlPct: priceDiffPct
    };
  }

  async function buildPeriodReturnRowData(row, options = {}){
    const symbol = String(row?.stock?.symbol || '').trim().toUpperCase();
    const qty = parseN(row?.qty);
    const holdingDays = Number.isFinite(row?.cycleHoldingDays) ? Number(row.cycleHoldingDays) : null;
    const history = symbol ? await fetchPriceHistory(symbol, !!options.forceHistory) : null;
    const quote = symbol ? await fetchPeriodReturnQuote(symbol, !!options.forceQuote) : null;
    const today = localDateStr();
    const latestHistory = getPeriodReturnLatestHistoryPoint(history);
    const quoteMeta = getPeriodReturnQuoteSourceMeta(quote);
    const hasQuotePrice = Number.isFinite(Number(quote?.livePrice)) && Number(quote.livePrice) > 0;
    const currentPrice = getFirstFinitePositive(quote?.livePrice, row?.currentPrice, row?.price, latestHistory?.close);
    const fallbackCurrentMeta = row?.currentPrice || row?.price
      ? { label: '持股快取', tone: 'cache', hint: '使用持股資料中的目前價 fallback' }
      : { label: latestHistory?.date ? `收盤 ${formatPeriodReturnDateShort(latestHistory.date)}` : '歷史收盤', tone: 'close', hint: '使用歷史收盤價 fallback' };
    const endSourceMeta = hasQuotePrice ? quoteMeta : fallbackCurrentMeta;
    const currentDate = hasQuotePrice
      ? (quote?.tradeDate || today)
      : (latestHistory?.date || today);
    const prevAnchor = localDateStr(shiftLocalDays(new Date(), -1));
    const prevHistory = getPeriodReturnHistoryPointOnOrBefore(history, prevAnchor);
    const prevClose = getFirstFinitePositive(quote?.prevClose, prevHistory?.close);
    const prevSourceMeta = quote?.prevClose
      ? { label: '昨收 quote', tone: 'close', hint: '昨收取自本機 proxy quote' }
      : { label: prevHistory?.date ? `收盤 ${formatPeriodReturnDateShort(prevHistory.date)}` : '歷史收盤', tone: 'close', hint: '昨收回退到歷史收盤價' };

    const dayMetric = buildPeriodReturnMetric(row, 'day', {
      holdingDays,
      startPrice: prevClose,
      endPrice: currentPrice,
      startDate: prevHistory?.date || '前一交易日',
      endDate: currentDate,
      openPrice: quote?.todayOpen,
      referenceLabel: '昨收到目前 / 收盤價',
      note: PERIOD_RETURN_RANGE_CONFIG.day.note,
      startSourceLabel: prevSourceMeta.label,
      startSourceTone: prevSourceMeta.tone,
      endSourceLabel: endSourceMeta.label,
      endSourceTone: endSourceMeta.tone,
      sourceHint: `${prevSourceMeta.hint || '昨收取自 quote'}；目前價：${endSourceMeta.hint || quoteMeta.hint || '本機 proxy quote'}。`,
      updatedAt: quote?.updatedAt || row?.quoteTime || ''
    });

    const weekAnchor = localDateStr(shiftLocalDays(new Date(), -6));
    const weekStart = getPeriodReturnHistoryPointOnOrBefore(history, weekAnchor);
    const weekMetric = buildPeriodReturnMetric(row, 'week', {
      holdingDays,
      startPrice: weekStart?.close,
      endPrice: currentPrice,
      startDate: weekStart?.date || '',
      endDate: currentDate,
      referenceLabel: '起點收盤到目前價',
      note: PERIOD_RETURN_RANGE_CONFIG.week.note,
      startSourceLabel: weekStart?.date ? `收盤 ${formatPeriodReturnDateShort(weekStart.date)}` : '歷史收盤',
      startSourceTone: 'close',
      endSourceLabel: endSourceMeta.label,
      endSourceTone: endSourceMeta.tone,
      sourceHint: `起始價採指定日期或之前最近交易日收盤價；目前價：${endSourceMeta.hint || quoteMeta.hint || '本機 proxy quote'}。`,
      updatedAt: quote?.updatedAt || row?.quoteTime || ''
    });

    const monthAnchor = localDateStr(shiftLocalDays(new Date(), -30));
    const monthStart = getPeriodReturnHistoryPointOnOrBefore(history, monthAnchor);
    const monthMetric = buildPeriodReturnMetric(row, 'month', {
      holdingDays,
      startPrice: monthStart?.close,
      endPrice: currentPrice,
      startDate: monthStart?.date || '',
      endDate: currentDate,
      referenceLabel: '30 天前收盤到目前價',
      note: PERIOD_RETURN_RANGE_CONFIG.month.note,
      startSourceLabel: monthStart?.date ? `收盤 ${formatPeriodReturnDateShort(monthStart.date)}` : '歷史收盤',
      startSourceTone: 'close',
      endSourceLabel: endSourceMeta.label,
      endSourceTone: endSourceMeta.tone,
      sourceHint: `起始價採指定日期或之前最近交易日收盤價；目前價：${endSourceMeta.hint || quoteMeta.hint || '本機 proxy quote'}。`,
      updatedAt: quote?.updatedAt || row?.quoteTime || ''
    });

    return {
      key: row.instrumentKey || symbol || uid(),
      symbol,
      name: row?.stock?.name || '',
      qty,
      holdingDays,
      currentPrice,
      currentDate,
      updatedAt: quote?.updatedAt || row?.quoteTime || '',
      periods: {
        day: dayMetric,
        week: weekMetric,
        month: monthMetric
      }
    };
  }

  function computePeriodReturnCardStats(rows, rangeKey){
    const metrics = rows
      .map(item => item?.periods?.[rangeKey])
      .filter(metric => metric && !metric.hiddenByHoldingDays)
      .filter(Boolean);
    const available = metrics.filter(metric => metric.available);
    const totalPnl = available.reduce((sum, metric) => sum + (Number.isFinite(metric.pnlAmount) ? metric.pnlAmount : 0), 0);
    const positiveCount = available.filter(metric => metric.pnlAmount > 0).length;
    return {
      total: metrics.length,
      available: available.length,
      positiveCount,
      totalPnl
    };
  }

  function renderPeriodReturnDashboardView(){
    const summaryEl = $('#period-return-summary');
    const statusEl = $('#period-return-status');
    const startNoteEl = $('#period-return-start-note');
    const metaEl = $('#period-return-meta');
    const tbody = $('#tbl-period-return tbody');
    if(!summaryEl || !statusEl || !startNoteEl || !metaEl || !tbody) return;

    const rangeKey = periodReturnState.range;
    const rangeCfg = PERIOD_RETURN_RANGE_CONFIG[rangeKey] || PERIOD_RETURN_RANGE_CONFIG.day;
    const allRows = Array.isArray(periodReturnState.rows) ? periodReturnState.rows.slice() : [];
    const rows = allRows.filter(item => !item?.periods?.[rangeKey]?.hiddenByHoldingDays);

    summaryEl.innerHTML = Object.entries(PERIOD_RETURN_RANGE_CONFIG).map(([key, cfg]) => {
      const stats = computePeriodReturnCardStats(allRows, key);
      const totalClass = getPeriodReturnToneClass(stats.totalPnl);
      return `
        <button type="button" class="period-summary-card ${key === rangeKey ? 'active' : ''}" data-period-range="${key}">
          <div class="period-summary-label">${cfg.label}</div>
          <div class="period-summary-value ${totalClass}">${formatPeriodReturnSignedAmount(stats.totalPnl)}</div>
          <div class="period-summary-meta">
            <span>可計算 ${stats.available}/${stats.total} 檔</span>
            <span>正報酬 ${stats.positiveCount} 檔</span>
          </div>
        </button>`;
    }).join('');

    $$('#view-period-return [data-period-range]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.periodRange === rangeKey);
    });

    startNoteEl.textContent = rangeCfg.note;

    const loadedAt = periodReturnState.lastLoadedAt
      ? new Date(periodReturnState.lastLoadedAt).toLocaleString('zh-TW', { hour12: false })
      : '';
    const selectedStats = computePeriodReturnCardStats(allRows, rangeKey);
    const autoRefreshText = isPeriodReturnViewActive() ? '，每 60 秒自動刷新 quote' : '';
    metaEl.textContent = rows.length
      ? `目前檢視：${rangeCfg.label}，可計算 ${selectedStats.available}/${selectedStats.total} 檔${loadedAt ? `，本頁更新於 ${loadedAt}` : ''}${autoRefreshText}`
      : `目前檢視：${rangeCfg.label}`;

    if(!allRows.length){
      statusEl.className = 'period-board-status';
      statusEl.textContent = '尚無持有標的，無法建立週期報酬看板。';
      tbody.innerHTML = '<tr><td colspan="9" class="empty">尚無持有標的</td></tr>';
      return;
    }

    if(!rows.length){
      const minHoldingDays = getPeriodReturnMinHoldingDays(rangeKey);
      statusEl.className = 'period-board-status';
      statusEl.textContent = minHoldingDays > 0
        ? `${rangeCfg.label}目前沒有持有滿 ${minHoldingDays} 天的標的。`
        : `${rangeCfg.label}目前沒有可顯示資料。`;
      tbody.innerHTML = `<tr><td colspan="9" class="empty">${minHoldingDays > 0 ? `目前沒有持有滿 ${minHoldingDays} 天的標的` : '目前沒有可顯示資料'}</td></tr>`;
      return;
    }

    const unavailableCount = rows.filter(item => !item?.periods?.[rangeKey]?.available).length;
    statusEl.className = unavailableCount ? 'period-board-status error' : 'period-board-status';
    statusEl.textContent = unavailableCount
      ? `${rangeCfg.label}資料已載入，但有 ${unavailableCount} 檔因歷史價格不足或代理未回應而無法完整計算。`
      : `${rangeCfg.label}資料已載入，共 ${rows.length} 檔可檢視。`;

    rows.sort((a, b) => {
      const ma = a?.periods?.[rangeKey];
      const mb = b?.periods?.[rangeKey];
      if(!!ma?.available !== !!mb?.available) return ma?.available ? -1 : 1;
      const aVal = Number.isFinite(ma?.pnlAmount) ? ma.pnlAmount : Number.NEGATIVE_INFINITY;
      const bVal = Number.isFinite(mb?.pnlAmount) ? mb.pnlAmount : Number.NEGATIVE_INFINITY;
      if(aVal !== bVal) return bVal - aVal;
      return (a.symbol || '').localeCompare(b.symbol || '');
    });

    tbody.innerHTML = rows.map(item => {
      const metric = item?.periods?.[rangeKey];
      if(!metric?.available){
        return `
          <tr>
            <td class="text-start">
              <div class="period-symbol-cell">
                <div class="period-symbol-main">
                  <strong>${escapeHtml(item.symbol || '—')}</strong>
                  <span class="period-symbol-name">${escapeHtml(item.name || '')}</span>
                </div>
                <div class="period-subline">目前缺少 ${escapeHtml(rangeCfg.label)} 所需歷史資料</div>
              </div>
            </td>
            <td class="num">${formatHoldingQty(item.qty)}</td>
            <td class="num" colspan="5"><span class="period-badge neutral">資料不足</span></td>
            <td class="num">—</td>
            <td class="num"><button type="button" class="btn ghost period-detail-btn" disabled>查看</button></td>
          </tr>`;
      }
      const priceTone = getPeriodReturnToneClass(metric.priceDiff);
      const pnlTone = getPeriodReturnToneClass(metric.pnlAmount);
      return `
        <tr>
          <td class="text-start">
            <div class="period-symbol-cell">
              <div class="period-symbol-main">
                <strong>${escapeHtml(item.symbol || '—')}</strong>
                <span class="period-symbol-name">${escapeHtml(item.name || '')}</span>
              </div>
              <div class="period-subline">${escapeHtml(metric.startDate || '—')} → ${escapeHtml(metric.endDate || '—')}</div>
            </div>
          </td>
          <td class="num">${formatHoldingQty(item.qty)}</td>
          <td class="num">
            <div class="period-value-stack">
              <div class="period-value-main">${formatPeriodReturnPrice(metric.startPrice)}</div>
              <div class="period-subline">${escapeHtml(metric.startDate || '—')}</div>
              ${renderPeriodReturnSourceTag(metric.startSourceLabel, metric.startSourceTone)}
            </div>
          </td>
          <td class="num">
            <div class="period-value-stack">
              <div class="period-value-main">${formatPeriodReturnPrice(metric.endPrice)}</div>
              <div class="period-subline">${escapeHtml(metric.endDate || '—')}</div>
              ${renderPeriodReturnSourceTag(metric.endSourceLabel, metric.endSourceTone)}
            </div>
          </td>
          <td class="num"><span class="period-value-main ${priceTone}">${formatPeriodReturnSignedPrice(metric.priceDiff)}</span></td>
          <td class="num"><span class="period-value-main ${pnlTone}">${formatPeriodReturnSignedAmount(metric.pnlAmount)}</span></td>
          <td class="num"><span class="period-badge ${pnlTone || 'neutral'}">${formatPeriodReturnSignedPct(metric.pnlPct)}</span></td>
          <td class="num"><button type="button" class="btn period-detail-btn" data-action="period-return-detail" data-key="${escapeAttr(item.key)}">查看</button></td>
        </tr>`;
    }).join('');
  }

  async function renderPeriodicReturnDashboard(summary = calculatePortfolioSummary(), options = {}){
    const statusEl = $('#period-return-status');
    const tbody = $('#tbl-period-return tbody');
    const summaryEl = $('#period-return-summary');
    const metaEl = $('#period-return-meta');
    if(!statusEl || !tbody || !summaryEl || !metaEl) return;

    const rows = (summary?.heldRows || []).filter(row => parseN(row.qty) > 0 && String(row?.stock?.symbol || '').trim());
    const seq = ++periodReturnState.renderSeq;

    if(!rows.length){
      periodReturnState.rows = [];
      periodReturnState.lastLoadedAt = '';
      renderPeriodReturnDashboardView();
      return;
    }

    statusEl.className = 'period-board-status loading';
    statusEl.textContent = `載入週期報酬資料中…（${rows.length} 檔）`;
    if(!periodReturnState.rows.length){
      tbody.innerHTML = '<tr><td colspan="9" class="empty">載入中…</td></tr>';
      summaryEl.innerHTML = '';
      metaEl.textContent = '';
    }

    const allSymbols = rows
      .map(row => String(row?.stock?.symbol || '').trim().toUpperCase())
      .filter(Boolean);

    // 方案 2：並行預熱所有 history 快取，讓後續 buildPeriodReturnRowData 直接命中
    await Promise.allSettled(allSymbols.map(s => fetchPriceHistory(s, !!options.forceHistory)));
    if(seq !== periodReturnState.renderSeq) return;

    // 方案 1：批次取回所有即時報價，寫入 quoteCache，避免 N 次個別 HTTP 請求
    const symbolsToFetch = options.forceQuote
      ? allSymbols
      : allSymbols.filter(sym => {
          const c = periodReturnState.quoteCache[sym];
          return !c || (Date.now() - c.fetchedAt) >= PERIOD_RETURN_QUOTE_TTL_MS;
        });
    if(symbolsToFetch.length && typeof priceProvider.fetchBatch === 'function'){
      try{
        const batchResult = await priceProvider.fetchBatch(symbolsToFetch);
        const quoteMap = batchResult?.quotes instanceof Map ? batchResult.quotes : new Map();
        const now = Date.now();
        for(const sym of symbolsToFetch){
          const q = quoteMap.get(sym);
          if(q && typeof q.price === 'number' && !isNaN(q.price)){
            periodReturnState.quoteCache[sym] = {
              fetchedAt: now,
              data: {
                livePrice: q.price,
                prevClose: null,
                prevChangePct: null,
                todayOpen: null,
                symbol: q.symbol || sym,
                marketTime: q.marketTime ?? null,
                marketState: '',
                source: q.via || 'local-quotes',
                via: q.via || 'local-quotes',
                tradeDate: '',
                tradeTime: '',
                marketPhase: '',
                priceSource: '',
                updatedAt: new Date().toISOString()
              }
            };
          }
        }
      }catch(e){
        console.warn('[period-return] batch quote pre-fetch failed, falling back to individual fetch', e);
      }
    }
    if(seq !== periodReturnState.renderSeq) return;

    const settled = await Promise.allSettled(rows.map(row => buildPeriodReturnRowData(row, options)));
    if(seq !== periodReturnState.renderSeq) return;

    periodReturnState.rows = settled
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => result.value);
    periodReturnState.lastLoadedAt = new Date().toISOString();
    renderPeriodReturnDashboardView();
  }

  function buildPeriodReturnDetailCard(label, value, toneClass = ''){
    return `
      <div class="period-detail-card">
        <div class="period-detail-label">${escapeHtml(label)}</div>
        <div class="period-detail-value ${toneClass}">${value}</div>
      </div>`;
  }

  function openPeriodReturnDetail(rowKey){
    const dlg = $('#dlg-period-return-detail');
    const titleEl = $('#period-return-detail-title');
    const bodyEl = $('#period-return-detail-body');
    if(!dlg || !titleEl || !bodyEl) return;

    const row = periodReturnState.rows.find(item => item.key === rowKey);
    const metric = row?.periods?.[periodReturnState.range];
    if(!row || !metric || !metric.available) return;

    const title = `${row.symbol || '—'} ${row.name || ''}`.trim();
    titleEl.textContent = `${title}｜${metric.label}明細`;
    const tonePrice = getPeriodReturnToneClass(metric.priceDiff);
    const tonePnl = getPeriodReturnToneClass(metric.pnlAmount);
    const cards = [
      buildPeriodReturnDetailCard('持有股數', escapeHtml(formatHoldingQty(row.qty))),
      buildPeriodReturnDetailCard('週期起始價', escapeHtml(formatPeriodReturnPrice(metric.startPrice))),
      buildPeriodReturnDetailCard('目前 / 期末價', escapeHtml(formatPeriodReturnPrice(metric.endPrice))),
      buildPeriodReturnDetailCard('價格漲跌', escapeHtml(formatPeriodReturnSignedPrice(metric.priceDiff)), tonePrice),
      buildPeriodReturnDetailCard('價格漲跌幅', escapeHtml(formatPeriodReturnSignedPct(metric.priceDiffPct)), tonePrice),
      buildPeriodReturnDetailCard('持有損益', escapeHtml(formatPeriodReturnSignedAmount(metric.pnlAmount)), tonePnl),
      buildPeriodReturnDetailCard('持有損益率', escapeHtml(formatPeriodReturnSignedPct(metric.pnlPct)), tonePnl)
    ];
    if(Number.isFinite(metric.openPrice)){
      cards.splice(3, 0, buildPeriodReturnDetailCard('今日開盤價', escapeHtml(formatPeriodReturnPrice(metric.openPrice))));
    }

    bodyEl.innerHTML = `
      <div class="period-detail-grid">${cards.join('')}</div>
      <div class="period-detail-note">
        週期說明：${escapeHtml(metric.note || '')}<br>
        參考區間：${escapeHtml(metric.startDate || '—')} → ${escapeHtml(metric.endDate || '—')}<br>
        價格口徑：${escapeHtml(metric.referenceLabel || '—')}<br>
        目前價來源：${escapeHtml(metric.endSourceLabel || '—')}
      </div>
      <ul class="period-detail-list">
        <li>價格變化：${escapeHtml(formatPeriodReturnSignedPrice(metric.priceDiff))}（${escapeHtml(formatPeriodReturnSignedPct(metric.priceDiffPct))}）</li>
        <li>持有損益：以目前持有股數 ${escapeHtml(formatHoldingQty(row.qty))} 乘上區間價差估算。</li>
        <li>${escapeHtml(metric.sourceHint || '資料來源為本機 proxy quote / history。')}</li>
      </ul>`;
    dlg.returnValue = '';
    dlg.showModal();
  }
