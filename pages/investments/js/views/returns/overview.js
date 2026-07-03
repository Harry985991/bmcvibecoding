  // ========= Returns / 報酬總覽（#view-return） =========
  // 從 returns.js 拆出（2026-05-17）
  // 主入口：renderReturnOverview()，被 app.js / watchlist.js 呼叫
  // 依賴：shared.js（排序 / 格式化 / TWR）、daily-change-chart.js、asset-trend-chart.js

  function renderReturnContribBars(summary = calculatePortfolioSummary()){
    const el = $('#return-twr-bars');
    if(!el) return;
    const metrics = summary.heldRows
      .map(row => {
        const cb = parseN(row.costBasis);
        if(cb <= 0) return null;
        const r = parseN(row.totalPnl) / cb;
        return { symbol: row.stock.symbol, name: row.stock.name || '', r };
      })
      .filter(Boolean);
    metrics.sort((a, b) => b.r - a.r);
    if(metrics.length === 0){
      el.innerHTML = '<div class="empty">尚無持倉</div>';
      return;
    }
    const maxAbsR = metrics.reduce((m, x) => Math.max(m, Math.abs(x.r)), 0) || 1;
    el.innerHTML = metrics.map(x => {
      const pctStr = (x.r >= 0 ? '+' : '') + (x.r * 100).toFixed(2) + '%';
      let w;
      let cls;
      if(x.r >= 0){
        cls = 'pos';
        w = (x.r / maxAbsR) * 100;
        w = Math.min(100, Math.max(0, w));
      }else{
        cls = 'neg';
        w = (Math.abs(x.r) / maxAbsR) * 100;
        w = Math.min(100, Math.max(0, w));
      }
      return `<div class="return-contrib-row">
        <span class="return-contrib-sym">
          <span>${escapeAttr(x.symbol)}</span>
          <span class="return-contrib-name">${escapeAttr(x.name || '')}</span>
        </span>
        <div class="return-contrib-track"><div class="return-contrib-fill ${cls}" style="width:${w.toFixed(2)}%"></div></div>
        <span class="return-contrib-pct">${pctStr}</span>
      </div>`;
    }).join('');
  }

  function fmtReturnPct2FromDecimal(dec){
    if(dec == null || !Number.isFinite(dec)) return '—';
    const x = dec * 100;
    return (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
  }

  function fmtReturnPct2FromPercent(percentVal){
    if(percentVal == null || !Number.isFinite(percentVal)) return '—';
    return (percentVal >= 0 ? '+' : '') + percentVal.toFixed(2) + '%';
  }

  async function refreshReturnCharts(){
    syncReturnRangeButtons();
    const { totalAssets, holdingsMarketValue, cashAvailable } = returnChartLastInput;
    await renderReturnDailyChangeChart();
    await renderReturnAssetTrendChart({
      totalAssetsNow: totalAssets,
      holdingsNow: holdingsMarketValue,
      cashNow: cashAvailable
    });
  }

  async function renderReturnOverview(summary = calculatePortfolioSummary()){
    const tbody = $('#tbl-return tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    syncReturnRangeButtons();

    const hintEl = $('#return-twr-hint');
    const kpiRow = $('#return-kpi-row');

    const holdingsMv = summary.holdingsMarketValue;
    const cashAvail = summary.cashAvailable;
    const totalAssets = summary.totalAssets;
    const investedCapital = getInitialCapitalAmount() + sumCapitalAdjustments();
    const simpleDec = investedCapital !== 0 ? (totalAssets - investedCapital) / investedCapital : null;
    const simplePct = simpleDec != null && Number.isFinite(simpleDec) ? simpleDec * 100 : null;
    const todayLocalStr = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })();
    const snapshotsAsc = getRenderableSnapshots();
    let dailyBase = null;
    let dailyBaseDate = '';
    if(snapshotsAsc.length > 0){
      const latest = snapshotsAsc[snapshotsAsc.length - 1];
      const latestTotal = parseN(latest.total);
      if(latest.date === todayLocalStr && snapshotsAsc.length >= 2){
        const prev = snapshotsAsc[snapshotsAsc.length - 2];
        const prevTotal = parseN(prev.total);
        if(Number.isFinite(prevTotal) && prevTotal > 0){
          dailyBase = prevTotal;
          dailyBaseDate = prev.date;
        }
      }
      if((dailyBase == null || !Number.isFinite(dailyBase)) && Number.isFinite(latestTotal) && latestTotal > 0){
        dailyBase = latestTotal;
        dailyBaseDate = latest.date;
      }
    }
    const dailyDelta = Number.isFinite(dailyBase) ? (totalAssets - dailyBase) : null;
    const dailyPct = Number.isFinite(dailyBase) && dailyBase !== 0 && Number.isFinite(dailyDelta)
      ? (dailyDelta / dailyBase * 100)
      : null;

    if(hintEl){
      hintEl.style.display = 'none';
      hintEl.textContent = '';
    }

    if(kpiRow){
      const simpleHtml = simplePct != null
        ? `<span class="return-kpi-val ${simplePct >= 0 ? 'pos' : 'neg'}">${fmtReturnPct2FromPercent(simplePct)}</span>`
        : '<span class="return-kpi-val muted">—</span>';
      const dailyHtml = Number.isFinite(dailyDelta)
        ? `<span class="return-kpi-val ${dailyDelta >= 0 ? 'pos' : 'neg'}">${dailyDelta >= 0 ? '+' : ''}${fmtInt.format(Math.round(dailyDelta))}</span>`
        : '<span class="return-kpi-val muted">—</span>';
      const dailySub = Number.isFinite(dailyPct) && dailyBaseDate
        ? `較 ${dailyBaseDate}：${dailyPct >= 0 ? '+' : ''}${dailyPct.toFixed(2)}%`
        : '請先新增資產快照';

      kpiRow.innerHTML = `
        <div class="return-kpi-card">
          <div class="return-kpi-label">簡單報酬（含息）</div>
          ${simpleHtml}
          <div class="return-kpi-sub">現有計算方式：淨值增減 ÷ 累計投入資本（含起始與增減資）</div>
        </div>
        <div class="return-kpi-card">
          <div class="return-kpi-label">總資產日變化</div>
          ${dailyHtml}
          <div class="return-kpi-sub">${dailySub}</div>
        </div>`;
    }

    returnChartLastInput = { totalAssets, holdingsMarketValue: holdingsMv, cashAvailable: cashAvail };
    await refreshReturnCharts();
    renderReturnContribBars(summary);

    // 取得所有股票的指標（包含目前持有和曾經持有）
    const allMetrics = computeStockMetrics(summary);
    const metrics = allMetrics.filter(row => row.qty > 0 || row.txnCount > 0);
    
    if(metrics.length === 0){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" class="empty">尚無持有或曾持有標的</td>`;
      tbody.appendChild(tr);
      updateReturnSortIndicators();
      return;
    }

    // 計算總市值用於投資占比（只計算目前持有的）
    const totalMarketValue = metrics.reduce((sum, row) => {
      if(row.qty <= 0) return sum;
      const value = Number.isFinite(row.marketValue) ? row.marketValue : 0;
      return sum + value;
    }, 0);

    // 取得已實現損益
    const realizedMap = computeRealizedPnlByStock(summary);
    
    // 取得歷史總投入成本
    const totalCostMap = computeTotalCostByStock(summary);

    // 建立行資料
    const rows = [];
    for(const row of metrics){
      const isCurrentlyHeld = row.qty > 0;
      const allocationRatio = (isCurrentlyHeld && totalMarketValue > 0) ? row.marketValue / totalMarketValue : 0;
      
      // 分類
      const category = getStockCategory(row.stock);
      
      // 已領股息
      const receivedDividend = row.dividends || 0;

      // 未實現損益（不含息）= 股票損益（未持有時為 0）
      const unrealizedPnl = isCurrentlyHeld ? row.stockPnlWithFees : 0;

      // 已實現損益（含息）= 賣出損益 + 已領股息
      const realizedPnl = realizedMap[row.instrumentKey] || 0;

      // 綜合含息報酬率 = (未實現損益 + 已實現損益) ÷ 歷史總投入成本 × 100%
      const totalCost = totalCostMap[row.instrumentKey] || 0;
      const combinedPnl = unrealizedPnl + realizedPnl;
      const combinedReturnPct = totalCost > 0 ? (combinedPnl / totalCost * 100) : 0;

      rows.push({
        stock: row.stock,
        category,
        totalReturnPct: combinedReturnPct,
        allocationRatio,
        receivedDividend,
        unrealizedPnl,
        realizedPnl,
        totalPnl: combinedPnl,
        marketValue: row.marketValue,
        qty: row.qty,
        isCurrentlyHeld
      });
    }

    // 排序
    rows.sort(compareReturnRows);

    // 渲染表格
    for(const row of rows){
      const tr = document.createElement('tr');
      tr.style.lineHeight = '1.2';

      if(!row.isCurrentlyHeld){
        tr.style.color = '#9ca3af';
      }

      // 格式化數字：持有股票黑字正值/紅字負值，未持有股票淡灰色
      const formatValue = (value, isPercent = false) => {
        if(!Number.isFinite(value)) return '—';
        let color;
        if(!row.isCurrentlyHeld){
          color = '#9ca3af';
        } else {
          color = value < 0 ? '#dc2626' : 'inherit';
        }
        const formatted = isPercent
          ? `${fmt2.format(value)}%`
          : fmtInt.format(Math.round(value));
        return `<span style="color:${color}">${formatted}</span>`;
      };

      // 含息報酬率
      const totalReturnDisplay = Number.isFinite(row.totalReturnPct)
        ? formatValue(row.totalReturnPct, true)
        : '—';

      // 投資占比
      const allocationDisplay = row.isCurrentlyHeld && Number.isFinite(row.allocationRatio)
        ? `${fmt2.format(row.allocationRatio * 100)}%`
        : '—';

      // 已領股息
      const receivedDividendDisplay = row.receivedDividend > 0
        ? formatValue(row.receivedDividend)
        : '—';

      // 總損益
      const totalPnlDisplay = Number.isFinite(row.totalPnl) && row.totalPnl !== 0
        ? formatValue(row.totalPnl)
        : '—';

      const badgeClass = getCategoryBadgeClass(row.category);

      const unrealizedLine = row.isCurrentlyHeld && Number.isFinite(row.unrealizedPnl)
        ? `<span style="color:${row.unrealizedPnl < 0 ? '#dc2626' : 'inherit'}">${fmtInt.format(Math.round(row.unrealizedPnl))}</span>`
        : null;
      const realizedLine = Number.isFinite(row.realizedPnl) && row.realizedPnl !== 0
        ? `<span class="txn-realized-tag">已實現</span><span style="color:${row.realizedPnl < 0 ? '#dc2626' : 'inherit'}">${fmtInt.format(Math.round(row.realizedPnl))}</span>`
        : null;

      let pnlDetailHtml = '—';
      if(unrealizedLine || realizedLine){
        const parts = [];
        if(unrealizedLine) parts.push(`<div style="font-size:12px">${unrealizedLine} <span class="mini muted">浮動</span></div>`);
        if(realizedLine) parts.push(`<div style="font-size:12px">${realizedLine}</div>`);
        pnlDetailHtml = parts.join('');
      }

      tr.innerHTML = `
        <td class="text-start">
          <div class="cell-stack">
            <span><span class="${badgeClass}">${row.stock.symbol}</span></span>
            <span class="mini muted">${row.stock.name || ''}</span>
          </div>
        </td>
        <td class="num">${allocationDisplay}</td>
        <td class="num">${receivedDividendDisplay}</td>
        <td class="num" style="text-align:right">${pnlDetailHtml}</td>
        <td class="num">${totalPnlDisplay}</td>
        <td class="num">${totalReturnDisplay}</td>
      `;
      tbody.appendChild(tr);
    }

    updateReturnSortIndicators();
  }

  // 報酬檢視表頭排序事件
  const returnHead = $('#tbl-return thead');
  if(returnHead){
    returnHead.addEventListener('click', (event)=>{
      const th = event.target.closest('th.sortable');
      if(!th) return;
      const key = th.dataset.sort;
      if(!key) return;
      if(returnSort.key === key){
        returnSort.dir = returnSort.dir === 'asc' ? 'desc' : 'asc';
      }else{
        returnSort.key = key;
        returnSort.dir = returnSortDefaults[key] || 'desc';
      }
      renderReturnOverview();
    });
  }

  $('#tbl-holdings thead').addEventListener('click', (event)=>{
    const th = event.target.closest('th.sortable');
    if(!th) return;
    const key = th.dataset.sort;
    if(!key) return;
    if(holdingsSort.key === key){
      holdingsSort.dir = holdingsSort.dir === 'asc' ? 'desc' : 'asc';
    }else{
      holdingsSort.key = key;
      holdingsSort.dir = holdingsSortDefaults[key] || 'desc';
    }
    renderHoldings();
  });

  const longTermHead = $('#tbl-long-term thead');
  if(longTermHead){
    longTermHead.addEventListener('click', (event)=>{
      const th = event.target.closest('th.sortable');
      if(!th) return;
      const key = th.dataset.sort;
      if(!key) return;
      if(longTermSort.key === key){
        longTermSort.dir = longTermSort.dir === 'asc' ? 'desc' : 'asc';
      }else{
        longTermSort.key = key;
        longTermSort.dir = longTermSortDefaults[key] || 'desc';
      }
      renderLongTermMetrics();
    });
  }

  const longtermDetails = document.getElementById('longterm-details');
  const longtermHint = document.getElementById('longterm-toggle-hint');
  if(longtermDetails && longtermHint){
    longtermDetails.addEventListener('toggle', () => {
      longtermHint.textContent = longtermDetails.open ? '收合 ▼' : '展開 ▶';
      if(longtermDetails.open) renderLongTermMetrics();
    });
  }

  function bindDetailsSummaryArrow(detailsId){
    const details = document.getElementById(detailsId);
    if(!details) return;
    const summary = details.querySelector('summary');
    const span = summary && summary.querySelector('span');
    if(!summary || !span) return;
    details.addEventListener('toggle', () => {
      span.textContent = details.open ? '▼' : '▶';
    });
  }
  bindDetailsSummaryArrow('invest-cash-details');
  bindDetailsSummaryArrow('allocation-details');

  function tryPreloadTodayScore(){
    try{
      const raw = localStorage.getItem('dashboard_score_today');
      if(!raw) return null;
      const data = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      if(data.date === today && typeof data.finalScore === 'number' && Number.isFinite(data.finalScore)){
        return data.finalScore;
      }
    } catch { /* ignore */ }
    return null;
  }

  function calcScoreAccuracy(){
    const buyTxns = DB.txns
      .filter(t => t.type === 'buy' && t.decisionScore != null)
      .sort((a,b) => new Date(a.time) - new Date(b.time));

    const scoreGroups = {
      high: { total: 0, win: 0 },
      mid: { total: 0, win: 0 },
      low: { total: 0, win: 0 },
    };

    for(const t of buyTxns){
      const buyPrice = parseN(t.price);
      if(!(buyPrice > 0)) continue;

      const nextSell = DB.txns
        .filter(x => x.stockId === t.stockId && x.type === 'sell' && new Date(x.time) > new Date(t.time))
        .sort((a,b) => new Date(a.time) - new Date(b.time))[0];

      let returnPct = null;
      if(nextSell){
        const sp = parseN(nextSell.price);
        if(sp > 0) returnPct = (sp - buyPrice) / buyPrice;
      } else {
        const stock = DB.stocks.find(s => s.id === t.stockId);
        const cp = stock ? parseN(stock.price) : NaN;
        if(Number.isFinite(cp) && cp > 0) returnPct = (cp - buyPrice) / buyPrice;
      }

      if(returnPct === null || !Number.isFinite(returnPct)) continue;

      const sc = t.decisionScore;
      const group = sc >= 2 ? 'high' : sc <= -1 ? 'low' : 'mid';
      scoreGroups[group].total++;
      if(returnPct > 0) scoreGroups[group].win++;
    }

    return scoreGroups;
  }
