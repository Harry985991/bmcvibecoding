  // ========= 每日全頁資料封存（meta.dailyArchive）=========
  // 存「各頁計算結果」而非原始資料：即使日後計算邏輯改版，歷史紀錄仍代表當天看到的真實狀態。
  // 觸發：報價更新成功後自動（同日蓋舊）+ 設定頁「立即封存」手動按鈕。

  const DAILY_ARCHIVE_LIMIT = 730;

  function ensureDailyArchiveMeta(){
    if(!DB.meta) DB.meta = {};
    if(!DB.meta.dailyArchive || typeof DB.meta.dailyArchive !== 'object') DB.meta.dailyArchive = {};
    return DB.meta.dailyArchive;
  }

  function parseArchiveLocalDate(dateStr){
    const raw = String(dateStr || '').slice(0, 10);
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function buildDailyArchiveEntry(summary = calculatePortfolioSummary(), options = {}){
    const archiveDate = String(options.date || localDateStr()).slice(0, 10);
    const archiveDateObj = parseArchiveLocalDate(archiveDate);
    const totalAssets = summary.totalAssets || 0;
    const investedCapital = getInitialCapitalAmount() + sumCapitalAdjustments(archiveDate);
    const netGain = totalAssets - investedCapital;
    const returnPct = investedCapital !== 0 ? netGain / investedCapital * 100 : null;

    let monthDividendAmt = null;
    try{
      const md = calculateCurrentMonthDividend(summary, archiveDateObj);
      monthDividendAmt = md?.amount ?? null;
    }catch(e){ /* keep null */ }

    let dd = { maxDrawdownPct: null, currentDrawdownPct: null };
    try{ dd = computeDrawdownKpi(totalAssets); }catch(e){ /* keep null */ }

    const tierText = { core: 'core', satellite: 'satellite', flex: 'flex' };
    const holdings = summary.heldRows.map(row => {
      const label = getStockLabel(row.stock.id) || {};
      const sym = String(row.stock.symbol || '').trim().toUpperCase();
      const tech = (typeof deriveTechnicalPosition === 'function') ? deriveTechnicalPosition(indicatorCache[sym]) : { label: '' };
      const unrealizedPct = row.costBasis > 0 ? row.unrealized / row.costBasis * 100 : null;
      const totalPnlPct = row.costBasis > 0 ? row.totalPnl / row.costBasis * 100 : null;
      return {
        symbol: row.stock.symbol,
        name: row.stock.name || '',
        tier: tierText[normalizeTierValue(label.tier)] || 'flex',
        qty: row.qty,
        avgCost: round2(row.avgCost),
        price: round2(row.price),
        marketValue: Math.round(row.marketValue),
        allocPct: totalAssets > 0 ? round2(row.marketValue / totalAssets * 100) : null,
        unrealizedPnl: Math.round(row.unrealized),
        unrealizedPct: round2(unrealizedPct),
        dividends: Math.round(row.dividends),
        totalPnl: Math.round(row.totalPnl),
        totalPnlPct: round2(totalPnlPct),
        signal: tech.label || '',
        cycleMonthlyReturnPct: round2(row.cycleMonthlyReturnPct)
      };
    });

    const tierAlloc = getTierAllocation(summary);

    const assetClassAlloc = {};
    for(const row of summary.heldRows){
      let ac = row.stock.assetClass || 'Equity';
      if(ac === 'Bond') ac = 'BondETF';
      assetClassAlloc[ac] = (assetClassAlloc[ac] || 0) + row.marketValue;
    }
    for(const k of Object.keys(assetClassAlloc)){
      assetClassAlloc[k] = totalAssets > 0 ? round2(assetClassAlloc[k] / totalAssets * 100) : null;
    }

    const gov = computeCashGovernance(summary);

    let dividendStats = { received: null, projected: null, monthly: null };
    try{
      const stats = calcAnnualDividendStats(summary);
      dividendStats = {
        received: Math.round(stats.received || 0),
        projected: Math.round(stats.projected || 0),
        monthly: stats.monthly != null ? Math.round(stats.monthly) : null
      };
    }catch(e){ /* dividend stats unavailable */ }

    const tradeTxns = DB.txns.filter(t => t.type === 'buy' || t.type === 'sell');
    const scoredCount = tradeTxns.filter(t => t.decisionScore != null).length;

    return {
      date: archiveDate,
      capturedAt: new Date().toISOString(),
      kpi: {
        totalAssets: Math.round(totalAssets),
        holdingsMv: Math.round(summary.holdingsMarketValue),
        cash: Math.round(summary.cashAvailable),
        netGain: Math.round(netGain),
        totalReturnPct: round2(returnPct),
        monthDividend: monthDividendAmt != null ? Math.round(monthDividendAmt) : null,
        maxDrawdownPct: round2(dd.maxDrawdownPct),
        currentDrawdownPct: round2(dd.currentDrawdownPct)
      },
      holdings,
      tierAlloc: {
        core: round2(tierAlloc.corePct),
        satellite: round2(tierAlloc.satellitePct),
        flex: round2(tierAlloc.flexPct),
        cashPct: round2(tierAlloc.cashPct)
      },
      assetClassAlloc,
      cashGov: {
        cashPct: round2(gov.cashPct),
        floorPct: gov.floorPct,
        reservationCount: gov.reservationCount,
        reservationBuyTotal: Math.round(gov.reservationBuyTotal || 0),
        postFillCashPct: round2(gov.postFillCashPct)
      },
      dividend: dividendStats,
      txnStats: {
        totalCount: DB.txns.length,
        tradeCount: tradeTxns.length,
        scoredCount,
        disciplineRate: tradeTxns.length > 0 ? round2(scoredCount / tradeTxns.length * 100) : null
      }
    };
  }

  function round2(v){
    const n = parseN(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  async function captureDailyArchive(reason = 'manual', options = {}){
    try{
      const summary = calculatePortfolioSummary();
      if(!summary.heldRows.length && summary.totalAssets <= 0){
        console.warn('[archive] skip：無持倉與資產資料');
        return false;
      }
      const entry = buildDailyArchiveEntry(summary, options);
      const store = ensureDailyArchiveMeta();
      store[entry.date] = entry;
      const count = Object.keys(store).length;
      if(count > DAILY_ARCHIVE_LIMIT){
        showBackupStatus(`每日封存已超過 ${DAILY_ARCHIVE_LIMIT} 筆，建議在歷史分析頁匯出 JSON 後修剪舊紀錄`, true);
      }
      await saveDB();
      updateArchiveStatusLabel(entry);
      if(reason === 'manual') showBackupStatus(`今日資料已封存 ✓（${entry.date}）`);
      if(typeof renderAnalysis === 'function'){
        try{ if(document.getElementById('view-analysis')?.classList.contains('active')) renderAnalysis(); }catch(e){}
      }
      return true;
    }catch(e){
      console.error('[archive] capture failed', e);
      if(reason === 'manual') alert('封存失敗：' + (e?.message || e));
      return false;
    }
  }

  function updateArchiveStatusLabel(entry){
    const el = document.getElementById('archive-status');
    if(!el) return;
    const store = DB.meta?.dailyArchive || {};
    const dates = Object.keys(store).sort();
    if(dates.length === 0){ el.textContent = '尚未封存'; return; }
    const latest = entry || store[dates[dates.length - 1]];
    el.textContent = `最近封存：${latest.date}（${latest.capturedAt ? new Date(latest.capturedAt).toLocaleTimeString('zh-TW', { hour12: false }) : ''}）｜累計 ${dates.length} 天`;
  }

  (function bindArchiveControls(){
    document.getElementById('btn-archive-now')?.addEventListener('click', () => captureDailyArchive('manual'));
    setTimeout(() => { try{ updateArchiveStatusLabel(); }catch(e){} }, 1500);
  })();
