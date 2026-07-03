  // ========= Returns / 每日變動圖 =========
  // 從 returns.js 拆出（2026-05-17）
  // 依賴：shared.js（setChartSurfaceState、loadHighchartsIfNeeded、filterReturnChartDateData、buildCashFlowEvents、getRenderableSnapshots 等）

  function buildReturnDailyChangeSeries(){
    const points = [];
    const snapshots = getRenderableSnapshots();
    const cashFlowEvents = buildCashFlowEvents();
    const cashFlowByDate = new Map();

    cashFlowEvents.forEach((event) => {
      const date = String(event?.date || '').slice(0, 10);
      if(!date) return;
      const amount = parseN(event.amount);
      if(!Number.isFinite(amount)) return;
      cashFlowByDate.set(date, (cashFlowByDate.get(date) || 0) + amount);
    });

    let prevTotal = null;
    for(const s of snapshots){
      const ts = Date.parse(`${s.date}T12:00:00`);
      const total = parseN(s.total);
      if(!Number.isFinite(ts) || !Number.isFinite(total)) continue;
      const hasPrev = Number.isFinite(prevTotal);
      const delta = hasPrev ? total - prevTotal : 0;
      const cashFlow = hasPrev ? Math.round(cashFlowByDate.get(s.date) || 0) : 0;
      const marketPnl = hasPrev ? Math.round(delta - cashFlow) : 0;
      const marketPct = hasPrev && prevTotal !== 0 ? (marketPnl / prevTotal) * 100 : null;
      const marketGain = marketPnl > 0 ? marketPnl : 0;
      const marketLoss = marketPnl < 0 ? marketPnl : 0;
      const positiveStackTop = marketGain + Math.max(0, cashFlow);
      const negativeStackBottom = marketLoss + Math.min(0, cashFlow);
      const totalDeltaLabelValue = Math.max(0, positiveStackTop);
      const totalDeltaLabelText = hasPrev
        ? `${delta >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(Math.round(delta)))}`
        : '';
      const totalDeltaLabelColor = !hasPrev
        ? '#0f172a'
        : (delta > 0 ? '#166534' : (delta < 0 ? '#dc2626' : '#0f172a'));
      points.push({
        x: ts,
        date: s.date,
        total: Math.round(total),
        prevTotal: hasPrev ? Math.round(prevTotal) : null,
        delta: Math.round(delta),
        cashFlow,
        marketPnl,
        marketPct,
        marketGain,
        marketLoss,
        positiveStackTop,
        negativeStackBottom,
        totalDeltaLabelValue,
        totalDeltaLabelText,
        totalDeltaLabelColor
      });
      prevTotal = total;
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
          `${dateText} 市場增益 +${fmtInt.format(Math.abs(Math.round(p.marketGain)))}`
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
          `${dateText} 市場損失 -${fmtInt.format(Math.abs(Math.round(p.marketLoss)))}`
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
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;width:100%;height:${height}px" preserveAspectRatio="xMidYMid meet" aria-label="每日總資產增減金額">
        <line x1="${pad.left}" y1="${zeroY.toFixed(2)}" x2="${width - pad.right}" y2="${zeroY.toFixed(2)}" stroke="#cbd5e1" stroke-width="1"></line>
        ${labels}
        ${xLabels}
      </svg>`;
  }

  async function renderReturnDailyChangeChart(){
    const wrap = $('#perf-chart-wrap');
    const msgEl = $('#perf-chart-msg');
    const chartDiv = $('#perf-chart');
    if(!wrap || !chartDiv) return;

    const allPoints = buildReturnDailyChangeSeries();
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
            `每日總資產增減：${delta >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(delta))}`,
            `市場波動金額：${marketPnl >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(marketPnl))}`,
            `人為入金/出金金額：${cashFlow >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(cashFlow))}`,
            `漲跌百分比：${pctText}`,
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
          name: '市場增益',
          type: 'column',
          data: marketGainData,
          color: '#166534',
          stack: 'delta'
        },
        {
          name: '市場損失',
          type: 'column',
          data: marketLossData,
          color: '#dc2626',
          stack: 'delta'
        },
        {
          name: '總資產增減標籤',
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
