  // ========= 歷史分析（資料來源：meta.dailyArchive 每日封存）=========
  // 三個區塊：兩日比較、趨勢圖（佔比 / 損益率 / 分層堆疊）、JSON / CSV 匯出。

  let analysisChartAlloc = null;
  let analysisChartPnl = null;
  let analysisChartTier = null;

  function getArchiveDatesAsc(){
    return Object.keys(DB.meta?.dailyArchive || {}).sort();
  }

  function renderAnalysis(){
    const selA = document.getElementById('analysis-date-a');
    const selB = document.getElementById('analysis-date-b');
    const compareEl = document.getElementById('analysis-compare');
    if(!selA || !selB || !compareEl) return;

    const dates = getArchiveDatesAsc();
    if(dates.length < 1){
      compareEl.innerHTML = `<div class="empty">封存資料累積中。每天開啟頁面且報價更新成功後會自動封存一筆；也可在「設定」頁手動「立即封存」。累積 2 天以上即可比較。</div>`;
      selA.innerHTML = selB.innerHTML = '';
      return;
    }

    const prevA = selA.value;
    const prevB = selB.value;
    const optionsHtml = dates.slice().reverse().map(d => `<option value="${d}">${d}</option>`).join('');
    selA.innerHTML = optionsHtml;
    selB.innerHTML = optionsHtml;
    selA.value = dates.includes(prevA) ? prevA : (dates[Math.max(0, dates.length - 2)]);
    selB.value = dates.includes(prevB) ? prevB : dates[dates.length - 1];

    renderAnalysisCompare();
    renderAnalysisCharts();
  }

  function renderAnalysisCompare(){
    const compareEl = document.getElementById('analysis-compare');
    const a = DB.meta?.dailyArchive?.[document.getElementById('analysis-date-a')?.value];
    const b = DB.meta?.dailyArchive?.[document.getElementById('analysis-date-b')?.value];
    if(!compareEl) return;
    if(!a || !b){
      compareEl.innerHTML = '<div class="empty">請選擇兩個封存日期（需累積 2 天以上）。</div>';
      return;
    }

    const fmtAmt = (v) => Number.isFinite(v) ? fmtInt.format(Math.round(v)) : '—';
    const fmtP = (v) => Number.isFinite(v) ? `${v.toFixed(2)}%` : '—';
    const deltaSpan = (v, isPct = false, digits = 2) => {
      if(!Number.isFinite(v)) return '<span class="muted">—</span>';
      const cls = v > 0 ? 'pos-text' : v < 0 ? 'neg-text' : 'muted';
      const text = isPct ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}pp` : `${v >= 0 ? '+' : ''}${fmtInt.format(Math.round(v))}`;
      return `<span class="${cls}">${text}</span>`;
    };

    const kpiPairs = [
      ['總資產', a.kpi?.totalAssets, b.kpi?.totalAssets, false],
      ['含息報酬率', a.kpi?.totalReturnPct, b.kpi?.totalReturnPct, true],
      ['現金比例', a.cashGov?.cashPct, b.cashGov?.cashPct, true],
      ['距峰值', a.kpi?.currentDrawdownPct, b.kpi?.currentDrawdownPct, true]
    ];
    const kpiHtml = `<div class="analysis-kpi-row">` + kpiPairs.map(([label, va, vb, isPct]) => `
      <div class="analysis-kpi-card">
        <div class="lbl">${label}</div>
        <div class="vals mini"><span class="muted">${a.date}：</span>${isPct ? fmtP(va) : fmtAmt(va)}</div>
        <div class="vals mini"><span class="muted">${b.date}：</span>${isPct ? fmtP(vb) : fmtAmt(vb)}</div>
        <div class="delta">${deltaSpan(Number.isFinite(vb) && Number.isFinite(va) ? vb - va : null, isPct)}</div>
      </div>`).join('') + '</div>';

    const symbols = new Map();
    (a.holdings || []).forEach(h => symbols.set(h.symbol, { a: h }));
    (b.holdings || []).forEach(h => {
      if(symbols.has(h.symbol)) symbols.get(h.symbol).b = h;
      else symbols.set(h.symbol, { b: h });
    });

    const tierText = { core: '核心', satellite: '衛星', flex: '偵查' };
    const rowsHtml = [...symbols.entries()].map(([sym, pair]) => {
      const ha = pair.a, hb = pair.b;
      const name = hb?.name || ha?.name || '';
      const tier = tierText[hb?.tier || ha?.tier] || '';
      const status = !ha ? '<span class="badge blue">新增</span>' : (!hb ? '<span class="badge gray">已出清</span>' : '');
      return `<tr>
        <td class="text-start">${sym} ${name} ${status}</td>
        <td>${tier}</td>
        <td class="num">${fmtP(ha?.allocPct)} → ${fmtP(hb?.allocPct)} ${deltaSpan(Number.isFinite(hb?.allocPct) && Number.isFinite(ha?.allocPct) ? hb.allocPct - ha.allocPct : null, true, 1)}</td>
        <td class="num">${fmtAmt(ha?.marketValue)} → ${fmtAmt(hb?.marketValue)} ${deltaSpan(Number.isFinite(hb?.marketValue) && Number.isFinite(ha?.marketValue) ? hb.marketValue - ha.marketValue : null)}</td>
        <td class="num">${fmtP(ha?.totalPnlPct)} → ${fmtP(hb?.totalPnlPct)} ${deltaSpan(Number.isFinite(hb?.totalPnlPct) && Number.isFinite(ha?.totalPnlPct) ? hb.totalPnlPct - ha.totalPnlPct : null, true, 1)}</td>
      </tr>`;
    }).join('');

    compareEl.innerHTML = kpiHtml + `
      <div class="table-wrap" style="margin-top:12px">
        <table>
          <thead><tr>
            <th class="text-start">標的</th><th>分層</th>
            <th class="num">佔比（${a.date} → ${b.date}）</th>
            <th class="num">市值</th>
            <th class="num">含息損益率</th>
          </tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="5" class="empty">兩日皆無持倉</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  function destroyAnalysisChart(chart){
    try{ chart?.destroy?.(); }catch(e){}
    return null;
  }

  function renderAnalysisCharts(){
    if(typeof Highcharts === 'undefined') return;
    const dates = getArchiveDatesAsc();
    if(dates.length < 2) return;
    const archive = DB.meta.dailyArchive;

    const allSymbols = new Map();
    for(const d of dates){
      for(const h of (archive[d]?.holdings || [])){
        if(!allSymbols.has(h.symbol)) allSymbols.set(h.symbol, h.name || '');
      }
    }

    const buildSeries = (field) => [...allSymbols.entries()].map(([sym, name]) => ({
      name: `${sym} ${name}`.trim(),
      data: dates.map(d => {
        const h = (archive[d]?.holdings || []).find(x => x.symbol === sym);
        return h && Number.isFinite(h[field]) ? h[field] : null;
      })
    }));

    const baseOpts = (titleSuffix) => ({
      chart: { backgroundColor: 'transparent', height: 280 },
      title: { text: null },
      credits: { enabled: false },
      xAxis: { categories: dates.map(d => d.slice(5).replace('-', '/')) },
      yAxis: { title: { text: null }, labels: { format: '{value}%' } },
      tooltip: { shared: true, valueSuffix: `%${titleSuffix ? `（${titleSuffix}）` : ''}` },
      plotOptions: { series: { animation: false, marker: { radius: 2.5 }, connectNulls: false } }
    });

    const allocEl = document.getElementById('analysis-chart-alloc');
    if(allocEl){
      analysisChartAlloc = destroyAnalysisChart(analysisChartAlloc);
      analysisChartAlloc = Highcharts.chart(allocEl, { ...baseOpts('佔總資產'), series: buildSeries('allocPct') });
    }
    const pnlEl = document.getElementById('analysis-chart-pnl');
    if(pnlEl){
      analysisChartPnl = destroyAnalysisChart(analysisChartPnl);
      analysisChartPnl = Highcharts.chart(pnlEl, { ...baseOpts('含息損益率'), series: buildSeries('totalPnlPct') });
    }
    const tierEl = document.getElementById('analysis-chart-tier');
    if(tierEl){
      analysisChartTier = destroyAnalysisChart(analysisChartTier);
      const tierSeriesDef = [
        ['core', '核心', '#0F766E'], ['satellite', '衛星', '#2563EB'],
        ['flex', '偵查', '#D97706'], ['cashPct', '現金', '#94a3b8']
      ];
      analysisChartTier = Highcharts.chart(tierEl, {
        ...baseOpts('佔總資產'),
        chart: { type: 'area', backgroundColor: 'transparent', height: 280 },
        plotOptions: { area: { stacking: 'normal', animation: false, marker: { enabled: false } } },
        series: tierSeriesDef.map(([key, label, color]) => ({
          name: label,
          color,
          data: dates.map(d => {
            const t = archive[d]?.tierAlloc;
            const v = key === 'cashPct' ? t?.cashPct : t?.[key];
            return Number.isFinite(v) ? v : null;
          })
        }))
      });
    }
  }

  function exportArchiveJSON(){
    const store = DB.meta?.dailyArchive || {};
    if(Object.keys(store).length === 0){ alert('尚無封存資料可匯出'); return; }
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-archive-${localDateStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportArchiveCSV(){
    const store = DB.meta?.dailyArchive || {};
    const dates = Object.keys(store).sort();
    if(dates.length === 0){ alert('尚無封存資料可匯出'); return; }
    const header = ['date','symbol','name','tier','qty','avgCost','price','marketValue','allocPct','unrealizedPnl','unrealizedPct','dividends','totalPnl','totalPnlPct','signal','totalAssets','cash','cashPct','totalReturnPct','currentDrawdownPct'];
    const lines = [header.join(',')];
    for(const d of dates){
      const e = store[d];
      for(const h of (e.holdings || [])){
        lines.push([
          d, h.symbol, `"${(h.name || '').replace(/"/g, '""')}"`, h.tier, h.qty, h.avgCost, h.price,
          h.marketValue, h.allocPct, h.unrealizedPnl, h.unrealizedPct, h.dividends, h.totalPnl, h.totalPnlPct,
          `"${h.signal || ''}"`, e.kpi?.totalAssets ?? '', e.kpi?.cash ?? '', e.cashGov?.cashPct ?? '',
          e.kpi?.totalReturnPct ?? '', e.kpi?.currentDrawdownPct ?? ''
        ].join(','));
      }
    }
    // BOM 讓 Excel 直接以 UTF-8 開啟不亂碼
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-archive-${localDateStr()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  (function bindAnalysisControls(){
    document.getElementById('analysis-date-a')?.addEventListener('change', renderAnalysisCompare);
    document.getElementById('analysis-date-b')?.addEventListener('change', renderAnalysisCompare);
    document.getElementById('btn-archive-export-json')?.addEventListener('click', exportArchiveJSON);
    document.getElementById('btn-archive-export-csv')?.addEventListener('click', exportArchiveCSV);
  })();
