  // ========= Returns / 每日變動圖 =========
  // 從 returns.js 拆出（2026-05-17）
  // 依賴：shared.js（setChartSurfaceState、loadHighchartsIfNeeded、filterReturnChartDateData、buildCashFlowEvents、getRenderableSnapshots 等）

  const returnDailyHistoryCache = {};

  function getReturnDailyDateKey(value){
    if(!value) return '';
    const d = new Date(value);
    if(!Number.isNaN(d.getTime())) return localDateStr(d);
    return String(value).slice(0, 10);
  }

  function getReturnDailyHistoryCloseOnOrBefore(history, dateStr){
    if(!Array.isArray(history) || !dateStr) return null;
    const target = String(dateStr).slice(0, 10);
    for(let i = history.length - 1; i >= 0; i -= 1){
      const item = history[i];
      const date = String(item?.date || '').slice(0, 10);
      const close = Number(item?.close);
      if(date && date <= target && Number.isFinite(close) && close > 0){
        return { date, close };
      }
    }
    return null;
  }

  function isReturnDailyExactHistoryDate(point, dateStr){
    return !!point && String(point.date || '').slice(0, 10) === String(dateStr || '').slice(0, 10);
  }

  function buildReturnDailyQtyBySymbol(cutoffDate){
    const qtyBySymbol = new Map();
    for(const txn of DB.txns || []){
      const type = String(txn?.type || '').trim();
      if(type !== 'buy' && type !== 'sell') continue;
      const date = getReturnDailyDateKey(txn.time || txn.date);
      if(!date || date > cutoffDate) continue;
      const stock = (DB.stocks || []).find(s => s.id === txn.stockId);
      const symbol = String(stock?.symbol || '').trim().toUpperCase();
      if(!symbol) continue;
      const qty = parseN(txn.qty);
      if(!Number.isFinite(qty) || qty <= 0) continue;
      qtyBySymbol.set(symbol, (qtyBySymbol.get(symbol) || 0) + (type === 'buy' ? qty : -qty));
    }
    return Array.from(qtyBySymbol.entries())
      .map(([symbol, qty]) => ({ symbol, qty: roundHoldingQty(qty) }))
      .filter(row => row.qty > 0);
  }

  async function getReturnDailyHistory(symbol){
    const sym = String(symbol || '').trim().toUpperCase();
    if(!sym) return null;
    if(returnDailyHistoryCache[sym]) return returnDailyHistoryCache[sym];
    returnDailyHistoryCache[sym] = fetchPriceHistory(sym, false).catch(() => null);
    return returnDailyHistoryCache[sym];
  }

  async function calculateReturnDailyMarketPnl(prevDate, currentDate){
    if(!prevDate || !currentDate) return { value: null, missing: 0, used: 0 };
    const positions = buildReturnDailyQtyBySymbol(prevDate);
    if(!positions.length) return { value: 0, missing: 0, used: 0 };
    const results = await Promise.all(positions.map(async (position) => {
      const history = await getReturnDailyHistory(position.symbol);
      const prev = getReturnDailyHistoryCloseOnOrBefore(history, prevDate);
      const current = getReturnDailyHistoryCloseOnOrBefore(history, currentDate);
      if(!prev || !current || !isReturnDailyExactHistoryDate(current, currentDate)){
        return {
          ...position,
          missing: true,
          staleCurrentDate: current?.date || '',
          requestedCurrentDate: currentDate
        };
      }
      return {
        ...position,
        prevClose: prev.close,
        currentClose: current.close,
        prevPriceDate: prev.date,
        currentPriceDate: current.date,
        pnl: (current.close - prev.close) * position.qty
      };
    }));
    const usedRows = results.filter(row => !row.missing && Number.isFinite(row.pnl));
    if(!usedRows.length) return { value: null, missing: results.length, used: 0 };
    const missingRows = results.length - usedRows.length;
    if(missingRows > 0){
      return {
        value: null,
        missing: missingRows,
        used: usedRows.length,
        rows: usedRows
      };
    }
    return {
      value: usedRows.reduce((sum, row) => sum + row.pnl, 0),
      missing: 0,
      used: usedRows.length,
      rows: usedRows
    };
  }

  function getReturnDailySourceSnapshots(rangeKey){
    const snapshots = getRenderableSnapshots();
    if(rangeKey === 'all') return snapshots;
    const visible = filterReturnChartDateData(snapshots, rangeKey, s => s.date);
    if(!visible.length) return visible;
    const firstDate = visible[0].date;
    const previous = snapshots.slice().reverse().find(s => s.date < firstDate);
    return previous ? [previous, ...visible] : visible;
  }

  async function buildReturnDailyChangeSeries(sourceSnapshots, options = {}){
    const useOfficialClose = options.useOfficialClose !== false;
    const points = [];
    const snapshots = Array.isArray(sourceSnapshots) ? sourceSnapshots : getRenderableSnapshots();
    const cashFlowEvents = buildCashFlowEvents();
    const cashFlowByDate = new Map();

    cashFlowEvents.forEach((event) => {
      const date = String(event?.date || '').slice(0, 10);
      if(!date) return;
      const amount = parseN(event.amount);
      if(!Number.isFinite(amount)) return;
      cashFlowByDate.set(date, (cashFlowByDate.get(date) || 0) + amount);
    });

    let prevSnapshot = null;
    for(const s of snapshots){
      const ts = Date.parse(`${s.date}T12:00:00`);
      const total = parseN(s.total);
      if(!Number.isFinite(ts) || !Number.isFinite(total)) continue;
      const prevTotal = prevSnapshot ? parseN(prevSnapshot.total) : null;
      const hasPrev = prevSnapshot && Number.isFinite(prevTotal);
      const delta = hasPrev ? total - prevTotal : 0;
      let cashFlow = 0;
      if(hasPrev){
        for(const [date, amount] of cashFlowByDate.entries()){
          if(date > prevSnapshot.date && date <= s.date) cashFlow += amount;
        }
      }
      cashFlow = Math.round(cashFlow);
      const officialMarket = hasPrev && useOfficialClose
        ? await calculateReturnDailyMarketPnl(prevSnapshot.date, s.date)
        : { value: null, missing: 0, used: 0 };
      const marketPnlRaw = hasPrev && Number.isFinite(officialMarket.value)
        ? officialMarket.value
        : (hasPrev ? delta - cashFlow : 0);
      const marketPnl = hasPrev ? Math.round(marketPnlRaw) : 0;
      const marketPct = hasPrev && prevTotal !== 0 ? (marketPnl / prevTotal) * 100 : null;
      const marketGain = marketPnl > 0 ? marketPnl : 0;
      const marketLoss = marketPnl < 0 ? marketPnl : 0;
      const positiveStackTop = marketGain + Math.max(0, cashFlow);
      const negativeStackBottom = marketLoss + Math.min(0, cashFlow);
      const totalDeltaLabelValue = Math.max(0, positiveStackTop);
      const totalDeltaLabelText = hasPrev
        ? `${marketPnl >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(Math.round(marketPnl)))}`
        : '';
      const totalDeltaLabelColor = !hasPrev
        ? '#0f172a'
        : (marketPnl > 0 ? '#166534' : (marketPnl < 0 ? '#dc2626' : '#0f172a'));
      points.push({
        x: ts,
        date: s.date,
        total: Math.round(total),
        prevTotal: hasPrev ? Math.round(prevTotal) : null,
        delta: Math.round(delta),
        cashFlow,
        marketPnl,
        marketPnlSource: Number.isFinite(officialMarket.value) ? 'official-close' : 'snapshot-delta',
        marketPnlMissingCount: officialMarket.missing || 0,
        marketPnlUsedCount: officialMarket.used || 0,
        marketPct,
        marketGain,
        marketLoss,
        positiveStackTop,
        negativeStackBottom,
        totalDeltaLabelValue,
        totalDeltaLabelText,
        totalDeltaLabelColor
      });
      prevSnapshot = s;
    }
    return points;
  }

  function renderReturnDailyChangeChartFallback(chartDiv, points){
    const width = 760;
    const height = 220;
    const pad = { top: 18, right: 18, bottom: 32, left: 70 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const maxAbs = Math.max(
      1,
      ...points.map(p => Math.max(Math.abs(parseN(p.positiveStackTop)), Math.abs(parseN(p.negativeStackBottom))))
    );
    const yFor = (v) => pad.top + innerH / 2 - (parseN(v) / maxAbs) * (innerH / 2 - 8);
    const zeroY = yFor(0);
    const slotW = innerW / points.length;
    const barW = Math.max(3, Math.min(18, slotW * 0.62));
    const maxLabels = 6;
    const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));
    const rectForRange = (x, fromValue, toValue, color, title) => {
      if(!Number.isFinite(fromValue) || !Number.isFinite(toValue) || Math.abs(toValue - fromValue) < 0.0001) return '';
      const topValue = Math.max(fromValue, toValue);
      const bottomValue = Math.min(fromValue, toValue);
      const y = yFor(topValue);
      const h = Math.max(1, Math.abs(yFor(bottomValue) - yFor(topValue)));
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="2" fill="${color}"><title>${title}</title></rect>`;
    };
    const labels = points.map((p, i) => {
      const x = pad.left + i * slotW + (slotW - barW) / 2;
      const dateText = p.date.replace(/-/g, '/');
      const bars = [
        rectForRange(
          x,
          0,
          p.cashFlow > 0 ? p.cashFlow : 0,
          '#94a3b8',
          `${dateText} 資金流 ${p.cashFlow >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(Math.round(p.cashFlow)))}`
        ),
        rectForRange(
          x,
          Math.max(0, p.cashFlow),
          Math.max(0, p.cashFlow) + p.marketGain,
          '#166534',
          `${dateText} 市場損益 +${fmtInt.format(Math.abs(Math.round(p.marketGain)))}`
        ),
        rectForRange(
          x,
          0,
          p.cashFlow < 0 ? p.cashFlow : 0,
          '#94a3b8',
          `${dateText} 資金流 ${p.cashFlow >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(Math.round(p.cashFlow)))}`
        ),
        rectForRange(
          x,
          Math.min(0, p.cashFlow),
          Math.min(0, p.cashFlow) + p.marketLoss,
          '#dc2626',
          `${dateText} 市場損益 -${fmtInt.format(Math.abs(Math.round(p.marketLoss)))}`
        )
      ].join('');

      const showLabel = !!p.totalDeltaLabelText;
      const labelValue = p.totalDeltaLabelValue;
      const labelY = yFor(labelValue) - 8;
      const labelText = showLabel ? p.totalDeltaLabelText : '';
      const label = showLabel
        ? `<text x="${(x + barW / 2).toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle" font-size="10" font-weight="700" fill="${p.totalDeltaLabelColor || '#0f172a'}">${labelText}</text>`
        : '';
      return bars + label;
    }).join('');
    const xLabels = points
      .filter((_, i) => i % labelStep === 0 || i === points.length - 1)
      .map((p, i, arr) => {
        const sourceIndex = points.indexOf(p);
        const x = pad.left + sourceIndex * slotW + slotW / 2;
        const text = p.date.slice(5).replace('-', '/');
        return `<text x="${x.toFixed(2)}" y="${height - 10}" text-anchor="${i === 0 ? 'start' : (i === arr.length - 1 ? 'end' : 'middle')}" font-size="10" fill="#64748b">${text}</text>`;
      }).join('');
    chartDiv.style.height = `${height}px`;
    chartDiv.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;width:100%;height:${height}px" preserveAspectRatio="xMidYMid meet" aria-label="每日市場損益與資金流">
        <line x1="${pad.left}" y1="${zeroY.toFixed(2)}" x2="${width - pad.right}" y2="${zeroY.toFixed(2)}" stroke="#cbd5e1" stroke-width="1"></line>
        ${labels}
        ${xLabels}
      </svg>`;
  }

  async function renderReturnDailyChangeChart(options = {}){
    const wrap = $('#perf-chart-wrap');
    const msgEl = $('#perf-chart-msg');
    const chartDiv = $('#perf-chart');
    if(!wrap || !chartDiv) return;

    const sourceSnapshots = getReturnDailySourceSnapshots(returnChartRange);
    const allPoints = await buildReturnDailyChangeSeries(sourceSnapshots, options);
    const points = filterReturnChartDateData(allPoints, returnChartRange, p => p.date);
    const isFiltered = returnChartRange !== 'all';
    const rangeLabel = getReturnChartRangeLabel(returnChartRange);

    const clearChart = () => { returnDailyChangeChart = destroyChartInstance(returnDailyChangeChart); };

    if(points.length < 2){
      clearChart();
      setChartSurfaceState({
        msgEl,
        chartDiv,
        message: isFiltered && allPoints.length >= 2
          ? `選定週期（${rangeLabel}）內快照筆數不足（至少 2 筆），無法繪製每日總資產增減`
          : '快照筆數不足（至少 2 筆），無法繪製每日總資產增減',
        showMessage: true,
        hideChart: true
      });
      return;
    }

    const hasRuntime = await ensureChartRuntime({ msgEl, chartDiv });
    if(!hasRuntime){
      // treemap 模組載入失敗時，Highcharts 本身仍可用；若完全不可用才 fallback SVG
      if(typeof Highcharts === 'undefined'){
        clearChart();
        setChartSurfaceState({ msgEl, chartDiv, showMessage: false, hideChart: false });
        renderReturnDailyChangeChartFallback(chartDiv, points);
        return;
      }
      // Highcharts 已載入（只是 treemap 失敗），繼續正常渲染柱狀圖
    }

    const categories = points.map(p => p.date.replace(/-/g, '/'));
    const marketGainData = points.map(p => ({
      y: p.marketGain,
      custom: { ...p, hasBreakdown: true }
    }));
    const marketLossData = points.map(p => ({
      y: p.marketLoss,
      custom: { ...p, hasBreakdown: true }
    }));
    const cashFlowData = points.map(p => ({
      y: p.cashFlow,
      custom: { ...p, hasBreakdown: true }
    }));
    const totalDeltaLabelData = points.map((p, idx) => (
      p.totalDeltaLabelText
        ? { x: idx, y: p.totalDeltaLabelValue, custom: { text: p.totalDeltaLabelText, color: p.totalDeltaLabelColor } }
        : null
    ));

    clearChart();
    returnDailyChangeChart = Highcharts.chart(chartDiv, {
      chart: { type: 'column', height: 220, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: {
        categories,
        tickmarkPlacement: 'on',
        labels: {
          formatter(){ return this.value; }
        }
      },
      yAxis: {
        title: { text: null },
        min: -200000,
        max: 300000,
        labels: {
          formatter(){ return fmtInt.format(Math.round(this.value)); }
        },
        plotLines: [{ value: 0, color: '#94a3b8', width: 1, dashStyle: 'Dash' }]
      },
      tooltip: {
        shared: true,
        formatter(){
          const corePoint = (this.points || []).find(pt => pt.point?.custom?.hasBreakdown)?.point;
          const payload = corePoint?.custom || {};
          const dateText = payload.date ? String(payload.date).replace(/-/g, '/') : String(this.x || '');
          const delta = Number.isFinite(payload.delta) ? Math.round(payload.delta) : 0;
          const marketPnl = Number.isFinite(payload.marketPnl) ? Math.round(payload.marketPnl) : 0;
          const cashFlow = Number.isFinite(payload.cashFlow) ? Math.round(payload.cashFlow) : 0;
          const pctText = Number.isFinite(payload.marketPct)
            ? `${payload.marketPct >= 0 ? '+' : ''}${payload.marketPct.toFixed(2)}%`
            : '—';
          return [
            `<b>${dateText}</b>`,
            `市場損益（收盤價重算）：${marketPnl >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(marketPnl))}`,
            `總資產快照差額：${delta >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(delta))}`,
            `人為入金/出金金額：${cashFlow >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(cashFlow))}`,
            `漲跌百分比：${pctText}`,
            payload.marketPnlSource === 'official-close'
              ? `價格來源：官方收盤價${payload.marketPnlMissingCount ? `（${payload.marketPnlMissingCount} 檔缺歷史價）` : ''}`
              : '價格來源：快照差額 fallback',
            `總資產：${fmtInt.format(Math.round(payload.total || 0))}`
          ].join('<br/>');
        }
      },
      legend: { enabled: false },
      plotOptions: {
        column: { borderWidth: 0, pointPadding: 0.08, groupPadding: 0.18, stacking: 'normal' },
        series: { animation: false }
      },
      series: [
        {
          name: '資金流',
          type: 'column',
          data: cashFlowData,
          color: '#94a3b8',
          stack: 'delta'
        },
        {
          name: '市場損益',
          type: 'column',
          data: marketGainData,
          color: '#166534',
          stack: 'delta'
        },
        {
          name: '市場損益',
          type: 'column',
          data: marketLossData,
          color: '#dc2626',
          stack: 'delta'
        },
        {
          name: '市場損益標籤',
          type: 'scatter',
          data: totalDeltaLabelData,
          color: 'transparent',
          enableMouseTracking: false,
          showInLegend: false,
          marker: { enabled: false },
          dataLabels: {
            enabled: true,
            y: -10,
            style: { fontWeight: '700', textOutline: 'none' },
            formatter(){
              return this.point?.custom?.text || '';
            },
            color(){
              return this.point?.custom?.color || '#0f172a';
            }
          }
        }
      ],
      credits: { enabled: false }
    });
  }
