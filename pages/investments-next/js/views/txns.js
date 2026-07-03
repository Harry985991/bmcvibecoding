  function calcAvgHoldingDays(){
    const buyTxns = DB.txns.filter(t => t.type === 'buy');
    const daysList = [];
    for(const t of buyTxns){
      const nextSell = DB.txns
        .filter(x => x.stockId === t.stockId && x.type === 'sell' && new Date(x.time) > new Date(t.time))
        .sort((a,b) => new Date(a.time) - new Date(b.time))[0];
      if(!nextSell) continue;
      const d0 = new Date(t.time).getTime();
      const d1 = new Date(nextSell.time).getTime();
      if(Number.isNaN(d0) || Number.isNaN(d1)) continue;
      daysList.push((d1 - d0) / 86400000);
    }
    if(daysList.length === 0) return null;
    return daysList.reduce((a,b) => a + b, 0) / daysList.length;
  }

  function txnWinRateText(group){
    if(!group || group.total === 0) return '—';
    return `${Math.round(group.win / group.total * 100)}%`;
  }

  function decisionScoreClass(score){
    if(score == null || !Number.isFinite(score)) return 'score-mid';
    if(score >= 2) return 'score-high';
    if(score === -1) return 'score-low';
    if(score <= -2) return 'score-bear';
    return 'score-mid';
  }

  function txnTypeBadgeClass(type){
    if(type === 'buy') return 'type-buy';
    if(type === 'sell') return 'type-sell';
    if(type === 'dividend') return 'type-div';
    if(type === 'fee') return 'type-fee';
    return 'type-fee';
  }

  function formatTxnDate(iso){
    const d = new Date(iso);
    if(Number.isNaN(d.getTime())) return '—';
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  function escapeAttr(s){
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  function escapeHtml(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderTxnDecisionScoreCell(t){
    if(t.type !== 'buy' && t.type !== 'sell'){
      return `<td class="num col-txn-score muted">—</td>`;
    }
    const sc = t.decisionScore ?? null;
    if(sc == null || !Number.isFinite(Number(sc))){
      return `<td class="num col-txn-score muted" title="+ 補記">—</td>`;
    }
    const sn = parseInt(sc, 10);
    const cls = decisionScoreClass(sn);
    const label = sn > 0 ? `+${sn}` : String(sn);
    return `<td class="num col-txn-score"><span class="${cls}">${label}</span></td>`;
  }

  function renderTxnJournalCell(t){
    if(t.type !== 'buy' && t.type !== 'sell'){
      return `<td class="col-txn-journal muted">—</td>`;
    }
    const j = (t.journalNote ?? '').trim();
    if(!j) return `<td class="col-txn-journal muted">—</td>`;
    const short = j.length > 40 ? `${j.slice(0, 40)}…` : j;
    return `<td class="col-txn-journal" title="${escapeAttr(j)}">${escapeAttr(short)}</td>`;
  }

  function renderTxnNoteCell(t){
    const n = (t.note ?? '').trim();
    if(!n) return `<td class="col-txn-note muted">—</td>`;
    const short = n.length > 20 ? `${n.slice(0, 20)}…` : n;
    return `<td class="col-txn-note" title="${escapeAttr(n)}">${escapeAttr(short)}</td>`;
  }

  function buildTxnPnlCell(t, summary = calculatePortfolioSummary()){
    if(t.type === 'buy'){
      const row = findSummaryRowByStockId(t.stockId, summary);
      const buyPrice = parseN(t.price);
      const buyQty = parseN(t.qty);
      const currentPrice = parseN(row?.currentPrice ?? row?.price);
      const buyCost = buyPrice * buyQty;
      if(!row || buyPrice <= 0 || buyQty <= 0 || currentPrice <= 0){
        const tip = escapeAttr(`該筆買入成本：${buyCost > 0 ? fmtInt.format(Math.round(buyCost)) : '—'} 元\n目前價：${currentPrice > 0 ? fmt2.format(currentPrice) : '—'}\n該筆試算損益：—\n該筆試算報酬：—`);
        return {
          amountHtml: '<span class="muted">—</span>',
          rateHtml: '<span class="muted">—</span>',
          title: tip
        };
      }
      const estimatedPnl = (currentPrice - buyPrice) * buyQty;
      const retPct = buyCost > 0 ? (estimatedPnl / buyCost * 100) : 0;
      const posAmt = estimatedPnl >= 0;
      const cAmt = posAmt ? '#059669' : '#dc2626';
      const sign = posAmt ? '▲' : '▼';
      const pctStr = `${retPct >= 0 ? '+' : ''}${retPct.toFixed(1)}%`;
      const tip = escapeAttr(
        `該筆買入成本：${fmtInt.format(Math.round(buyCost))} 元（成交價 ${fmt2.format(buyPrice)} × 股數 ${fmtInt.format(Math.round(buyQty))}）\n` +
        `目前價：${fmt2.format(currentPrice)}\n` +
        `該筆試算損益：${posAmt ? '▲' : '▼'} ${fmtInt.format(Math.round(Math.abs(estimatedPnl)))}\n` +
        `該筆試算報酬：${pctStr}`
      );
      return {
        amountHtml: `<span style="color:${cAmt};font-weight:700">${sign} ${fmtInt.format(Math.round(Math.abs(estimatedPnl)))}</span>`,
        rateHtml: `<span style="color:${cAmt}">${pctStr}</span>`,
        title: tip
      };
    }
    if(t.type === 'sell'){
      const realized = Number.isFinite(t.realized) ? t.realized : 0;
      const gross = parseN(t.price) * parseN(t.qty);
      const retPct = gross > 0 ? (realized / gross * 100) : 0;
      const posR = realized >= 0;
      const c = posR ? '#059669' : '#dc2626';
      const sign = posR ? '▲' : '▼';
      const pctStrS = `${retPct >= 0 ? '+' : ''}${retPct.toFixed(1)}%`;
      const tip = escapeAttr(
        `成交金額：${fmtInt.format(Math.round(gross))} 元\n` +
        `已實現損益：${posR ? '▲' : '▼'} ${fmtInt.format(Math.round(Math.abs(realized)))}\n` +
        `實現報酬：${pctStrS}`
      );
      return {
        amountHtml: `<span style="color:${c};font-weight:700">${sign} ${fmtInt.format(Math.round(Math.abs(realized)))}<span class="txn-realized-tag">已實現</span></span>`,
        rateHtml: `<span style="color:${c}">${pctStrS}</span>`,
        title: tip
      };
    }
    if(t.type === 'dividend'){
      const amt = parseN(t.amount);
      return {
        amountHtml: `<span style="color:#059669;font-weight:700">▲ ${fmtInt.format(Math.round(amt))}</span>`,
        rateHtml: '<span class="muted">—</span>',
        title: escapeAttr(`股息入帳：${fmtInt.format(Math.round(amt))} 元`)
      };
    }
    if(t.type === 'fee'){
      const amt = parseN(t.amount);
      return {
        amountHtml: `<span style="color:#dc2626;font-weight:700">▼ ${fmtInt.format(Math.round(Math.abs(amt)))}</span>`,
        rateHtml: '<span class="muted">—</span>',
        title: escapeAttr(`費用金額：${fmtInt.format(Math.round(Math.abs(amt)))} 元`)
      };
    }
    return {
      amountHtml: '<span class="muted">—</span>',
      rateHtml: '<span class="muted">—</span>',
      title: ''
    };
  }

  function renderTxnPriceCell(t){
    if(t.type === 'buy' || t.type === 'sell'){
      const p = parseN(t.price);
      const priceStr = p > 0 ? fmt2.format(p) : '—';
      return `<td class="num col-txn-price">${priceStr}</td>`;
    }
    return `<td class="num col-txn-price"><span class="muted">—</span></td>`;
  }

  function renderTxnQtyCell(t){
    if(t.type === 'buy' || t.type === 'sell'){
      const q = parseN(t.qty);
      const qtyStr = q > 0 ? fmtInt.format(Math.round(q)) : '—';
      return `<td class="num col-txn-qty">${qtyStr}</td>`;
    }
    return `<td class="num col-txn-qty"><span class="muted">—</span></td>`;
  }

  function passesTxnScoreFilter(t, scoreFilter){
    if(!scoreFilter) return true;
    const isTrade = t.type === 'buy' || t.type === 'sell';
    if(scoreFilter === 'has') return isTrade && t.decisionScore != null;
    if(scoreFilter === 'none') return isTrade && (t.decisionScore == null);
    return true;
  }

  function renderScoreStats(){
    const host = $('#txn-score-stats');
    if(!host) return;

    const scoredBuyCount = DB.txns.filter(t => t.type === 'buy' && t.decisionScore != null).length;
    if(scoredBuyCount < 3){
      host.innerHTML = '<div class="txn-score-stats-placeholder" style="min-height:0;padding:0;border:0;border-radius:0;text-align:center"></div>';
      return;
    }

    const g = calcScoreAccuracy();
    const avgDays = calcAvgHoldingDays();
    const highWin = g.high.total > 0 ? g.high.win / g.high.total : null;
    const lowWin = g.low.total > 0 ? g.low.win / g.low.total : null;
    let lowClass = 'stat-orange';
    if(lowWin != null && highWin != null && lowWin < highWin) lowClass = 'stat-green';
    else if(g.low.total === 0) lowClass = '';

    host.innerHTML = `
      <div style="font-weight:600;font-size:15px;margin-bottom:4px">評分模型驗證統計</div>
      <div class="kpi txn-stats-kpi">
        <div class="item">
          <div class="label">高分買入（≥+2）勝率</div>
          <div class="value stat-green">${txnWinRateText(g.high)}</div>
        </div>
        <div class="item">
          <div class="label">低分買入（≤-1）勝率</div>
          <div class="value ${lowClass}">${txnWinRateText(g.low)}</div>
        </div>
        <div class="item">
          <div class="label">已記錄評分筆數</div>
          <div class="value stat-muted">${scoredBuyCount}</div>
        </div>
        <div class="item">
          <div class="label">平均持有天數</div>
          <div class="value stat-muted">${avgDays != null && Number.isFinite(avgDays) ? `${avgDays.toFixed(1)} 天` : '—'}</div>
        </div>
      </div>
      <p class="txn-stats-note">高分勝率 &gt; 低分勝率 = 評分系統有鑑別力；建議累積 15 筆以上再下結論</p>
      <div id="txn-score-charts" class="txn-score-charts">
        <div class="txn-score-chart-box"><div class="mini muted" style="margin-bottom:4px">進場評分 × 報酬率散點（買入=迄今報酬、賣出=已實現）</div><div id="txn-score-scatter" style="min-height:220px"></div></div>
        <div class="txn-score-chart-box"><div class="mini muted" style="margin-bottom:4px">各評分區間勝率（樣本 &lt; 3 筆顯示樣本不足）</div><div id="txn-score-buckets" style="min-height:220px"></div></div>
      </div>
      <div id="txn-discipline" class="txn-discipline"></div>
    `;
    try{ renderScoreCharts(); }catch(e){ console.warn('[txns] score charts failed', e); }
  }

  // ========= 評分復盤視覺化（散點 + 勝率長條 + 紀律遵循率）=========
  function collectScoreOutcomes(){
    const points = [];
    const realizedList = computeTxnRealizedList();
    for(const t of realizedList){
      if(t.decisionScore == null) continue;
      const score = parseN(t.decisionScore);
      if(!Number.isFinite(score)) continue;
      if(t.type === 'sell'){
        const gross = parseN(t.price) * parseN(t.qty);
        const retPct = gross > 0 ? (t.realized / gross * 100) : null;
        if(Number.isFinite(retPct)) points.push({ score, retPct, kind: 'sell', symbol: stockSymbolById(t.stockId) });
      }else if(t.type === 'buy'){
        const stock = DB.stocks.find(s => s.id === t.stockId);
        const cur = parseN(stock?.price);
        const buyPrice = parseN(t.price);
        if(cur > 0 && buyPrice > 0){
          points.push({ score, retPct: (cur - buyPrice) / buyPrice * 100, kind: 'buy', symbol: stock?.symbol || '' });
        }
      }
    }
    return points;
  }

  function stockSymbolById(id){
    return DB.stocks.find(s => s.id === id)?.symbol || '';
  }

  function renderScoreCharts(){
    if(typeof Highcharts === 'undefined') return;
    const points = collectScoreOutcomes();

    const scatterEl = document.getElementById('txn-score-scatter');
    if(scatterEl){
      const mk = (kind, name, color) => ({
        type: 'scatter', name, color,
        data: points.filter(p => p.kind === kind).map(p => ({ x: p.score, y: Math.round(p.retPct * 100) / 100, custom: p }))
      });
      Highcharts.chart(scatterEl, {
        chart: { backgroundColor: 'transparent', height: 220 },
        title: { text: null }, credits: { enabled: false },
        xAxis: { title: { text: '進場評分' }, min: -5, max: 5, tickInterval: 1, gridLineWidth: 1 },
        yAxis: { title: { text: '報酬率 %' }, plotLines: [{ value: 0, color: '#94a3b8', width: 1 }] },
        plotOptions: { series: { animation: false, marker: { radius: 4 } } },
        tooltip: { formatter(){ const c = this.point.custom; return `${c.symbol}（${c.kind === 'sell' ? '已實現' : '迄今'}）<br>評分 ${c.score >= 0 ? '+' : ''}${c.score}：${c.retPct >= 0 ? '+' : ''}${c.retPct.toFixed(2)}%`; } },
        series: [mk('buy', '買入（迄今報酬）', '#2563EB'), mk('sell', '賣出（已實現）', '#0F766E')]
      });
    }

    const bucketsEl = document.getElementById('txn-score-buckets');
    if(bucketsEl){
      const buckets = [
        { label: '≤ -3', test: (s) => s <= -3 },
        { label: '-2 ~ 0', test: (s) => s >= -2 && s <= 0 },
        { label: '+1 ~ +2', test: (s) => s >= 1 && s <= 2 },
        { label: '≥ +3', test: (s) => s >= 3 }
      ];
      const stats = buckets.map(b => {
        const group = points.filter(p => b.test(p.score));
        const wins = group.filter(p => p.retPct > 0).length;
        return { label: b.label, n: group.length, winRate: group.length >= 3 ? wins / group.length * 100 : null };
      });
      Highcharts.chart(bucketsEl, {
        chart: { type: 'column', backgroundColor: 'transparent', height: 220 },
        title: { text: null }, credits: { enabled: false },
        xAxis: { categories: stats.map(s => `${s.label}（${s.n}筆）`) },
        yAxis: { title: { text: '勝率 %' }, max: 100, plotLines: [{ value: 50, color: '#94a3b8', width: 1, dashStyle: 'Dash' }] },
        legend: { enabled: false },
        plotOptions: { column: { animation: false, dataLabels: { enabled: true, formatter(){ return this.y != null ? `${this.y.toFixed(0)}%` : '樣本不足'; } } } },
        tooltip: { formatter(){ return this.y != null ? `勝率 ${this.y.toFixed(1)}%` : '樣本不足（< 3 筆）'; } },
        series: [{ name: '勝率', data: stats.map(s => ({ y: s.winRate, color: s.winRate == null ? '#e2e8f0' : (s.winRate >= 50 ? '#0F766E' : '#dc2626') })) }]
      });
    }

    const discEl = document.getElementById('txn-discipline');
    if(discEl){
      const trades = DB.txns.filter(t => t.type === 'buy' || t.type === 'sell');
      const scored = trades.filter(t => t.decisionScore != null).length;
      const rate = trades.length > 0 ? scored / trades.length * 100 : 0;
      discEl.innerHTML = `
        <div class="dividend-progress-head mini"><span>紀律遵循率（買賣交易有記錄評分的比例）</span><span><strong>${scored}</strong> / ${trades.length}（${rate.toFixed(1)}%）</span></div>
        <div class="dividend-progress-track"><div class="dividend-progress-fill" style="width:${Math.min(100, rate).toFixed(1)}%"></div></div>`;
    }
  }

  // ========= 交易表格 =========
  function renderTxns(summary = calculatePortfolioSummary()){
    renderScoreStats();

    const tbody = $('#tbl-txns tbody');
    tbody.innerHTML = '';
    const typeNames = { buy:'買入', sell:'賣出', dividend:'股息', fee:'費用' };

    const rows = computeTxnRealizedList();
    const q = $('#q-txn').value;
    const globalFilter = $('#q').value;
    const typeFilter = $('#type-filter').value;
    const scoreFilter = ($('#score-filter') && $('#score-filter').value) || '';
    const targetSymbol = q || globalFilter;

    const filteredRows = [];
    for(const t of rows){
      const stock = DB.stocks.find(s => s.id === t.stockId);
      if(targetSymbol){
        if(!stock || stock.symbol !== targetSymbol){
          continue;
        }
      }
      if(typeFilter && t.type !== typeFilter) continue;
      if(!passesTxnScoreFilter(t, scoreFilter)) continue;
      filteredRows.push({ txn: t, stock });
    }

    if(filteredRows.length === 0){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="11" class="empty">尚無異動紀錄</td>`;
      tbody.appendChild(tr);
      return;
    }

    let lastTxnDateKey = '';
    let currentDayBand = -1;
    for(const { txn: t, stock } of filteredRows){
      const tr = document.createElement('tr');
      const txnDateKey = String(t.time || '').slice(0, 10);
      if(txnDateKey !== lastTxnDateKey){
        currentDayBand = (currentDayBand + 1) % 6;
        lastTxnDateKey = txnDateKey;
      }
      tr.className = `txn-day-band-${currentDayBand < 0 ? 0 : currentDayBand}`;
      const sym = stock ? stock.symbol : '未知標的';
      const nameZh = stock ? (stock.name || '').trim() : '';
      const typeCls = txnTypeBadgeClass(t.type);
      const typeLabel = typeNames[t.type] || t.type;
      const pnl = buildTxnPnlCell(t, summary);

      tr.innerHTML = `
        <td class="col-txn-date">${formatTxnDate(t.time)}</td>
        <td class="col-txn-symbol"><div class="txn-symbol-inline"><span class="sym">${sym}</span><span class="mini muted" title="${nameZh ? escapeAttr(nameZh) : '—'}">${nameZh ? escapeAttr(nameZh) : '—'}</span></div></td>
        <td class="col-txn-type"><span class="type-badge ${typeCls}">${typeLabel}</span></td>
        ${renderTxnPriceCell(t)}
        ${renderTxnQtyCell(t)}
        <td class="num col-txn-pnl-amt" title="${pnl.title}">${pnl.amountHtml}</td>
        <td class="num col-txn-pnl-rate" title="${pnl.title}">${pnl.rateHtml}</td>
        ${renderTxnDecisionScoreCell(t)}
        ${renderTxnJournalCell(t)}
        ${renderTxnNoteCell(t)}
        <td class="num col-txn-op">
          <div class="txn-op-actions">
            <button class="btn mini" data-id="${t.id}" data-action="edit-txn">編輯</button>
            <button class="btn mini danger" data-id="${t.id}" data-action="del-txn">刪除</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

