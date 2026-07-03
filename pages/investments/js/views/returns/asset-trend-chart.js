  // ========= Returns / 資產走勢圖 =========
  // 從 returns.js 拆出（2026-05-17）
  // 依賴：shared.js（setChartSurfaceState、loadHighchartsIfNeeded、filterReturnChartDateData 等）

  function buildReturnAssetTrendSeries(input = {}){
    const payload = (input && typeof input === 'object')
      ? input
      : { totalAssetsNow: input };
    const totalAssetsNow = parseN(payload.totalAssetsNow);
    const holdingsNow = parseN(payload.holdingsNow);
    const cashNow = parseN(payload.cashNow);
    const todayLocalStr = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })();
    const points = [];
    const seen = new Set();
    const snapshots = getRenderableSnapshots();
    for(const s of snapshots){
      const ts = Date.parse(`${s.date}T12:00:00`);
      const val = parseN(s.total);
      if(!Number.isFinite(ts) || !Number.isFinite(val)) continue;
      let holdingsAtDate = parseN(s.holdings);
      let cashAtDate = parseN(s.cash);
      if(!Number.isFinite(holdingsAtDate) && Number.isFinite(cashAtDate)){
        holdingsAtDate = val - cashAtDate;
      }else if(Number.isFinite(holdingsAtDate) && !Number.isFinite(cashAtDate)){
        cashAtDate = val - holdingsAtDate;
      }else if(!Number.isFinite(holdingsAtDate) && !Number.isFinite(cashAtDate)){
        holdingsAtDate = val;
        cashAtDate = 0;
      }
      const holdingsRounded = Math.round(holdingsAtDate);
      const cashRounded = Math.round(cashAtDate);
      const hasStoredReturnAmount = s.returnAmount !== undefined && s.returnAmount !== null && s.returnAmount !== '';
      const computedInvestedAtDate = getInitialCapitalAmount() + sumCapitalAdjustments(s.date);
      const storedGainAtDate = hasStoredReturnAmount ? parseN(s.returnAmount) : null;
      const gainAtDate = Number.isFinite(storedGainAtDate) ? storedGainAtDate : (val - computedInvestedAtDate);
      const investedAtDate = Number.isFinite(storedGainAtDate) ? (val - storedGainAtDate) : computedInvestedAtDate;
      const investedRounded = Number.isFinite(investedAtDate) ? Math.round(investedAtDate) : null;
      const gainRounded = Number.isFinite(gainAtDate) ? Math.round(gainAtDate) : null;
      points.push({
        x: ts,
        total: Math.round(val),
        holdings: holdingsRounded,
        cash: cashRounded,
        invested: investedRounded,
        gain: gainRounded,
        positiveStackTop: Math.max(0, gainRounded || 0) + Math.max(0, investedRounded || 0),
        date: s.date
      });
      seen.add(s.date);
    }
    if(Number.isFinite(totalAssetsNow) && totalAssetsNow > 0 && !seen.has(todayLocalStr)){
      const tsToday = Date.parse(`${todayLocalStr}T12:00:00`);
      if(Number.isFinite(tsToday)){
        let holdingsAtDate = holdingsNow;
        let cashAtDate = cashNow;
        if(!Number.isFinite(holdingsAtDate) && Number.isFinite(cashAtDate)){
          holdingsAtDate = totalAssetsNow - cashAtDate;
        }else if(Number.isFinite(holdingsAtDate) && !Number.isFinite(cashAtDate)){
          cashAtDate = totalAssetsNow - holdingsAtDate;
        }else if(!Number.isFinite(holdingsAtDate) && !Number.isFinite(cashAtDate)){
          holdingsAtDate = totalAssetsNow;
          cashAtDate = 0;
        }
        const holdingsRounded = Math.round(holdingsAtDate);
        const cashRounded = Math.round(cashAtDate);
        const investedToday = getInitialCapitalAmount() + sumCapitalAdjustments(todayLocalStr);
        const gainToday = totalAssetsNow - investedToday;
        const investedRounded = Number.isFinite(investedToday) ? Math.round(investedToday) : null;
        const gainRounded = Number.isFinite(gainToday) ? Math.round(gainToday) : null;
        points.push({
          x: tsToday,
          total: Math.round(totalAssetsNow),
          holdings: holdingsRounded,
          cash: cashRounded,
          invested: investedRounded,
          gain: gainRounded,
          positiveStackTop: Math.max(0, gainRounded || 0) + Math.max(0, investedRounded || 0),
          date: todayLocalStr
        });
      }
    }
    points.sort((a, b) => a.x - b.x);
    return points;
  }

  function renderReturnAssetTrendChartFallback(chartDiv, points){
    if(!Array.isArray(points) || points.length < 2){
      chartDiv.innerHTML = '<div class="empty">尚無資料</div>';
      return;
    }
    const width = 960;
    const height = 300;
    const pad = { top: 24, right: 18, bottom: 38, left: 56 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const slotW = innerW / points.length;
    const barW = Math.max(12, Math.min(28, slotW * 0.56));
    const assetTops = points.map(p => Math.max(parseN(p.positiveStackTop), parseN(p.total), parseN(p.invested), 0));
    const gainVals = points.map(p => parseN(p.gain)).filter(Number.isFinite);
    const assetMin = Math.min(0, ...gainVals.filter(v => v < 0), 0);
    const assetMax = Math.max(...assetTops, 1);
    const assetSpan = assetMax - assetMin || 1;

    const yAsset = (value) => pad.top + ((assetMax - value) / assetSpan) * innerH;
    const xAt = (idx) => pad.left + idx * slotW + slotW / 2;
    const leftTicks = Array.from({ length: 5 }, (_, i) => assetMin + (assetSpan * i) / 4);

    const grids = leftTicks.map(value => {
      const y = yAsset(value);
      return `<line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${width - pad.right}" y2="${y.toFixed(2)}" stroke="#e2e8f0" stroke-width="1"></line>`;
    }).join('');
    const leftLabels = leftTicks.map(value => {
      const y = yAsset(value);
      return `<text x="${pad.left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="10" fill="#64748b">${formatReturnWanLabel(value)}</text>`;
    }).join('');

    const bars = points.map((p, idx) => {
      const cx = xAt(idx);
      const x = cx - barW / 2;
      const gain = parseN(p.gain);
      const invested = parseN(p.invested);
      const totalLabelYValue = Math.max(parseN(p.positiveStackTop), parseN(p.total), 0);
      const totalLabelY = Math.max(pad.top + 10, yAsset(totalLabelYValue) - 6);
      const parts = [];
      if(Number.isFinite(gain) && gain !== 0){
        const y0 = yAsset(0);
        const y1 = yAsset(gain);
        const rectY = Math.min(y0, y1);
        const rectH = Math.abs(y1 - y0);
        const labelY = rectY + rectH / 2 + 4;
        parts.push(`<rect x="${x.toFixed(2)}" y="${rectY.toFixed(2)}" width="${barW.toFixed(2)}" height="${rectH.toFixed(2)}" rx="3" fill="${gain >= 0 ? '#10b981' : '#ef4444'}"></rect>`);
        if(rectH >= 16){
          parts.push(`<text x="${cx.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${formatReturnWanNumber(gain)}</text>`);
        }
      }
      if(Number.isFinite(invested) && invested !== 0){
        const start = Math.max(0, gain || 0);
        const end = start + invested;
        const y0 = yAsset(start);
        const y1 = yAsset(end);
        const rectY = Math.min(y0, y1);
        const rectH = Math.abs(y1 - y0);
        const labelY = rectY + rectH / 2 + 4;
        parts.push(`<rect x="${x.toFixed(2)}" y="${rectY.toFixed(2)}" width="${barW.toFixed(2)}" height="${rectH.toFixed(2)}" rx="3" fill="#93c5fd"></rect>`);
        if(rectH >= 16){
          parts.push(`<text x="${cx.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle" font-size="9" font-weight="700" fill="#0f172a">${formatReturnWanNumber(invested)}</text>`);
        }
      }
      parts.push(`<text x="${cx.toFixed(2)}" y="${totalLabelY.toFixed(2)}" text-anchor="middle" font-size="10" font-weight="700" fill="#0f172a">${formatReturnWanNumber(p.total || 0)}</text>`);
      return parts.join('');
    }).join('');
    const xLabels = points.map((p, idx) => {
      if(!(idx % Math.max(1, Math.ceil(points.length / 6)) === 0 || idx === points.length - 1)) return '';
      return `<text x="${xAt(idx).toFixed(2)}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#64748b">${String(p.date || '').slice(5).replace('-', '/')}</text>`;
    }).join('');

    chartDiv.style.height = `${height}px`;
    chartDiv.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;width:100%;height:${height}px" preserveAspectRatio="xMidYMid meet" aria-label="總資產結構">
        ${grids}
        ${leftLabels}
        <line x1="${pad.left}" y1="${yAsset(0).toFixed(2)}" x2="${width - pad.right}" y2="${yAsset(0).toFixed(2)}" stroke="#cbd5e1" stroke-width="1"></line>
        ${bars}
        ${xLabels}
      </svg>`;
  }

  async function renderReturnAssetTrendChart(input = {}){
    const wrap = $('#return-asset-chart-wrap');
    const msgEl = $('#return-asset-chart-msg');
    const chartDiv = $('#return-asset-chart');
    if(!wrap || !chartDiv) return;

    const clearChart = () => { returnAssetTrendChart = destroyChartInstance(returnAssetTrendChart); };

    const allPoints = buildReturnAssetTrendSeries(input);
    const points = filterReturnChartDateData(allPoints, returnChartRange, p => p.date);
    const isFiltered = returnChartRange !== 'all';
    const rangeLabel = getReturnChartRangeLabel(returnChartRange);
    if(points.length < 2){
      clearChart();
      setChartSurfaceState({
        msgEl,
        chartDiv,
        message: isFiltered && allPoints.length >= 2
          ? `選定週期（${rangeLabel}）內快照筆數不足（至少 2 筆），無法繪製總資產結構`
          : '快照筆數不足（至少 2 筆），無法繪製總資產結構',
        showMessage: true,
        hideChart: true
      });
      return;
    }

    const hasRuntime = await ensureChartRuntime({ msgEl, chartDiv });
    if(!hasRuntime){
      if(typeof Highcharts === 'undefined'){
        clearChart();
        setChartSurfaceState({ msgEl, chartDiv, showMessage: false, hideChart: false });
        renderReturnAssetTrendChartFallback(chartDiv, points);
        return;
      }
    }

    const categories = points.map(p => p.date.replace(/-/g, '/'));
    const gainPoints = points.map(p => ({
      y: p.gain,
      custom: { ...p }
    }));
    const investedPoints = points.map(p => ({
      y: p.invested,
      custom: { ...p }
    }));
    const totalLabelPoints = points.map((p, idx) => ({
      x: idx,
      y: Math.max(parseN(p.positiveStackTop), parseN(p.total), 0),
      custom: { ...p, text: formatReturnWanNumber(p.total || 0), isLabel: true }
    }));

    clearChart();
    returnAssetTrendChart = Highcharts.chart(chartDiv, {
      chart: { height: 300, backgroundColor: 'transparent' },
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
        min: Math.min(0, ...points.map(p => parseN(p.gain)).filter(v => Number.isFinite(v) && v < 0)),
        tickInterval: 1000000,
        labels: {
          formatter(){ return formatReturnWanLabel(this.value); }
        }
      },
      tooltip: {
        shared: true,
        formatter(){
          const corePoint = (this.points || []).find(pt => !pt.point?.custom?.isLabel)?.point;
          const payload = corePoint?.custom || {};
          const dateText = payload.date
            ? String(payload.date).replace(/-/g, '/')
            : String(this.x || '');
          const invested = Number.isFinite(payload.invested) ? Math.round(payload.invested) : 0;
          const gain = Number.isFinite(payload.gain) ? Math.round(payload.gain) : 0;
          const total = Number.isFinite(payload.total) ? Math.round(payload.total) : (invested + gain);
          const returnPct = invested !== 0 ? (gain / invested * 100) : null;
          return [
            `<b>${dateText}</b>`,
            `<span style="color:${gain >= 0 ? '#10b981' : '#ef4444'}">●</span> 總報酬金額：${gain >= 0 ? '' : '-'}${fmtInt.format(Math.abs(gain))}`,
            `<span style="color:#93c5fd">●</span> 投入資金：${fmtInt.format(invested)}`,
            Number.isFinite(returnPct) ? `<span style="color:#64748b">●</span> 報酬率：${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%` : '',
            `<span style="color:#0f172a">●</span> 總資產：${fmtInt.format(total)}`
          ].filter(Boolean).join('<br/>');
        }
      },
      legend: { enabled: true },
      plotOptions: {
        column: {
          stacking: 'normal',
          borderWidth: 0,
          pointPadding: 0.08,
          groupPadding: 0.18,
          dataLabels: {
            enabled: true,
            inside: true,
            crop: false,
            overflow: 'none',
            formatter(){
              const value = Number(this.y);
              if(!Number.isFinite(value) || value === 0) return '';
              return formatReturnWanNumber(value);
            },
            style: { fontSize: '11px', fontWeight: '700', textOutline: 'none' }
          }
        },
        series: { animation: false }
      },
      series: [
        {
          type: 'column',
          name: '總報酬金額',
          data: gainPoints,
          color: '#10b981',
          negativeColor: '#ef4444',
          dataLabels: { color: '#fff' },
          yAxis: 0,
          stack: 'asset'
        },
        {
          type: 'column',
          name: '投入資金',
          data: investedPoints,
          color: '#93c5fd',
          dataLabels: { color: '#0f172a' },
          yAxis: 0,
          stack: 'asset'
        },
        {
          type: 'scatter',
          name: '總資產標籤',
          data: totalLabelPoints,
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
            color: '#0f172a'
          }
        }
      ],
      credits: { enabled: false }
    });
  }
