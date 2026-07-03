  // ========= 成本/部位計算（加權平均成本法） =========
  // Legacy compatibility:
  // 新版資料流已改由 normalizeHoldings() / calculatePortfolioSummary() 統一口徑。
  // 這兩個函式保留是為了避免未來誤用時重新引入舊口徑，所以直接代理到 normalized summary。
  function calcPosition(stockId){
    const row = findSummaryRowByStockId(stockId, calculatePortfolioSummary());
    if(!row){
      return {qty:0, avgCost:0, costBasis:0, price:0, marketValue:0, unrealized:0, dividends:0, totalPnl:0};
    }
    return {
      qty: row.qty,
      avgCost: row.avgCost,
      costBasis: row.costBasis,
      price: row.price,
      marketValue: row.marketValue,
      unrealized: row.unrealized,
      dividends: row.dividends,
      totalPnl: row.totalPnl
    };
  }

  function computeAllPositions(){
    const summary = calculatePortfolioSummary();
    const map = {};
    for(const s of DB.stocks){ map[s.id] = calcPosition(s.id); }
    for(const row of summary.rows){
      const payload = {
        qty: row.qty,
        avgCost: row.avgCost,
        costBasis: row.costBasis,
        price: row.price,
        marketValue: row.marketValue,
        unrealized: row.unrealized,
        dividends: row.dividends,
        totalPnl: row.totalPnl
      };
      row.stockIds.forEach(id => { map[id] = payload; });
    }
    return map;
  }

  const HOLDING_QTY_DECIMALS = 4;

  function roundHoldingQty(value, decimals = HOLDING_QTY_DECIMALS){
    const num = parseN(value);
    const factor = 10 ** decimals;
    return Math.round(num * factor) / factor;
  }

  function formatHoldingQty(value){
    const num = parseN(value);
    if(!Number.isFinite(num)) return '—';
    if(Math.abs(num - Math.round(num)) < 1e-8){
      return fmtInt.format(Math.round(num));
    }
    return num.toLocaleString('zh-TW', {
      minimumFractionDigits: 0,
      maximumFractionDigits: HOLDING_QTY_DECIMALS
    });
  }

  function getHoldingInstrumentKey(stock){
    const symbol = String(stock?.symbol || '').trim().toUpperCase();
    const market = String(stock?.market || 'TW').trim() || 'TW';
    const assetClass = String(stock?.assetClass || 'Equity').trim() || 'Equity';
    return `${symbol}__${market}__${assetClass}`;
  }

  function getHoldingBoardLotSize(stock){
    return String(stock?.market || 'TW').trim() === 'TW' ? 1000 : 1;
  }

  function getQuoteTimeValue(iso){
    if(!iso) return Number.NEGATIVE_INFINITY;
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? Number.NEGATIVE_INFINITY : t.getTime();
  }

  function selectDisplayStock(stocks){
    if(!Array.isArray(stocks) || stocks.length === 0) return null;
    return stocks.slice().sort((a, b) => {
      const aHasPrice = parseN(a?.price) > 0 ? 1 : 0;
      const bHasPrice = parseN(b?.price) > 0 ? 1 : 0;
      if(aHasPrice !== bHasPrice) return bHasPrice - aHasPrice;
      return getQuoteTimeValue(b?.lastPriceAt) - getQuoteTimeValue(a?.lastPriceAt);
    })[0];
  }

  function buildMergedPosition(txns){
    const sorted = txns.slice().sort((a,b)=>new Date(a.time)-new Date(b.time));
    let qty = 0;
    let costBasis = 0;
    let avgCost = 0;
    let dividends = 0;
    for(const t of sorted){
      if(t.type === 'buy'){
        const amount = parseN(t.price) * parseN(t.qty);
        costBasis += amount;
        qty += parseN(t.qty);
        avgCost = qty ? costBasis / qty : 0;
      }else if(t.type === 'sell'){
        const sellQty = parseN(t.qty);
        costBasis -= avgCost * sellQty;
        qty -= sellQty;
        avgCost = qty ? costBasis / qty : 0;
      }else if(t.type === 'fee'){
        costBasis += parseN(t.amount);
        avgCost = qty ? costBasis / qty : 0;
      }else if(t.type === 'dividend'){
        dividends += parseN(t.amount);
      }
    }
    return {
      qty: roundHoldingQty(qty),
      avgCost,
      costBasis,
      dividends
    };
  }

  function getCurrentHoldingCycleTxns(txns){
    const sorted = txns.slice().sort((a,b)=>new Date(a.time)-new Date(b.time));
    const EPS = 1e-8;
    let qty = 0;
    let avgCost = 0;
    let costBasis = 0;
    let cycleStartIndex = -1;

    for(let i = 0; i < sorted.length; i += 1){
      const txn = sorted[i];
      if(txn.type === 'buy'){
        if(qty <= EPS){
          cycleStartIndex = i;
        }
        const buyQty = parseN(txn.qty);
        const amount = parseN(txn.price) * buyQty;
        costBasis += amount;
        qty += buyQty;
        avgCost = qty > EPS ? costBasis / qty : 0;
      }else if(txn.type === 'sell'){
        const sellQty = parseN(txn.qty);
        costBasis -= avgCost * sellQty;
        qty -= sellQty;
        if(qty <= EPS){
          qty = 0;
          avgCost = 0;
          costBasis = 0;
          cycleStartIndex = -1;
        }else{
          avgCost = costBasis / qty;
        }
      }else if(txn.type === 'fee'){
        if(cycleStartIndex >= 0){
          costBasis += parseN(txn.amount);
          avgCost = qty > EPS ? costBasis / qty : 0;
        }
      }
    }

    return cycleStartIndex >= 0 ? sorted.slice(cycleStartIndex) : [];
  }

  function computeHoldingCycleMetrics(row, asOf = new Date()){
    const cycleTxns = getCurrentHoldingCycleTxns(row.txns || []);
    if(!cycleTxns.length){
      return {
        startTime: '',
        holdingDays: null,
        totalReturnPct: null,
        monthlyReturnPct: null,
        weeklyReturnPct: null,
        isShortSample: false
      };
    }

    const startTime = cycleTxns.find(txn => txn.type === 'buy')?.time || cycleTxns[0]?.time || '';
    const startMs = startTime ? new Date(startTime).getTime() : NaN;
    const asOfMs = asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime();
    const holdingDays = Number.isFinite(startMs) && Number.isFinite(asOfMs)
      ? Math.max(1, Math.ceil((asOfMs - startMs) / 86400000))
      : null;
    const cyclePosition = buildMergedPosition(cycleTxns);
    const currentMarketValue = parseN(row.marketValue);
    const sellFee = estimateFee(currentMarketValue);
    const totalPnlWithFees = currentMarketValue - cyclePosition.costBasis - sellFee + cyclePosition.dividends;
    const totalReturnPct = cyclePosition.costBasis > 0 ? (totalPnlWithFees / cyclePosition.costBasis * 100) : null;

    const normalizePeriodPct = (periodDays) => {
      if(!Number.isFinite(totalReturnPct) || !Number.isFinite(holdingDays) || holdingDays <= 0) return null;
      const base = 1 + (totalReturnPct / 100);
      if(base <= 0) return null;
      return (Math.pow(base, periodDays / holdingDays) - 1) * 100;
    };

    return {
      startTime,
      holdingDays,
      totalReturnPct,
      monthlyReturnPct: normalizePeriodPct(30.44),
      weeklyReturnPct: normalizePeriodPct(7),
      isShortSample: Number.isFinite(holdingDays) && holdingDays < 14
    };
  }

  function buildHoldingSourceStates(stocks, txns){
    const txnsByStockId = new Map();
    for(const txn of txns){
      if(!txnsByStockId.has(txn.stockId)){
        txnsByStockId.set(txn.stockId, []);
      }
      txnsByStockId.get(txn.stockId).push(txn);
    }

    return (stocks || []).map(stock => {
      const stockTxns = txnsByStockId.get(stock.id) || [];
      const position = buildMergedPosition(stockTxns);
      return {
        stock,
        txns: stockTxns,
        txnCount: stockTxns.length,
        position,
        qty: roundHoldingQty(position.qty),
        hasTransactions: stockTxns.length > 0,
        isActiveHolding: roundHoldingQty(position.qty) > 0,
        quoteTime: String(stock?.lastPriceAt || '').trim(),
        price: parseN(stock?.price)
      };
    });
  }

  /**
   * 將 DB.stocks / DB.txns 先標準化成同一份持倉資料：
   * 1. 以 symbol + market + assetClass 合併重複標的
   * 2. 先合併整股/零股/不同來源，再算市值
   * 3. 所有摘要卡、持股表、配置圖都共用這份資料，避免各算各的
   */
  function normalizeHoldings(){
    const groups = new Map();
    const stockIdToKey = new Map();

    for(const stock of DB.stocks){
      const instrumentKey = getHoldingInstrumentKey(stock);
      if(!groups.has(instrumentKey)){
        groups.set(instrumentKey, { stocks: [], txns: [] });
      }
      groups.get(instrumentKey).stocks.push(stock);
      stockIdToKey.set(stock.id, instrumentKey);
    }

    const txnIndex = getTxnsByStockId();
    for(const stock of DB.stocks){
      const stockTxns = txnIndex.get(stock.id) || [];
      const instrumentKey = stockIdToKey.get(stock.id);
      if(!instrumentKey || !groups.has(instrumentKey)) continue;
      groups.get(instrumentKey).txns.push(...stockTxns);
    }

    return Array.from(groups.entries()).map(([instrumentKey, group]) => {
      const sourceStates = buildHoldingSourceStates(group.stocks, group.txns);
      const activeSourceStates = sourceStates.filter(state => state.isActiveHolding);
      const activeSourceStocks = activeSourceStates.map(state => state.stock);
      const relevantQuoteStates = activeSourceStates.length ? activeSourceStates : sourceStates.filter(state => state.hasTransactions);
      const displayStock = selectDisplayStock(activeSourceStocks.length ? activeSourceStocks : group.stocks) || group.stocks[0] || {};
      const mergedPosition = buildMergedPosition(group.txns);
      const symbol = String(displayStock.symbol || group.stocks[0]?.symbol || '').trim().toUpperCase();
      const name = group.stocks.map(s => s.name).find(Boolean) || '';
      const market = String(displayStock.market || group.stocks[0]?.market || 'TW').trim() || 'TW';
      const assetClass = String(displayStock.assetClass || group.stocks[0]?.assetClass || 'Equity').trim() || 'Equity';
      const currency = group.stocks.map(s => s.currency).find(Boolean) || '';
      const stockIds = group.stocks.map(s => s.id);
      const activeSourceStockIds = activeSourceStates.map(state => state.stock.id);
      const inactiveSourceStockIds = sourceStates.filter(state => !state.isActiveHolding).map(state => state.stock.id);
      const quoteTimes = [...new Set(relevantQuoteStates.map(state => state.quoteTime).filter(Boolean))];
      const quotePrices = [...new Set(
        relevantQuoteStates
          .map(state => state.price)
          .filter(v => Number.isFinite(v) && v > 0)
          .map(v => v.toFixed(6))
      )];
      const price = parseN(displayStock.price);
      const qty = roundHoldingQty(mergedPosition.qty);
      const marketValue = qty * price;
      const unrealized = marketValue - mergedPosition.costBasis;
      const totalPnl = unrealized + mergedPosition.dividends;
      const boardLotSize = getHoldingBoardLotSize(displayStock);
      const rawWholeQty = boardLotSize > 1
        ? Math.floor(qty / boardLotSize) * boardLotSize
        : Math.floor(qty);
      const wholeLotQty = roundHoldingQty(rawWholeQty);
      const oddLotQty = roundHoldingQty(qty - wholeLotQty);
      const buyFee = estimateFee(mergedPosition.costBasis);
      const sellFee = estimateFee(marketValue);
      const totalFees = buyFee + sellFee;
      const stockPnlWithFees = marketValue - mergedPosition.costBasis - totalFees;
      const totalPnlWithFees = stockPnlWithFees + mergedPosition.dividends;
      const costBasisWithBuyFee = mergedPosition.costBasis + buyFee;
      const stockReturnPct = costBasisWithBuyFee > 0 ? (stockPnlWithFees / costBasisWithBuyFee * 100) : 0;
      const totalReturnPct = costBasisWithBuyFee > 0 ? (totalPnlWithFees / costBasisWithBuyFee * 100) : 0;
      const cycleMetrics = computeHoldingCycleMetrics({
        txns: group.txns.slice(),
        marketValue
      });
      const quoteTime = quoteTimes
        .slice()
        .sort((a, b) => getQuoteTimeValue(b) - getQuoteTimeValue(a))[0] || (displayStock.lastPriceAt || '');
      const missingPrice = !(price > 0);
      // Data Health 只檢查「目前持倉有貢獻」的來源，避免把已出清舊倉或空主檔誤判成重複持倉。
      const quoteSyncWarning = activeSourceStates.length > 1 && (quoteTimes.length > 1 || quotePrices.length > 1);
      const hasDuplicateRecords = activeSourceStates.length > 1;

      return {
        instrumentKey,
        stock: {
          ...displayStock,
          id: displayStock.id || stockIds[0] || instrumentKey,
          symbol,
          name,
          market,
          assetClass,
          currency
        },
        stockIds,
        activeSourceStockIds,
        inactiveSourceStockIds,
        sourceStocks: group.stocks.slice(),
        sourceStates,
        activeSourceStates,
        txns: group.txns.slice(),
        txnCount: group.txns.length,
        qty,
        avgCost: mergedPosition.avgCost,
        costBasis: mergedPosition.costBasis,
        dividends: mergedPosition.dividends,
        price,
        currentPrice: price,
        marketValue,
        unrealized,
        totalPnl,
        wholeLotQty,
        oddLotQty,
        boardLotSize,
        quoteTime,
        quoteTimes,
        missingPrice,
        quoteSyncWarning,
        hasDuplicateRecords,
        sourceRecordCount: sourceStates.length,
        activeSourceCount: activeSourceStates.length,
        stockPnlWithFees,
        stockReturnPct,
        totalPnlWithFees,
        totalReturnPct,
        cycleStartTime: cycleMetrics.startTime,
        cycleHoldingDays: cycleMetrics.holdingDays,
        cycleTotalReturnPct: cycleMetrics.totalReturnPct,
        cycleMonthlyReturnPct: cycleMetrics.monthlyReturnPct,
        cycleWeeklyReturnPct: cycleMetrics.weeklyReturnPct,
        cycleShortSample: cycleMetrics.isShortSample
      };
    }).sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0));
  }

  let _cachedSummary = null;

  function calculatePortfolioSummary(forceRecalc = false){
    if(!forceRecalc && !isSummaryDirty() && _cachedSummary){
      return _cachedSummary;
    }
    const rows = normalizeHoldings();
    const heldRows = rows.filter(row => parseN(row.qty) > 0);
    const holdingsMarketValue = heldRows.reduce((sum, row) => sum + parseN(row.marketValue), 0);
    const detailMarketValueSum = heldRows.reduce((sum, row) => sum + parseN(row.marketValue), 0);
    const cashAvailable = DB.accounts.reduce((sum, acc) => sum + parseN(acc.actual) + parseN(acc.settlement), 0);
    const otherAssets = 0;
    const totalAssets = holdingsMarketValue + cashAvailable + otherAssets;
    const holdingsVsDetailsDiff = holdingsMarketValue - detailMarketValueSum;
    const totalAssetsDiff = totalAssets - (holdingsMarketValue + cashAvailable + otherAssets);
    const quoteTimes = [...new Set(heldRows.map(row => row.quoteTime).filter(Boolean))];
    const hasSyncWarning = heldRows.some(row => row.quoteSyncWarning || row.missingPrice || !row.quoteTime) || quoteTimes.length > 1;
    const missingPriceCount = heldRows.filter(row => row.missingPrice).length;
    const quoteMismatchCount = heldRows.filter(row => row.quoteSyncWarning || !row.quoteTime).length;
    const duplicateRecordCount = heldRows.filter(row => row.hasDuplicateRecords).length;
    const debugRows = heldRows.map(row => ({
      instrumentKey: row.instrumentKey,
      symbol: row.stock.symbol || '—',
      name: row.stock.name || '',
      wholeLotQty: row.wholeLotQty,
      oddLotQty: row.oddLotQty,
      qty: row.qty,
      price: row.price,
      marketValue: row.marketValue,
      quoteTime: row.quoteTime || '',
      quoteTimes: row.quoteTimes.slice(),
      sourceCount: row.stockIds.length,
      stockIds: row.stockIds.slice(),
      txnCount: row.txnCount,
      missingPrice: row.missingPrice,
      quoteSyncWarning: row.quoteSyncWarning || !row.quoteTime,
      hasDuplicateRecords: row.hasDuplicateRecords
    }));
    const missingPriceRows = debugRows.filter(row => row.missingPrice);
    const quoteMismatchRows = debugRows.filter(row => row.quoteSyncWarning);
    const duplicateRows = debugRows.filter(row => row.hasDuplicateRecords);
    const anomalyRows = debugRows
      .map(row => {
        const issues = [];
        if(row.missingPrice) issues.push({ type: 'error', label: '缺價格' });
        if(row.quoteSyncWarning) issues.push({ type: 'warn', label: '報價不同步' });
        if(row.hasDuplicateRecords) issues.push({ type: 'warn', label: '多來源合併' });
        return { ...row, issues };
      })
      .filter(row => row.issues.length > 0)
      .sort((a, b) => {
        const aSeverity = a.issues.some(issue => issue.type === 'error') ? 2 : 1;
        const bSeverity = b.issues.some(issue => issue.type === 'error') ? 2 : 1;
        if(aSeverity !== bSeverity) return bSeverity - aSeverity;
        if(a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
        return (b.marketValue || 0) - (a.marketValue || 0);
      });

    _cachedSummary = {
      rows,
      heldRows,
      holdingsMarketValue,
      detailMarketValueSum,
      cashAvailable,
      otherAssets,
      totalAssets,
      holdingsVsDetailsDiff,
      totalAssetsDiff,
      quoteTimes,
      hasSyncWarning,
      missingPriceCount,
      quoteMismatchCount,
      duplicateRecordCount,
      debugRows,
      missingPriceRows,
      quoteMismatchRows,
      duplicateRows,
      anomalyRows,
      syncWarningMessage: hasSyncWarning ? '資料更新時間不同，數值可能暫時不一致' : '',
      validation: {
        holdingsMatchesDetails: Math.abs(holdingsVsDetailsDiff) < 0.5,
        totalAssetsMatchesEquation: Math.abs(totalAssetsDiff) < 0.5,
        isConsistent: Math.abs(holdingsVsDetailsDiff) < 0.5 && Math.abs(totalAssetsDiff) < 0.5
      }
    };
    clearSummaryDirty();
    return _cachedSummary;
  }

  function findSummaryRowByStockId(stockId, summary = calculatePortfolioSummary()){
    return summary.rows.find(row => row.stockIds.includes(stockId)) || null;
  }

  function getStockLabelKey(stockId){
    const stock = DB.stocks.find(s => s.id === stockId);
    if(!stock) return String(stockId || '');
    return getHoldingInstrumentKey(stock);
  }

  function computeTxnRealizedList(){
    const tx = DB.txns.slice().sort((a,b)=>{
      const da = new Date(a.time).getTime();
      const db = new Date(b.time).getTime();
      if(da !== db) return da - db;
      const order = { buy: 0, sell: 1, fee: 2, dividend: 3 };
      return (order[a.type] ?? 9) - (order[b.type] ?? 9);
    });
    const state = new Map(); // instrumentKey -> {qty, avgCost}
    return tx.map(t=>{
      const stock = DB.stocks.find(s => s.id === t.stockId);
      const instrumentKey = stock ? getHoldingInstrumentKey(stock) : String(t.stockId || '');
      const st = state.get(instrumentKey) || {qty:0, avgCost:0};
      let realized = 0;
      if(t.type==='buy'){
        const amount = parseN(t.price)*parseN(t.qty);
        const newQty = st.qty + parseN(t.qty);
        const newCost = st.avgCost*st.qty + amount;
        st.qty = newQty;
        st.avgCost = newQty ? newCost/newQty : 0;
      }else if(t.type==='sell'){
        realized = (parseN(t.price)-st.avgCost) * parseN(t.qty);
        st.qty -= parseN(t.qty);
      }else if(t.type==='fee'){
        const newCostBasis = st.avgCost*st.qty + parseN(t.amount);
        st.avgCost = st.qty ? newCostBasis/st.qty : 0;
      }else if(t.type==='dividend'){
        realized = parseN(t.amount);
      }
      state.set(instrumentKey, st);
      return {...t, realized, instrumentKey};
    }).sort((a,b)=>new Date(b.time)-new Date(a.time));
  }

  // ========= Header KPI =========
  function refreshKPI(summary = calculatePortfolioSummary()){
    const miniTotalAsset = document.getElementById('mini-total-asset');
    if(!miniTotalAsset) return;

    const miniTotalReturn = document.getElementById('mini-total-return');
    const miniCash = document.getElementById('mini-cash');
    const miniMonthDiv = document.getElementById('mini-month-div');
    const miniHoldingsMv = document.getElementById('mini-holdings-mv');
    const miniNetGain = document.getElementById('mini-net-gain');

    const holdings = summary.holdingsMarketValue;
    const cash = summary.cashAvailable;
    const capitalAdjustments = sumCapitalAdjustments();
    const initialCapital = getInitialCapitalAmount();
    const totalAssets = summary.totalAssets;
    const netGain = totalAssets - initialCapital - capitalAdjustments;
    const investedCapital = initialCapital + capitalAdjustments;
    const returnRate = investedCapital !== 0 ? netGain / investedCapital : 0;
    miniTotalAsset.textContent = fmtInt.format(Math.round(totalAssets));
    if(miniCash) miniCash.textContent = fmtInt.format(Math.round(cash));
    if(miniHoldingsMv) miniHoldingsMv.textContent = fmtInt.format(Math.round(holdings));
    if(miniNetGain){
      miniNetGain.textContent = (netGain >= 0 ? '+' : '') + fmtInt.format(Math.round(netGain));
      miniNetGain.classList.toggle('positive', netGain >= 0);
      miniNetGain.classList.toggle('negative', netGain < 0);
    }
    if(miniTotalReturn){
      miniTotalReturn.textContent = (returnRate>=0? '▲ ':'▼ ') + Math.abs(returnRate*100).toFixed(2) + '%';
      miniTotalReturn.classList.toggle('positive', returnRate >= 0);
      miniTotalReturn.classList.toggle('negative', returnRate < 0);
    }

    if(miniMonthDiv){
      try{
        const monthDividend = calculateCurrentMonthDividend(summary);
        miniMonthDiv.textContent = monthDividend.amount > 0
          ? fmtInt.format(Math.round(monthDividend.amount))
          : '—';
        if(!monthDividend.isActual && monthDividend.amount > 0){
          miniMonthDiv.textContent = '~' + fmtInt.format(Math.round(monthDividend.amount));
        }
      }catch(e){
        console.warn('本月配息計算失敗：', e);
        miniMonthDiv.textContent = '—';
      }
    }
  }

  // ========= 更新搜尋下拉選單 =========
  function updateSearchDropdown(){
    const summary = calculatePortfolioSummary();
    const options = summary.rows
      .map(row => ({
        symbol: row.stock.symbol,
        name: row.stock.name || '',
        sortKey: row.stock.symbol
      }));
    // 更新持有標的頁面的篩選器
    const select = $('#q');
    if(!select) return;
    const currentValue = select.value;
    
    // 保留「全部標的」選項
    select.innerHTML = '<option value="">全部標的</option>';
    
    // 自定義排序順序
    const customOrder = ['0050', '00878', '00923', '8215', '00646', '00687B', '00719B', '00772B'];
    const getSortIndex = (symbol) => {
      const index = customOrder.indexOf(symbol);
      return index >= 0 ? index : 999; // 不在列表中的股票排在最後
    };
    
    // 添加所有股票代碼選項
    options
      .sort((a,b)=> getSortIndex(a.sortKey) - getSortIndex(b.sortKey) || (a.sortKey || '').localeCompare(b.sortKey || '', 'zh-Hant', {numeric:true, sensitivity:'base'}))
      .forEach(stock => {
        const option = document.createElement('option');
        option.value = stock.symbol;
        option.textContent = `${stock.symbol} · ${stock.name}`;
        select.appendChild(option);
      });
    
    // 恢復之前選中的值
    if(currentValue) {
      select.value = currentValue;
    }
    
    // 更新異動紀錄頁面的標的篩選器
    const selectTxn = $('#q-txn');
    if(!selectTxn) return;
    const currentValueTxn = selectTxn.value;
    
    // 保留「全部標的」選項
    selectTxn.innerHTML = '<option value="">全部標的</option>';
    
    // 添加所有股票代碼選項
    options
      .sort((a,b)=> getSortIndex(a.sortKey) - getSortIndex(b.sortKey) || (a.sortKey || '').localeCompare(b.sortKey || '', 'zh-Hant', {numeric:true, sensitivity:'base'}))
      .forEach(stock => {
        const option = document.createElement('option');
        option.value = stock.symbol;
        option.textContent = `${stock.symbol} · ${stock.name}`;
        selectTxn.appendChild(option);
      });
    
    // 恢復之前選中的值
    if(currentValueTxn) {
      selectTxn.value = currentValueTxn;
    }
  }

