(function(){
  const EXPERIMENT_POOL_KEY = 'experimentB';
  const PORTFOLIO_POOL_KEY = 'portfolio';
  const DEFAULT_EXPERIMENT_CONFIG = Object.freeze({
    id: EXPERIMENT_POOL_KEY,
    label: '實驗 B',
    startedAt: '2026-07-12',
    initialCapital: 400000,
    compoundCap: 500000,
    hardCap: 500000,
    maxSeats: 5,
    seatLimit: 100000,
    entryTranches: [0.3, 0.3, 0.4],
    sweepDestination: 'freeCash',
    policy: 'compound-until-cap'
  });

  const POOL_LABELS = Object.freeze({
    core: '核心',
    satellite: '衛星',
    tactical: '偵查／策略外',
    experimentB: '實驗 B',
    preciousMetals: '貴金屬',
    freeCash: '自由現金',
    portfolio: '一般投資'
  });

  function cpEscape(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function normalizeCapitalPoolKey(value){
    const key = String(value || '').trim();
    return key === EXPERIMENT_POOL_KEY ? EXPERIMENT_POOL_KEY : PORTFOLIO_POOL_KEY;
  }

  function readCapitalPoolMeta(){
    const meta = DB?.meta && typeof DB.meta === 'object' ? DB.meta : {};
    const pools = meta.capitalPools && typeof meta.capitalPools === 'object' ? meta.capitalPools : {};
    const rawConfig = pools[EXPERIMENT_POOL_KEY] && typeof pools[EXPERIMENT_POOL_KEY] === 'object'
      ? pools[EXPERIMENT_POOL_KEY]
      : {};
    const config = { ...DEFAULT_EXPERIMENT_CONFIG, ...rawConfig };
    const txnMap = meta.transactionCapitalPools && typeof meta.transactionCapitalPools === 'object'
      ? meta.transactionCapitalPools
      : {};
    const transfers = Array.isArray(meta.capitalPoolTransfers) ? meta.capitalPoolTransfers : [];
    return { config, txnMap, transfers };
  }

  function ensureCapitalPoolMeta(){
    if(!DB.meta || typeof DB.meta !== 'object') DB.meta = {};
    if(!DB.meta.capitalPools || typeof DB.meta.capitalPools !== 'object' || Array.isArray(DB.meta.capitalPools)){
      DB.meta.capitalPools = {};
    }
    DB.meta.capitalPools[EXPERIMENT_POOL_KEY] = {
      ...DEFAULT_EXPERIMENT_CONFIG,
      ...(DB.meta.capitalPools[EXPERIMENT_POOL_KEY] || {})
    };
    if(!DB.meta.transactionCapitalPools || typeof DB.meta.transactionCapitalPools !== 'object' || Array.isArray(DB.meta.transactionCapitalPools)){
      DB.meta.transactionCapitalPools = {};
    }
    if(!Array.isArray(DB.meta.capitalPoolTransfers)) DB.meta.capitalPoolTransfers = [];
    return {
      config: DB.meta.capitalPools[EXPERIMENT_POOL_KEY],
      txnMap: DB.meta.transactionCapitalPools,
      transfers: DB.meta.capitalPoolTransfers
    };
  }

  function getTxnCapitalPool(txnId){
    if(!txnId) return PORTFOLIO_POOL_KEY;
    const { txnMap } = readCapitalPoolMeta();
    return normalizeCapitalPoolKey(txnMap[txnId]);
  }

  function setTxnCapitalPool(txnId, poolKey){
    if(!txnId) return;
    const { txnMap } = ensureCapitalPoolMeta();
    // 明確保留 portfolio 值，作為伺服器合併時的覆寫訊號；
    // 否則舊的 experimentB 標記可能在併發存檔時被補回。
    txnMap[txnId] = normalizeCapitalPoolKey(poolKey);
  }

  function deleteTxnCapitalPool(txnId){
    if(!txnId || !DB?.meta?.transactionCapitalPools) return;
    delete DB.meta.transactionCapitalPools[txnId];
  }

  function getTradeJournalPendingBuys(){
    const totals = { experimentB: 0, portfolio: 0 };
    const journals = DB?.meta?.tradeJournals;
    if(!journals || typeof journals !== 'object') return totals;
    for(const rows of Object.values(journals)){
      if(!Array.isArray(rows)) continue;
      for(const order of rows){
        if(order?.status !== 'planned' || String(order?.side || '').toLowerCase() !== 'buy') continue;
        const price = parseN(order.plannedPrice);
        const qty = parseN(order.plannedQty);
        if(!(price > 0 && qty > 0)) continue;
        const pool = normalizeCapitalPoolKey(order.capitalPool);
        totals[pool] += price * qty;
      }
    }
    return totals;
  }

  function buildExperimentPositions(experimentTxns){
    const byStockId = new Map();
    for(const txn of experimentTxns){
      if(!txn?.stockId) continue;
      if(!byStockId.has(txn.stockId)) byStockId.set(txn.stockId, []);
      byStockId.get(txn.stockId).push(txn);
    }
    const rows = [];
    for(const [stockId, txns] of byStockId.entries()){
      const stock = (DB.stocks || []).find(item => item.id === stockId);
      if(!stock) continue;
      const position = buildMergedPosition(txns);
      if(!(position.qty > 0)) continue;
      const price = parseN(stock.price);
      const marketValue = position.qty * price;
      rows.push({
        stockId,
        symbol: String(stock.symbol || '').trim().toUpperCase(),
        name: stock.name || '',
        qty: position.qty,
        avgCost: position.avgCost,
        costBasis: position.costBasis,
        price,
        marketValue,
        unrealized: marketValue - position.costBasis,
        txns: txns.slice()
      });
    }
    return rows.sort((a, b) => b.marketValue - a.marketValue);
  }

  function computeExperimentRealizedPnl(experimentTxns){
    const states = new Map();
    let realized = 0;
    const sorted = experimentTxns.slice().sort((a, b) => new Date(a.time) - new Date(b.time));
    for(const txn of sorted){
      const state = states.get(txn.stockId) || { qty: 0, costBasis: 0, avgCost: 0 };
      if(txn.type === 'buy'){
        const qty = parseN(txn.qty);
        const amount = parseN(txn.amount) || parseN(txn.price) * qty;
        state.qty += qty;
        state.costBasis += amount;
        state.avgCost = state.qty > 0 ? state.costBasis / state.qty : 0;
      }else if(txn.type === 'sell'){
        const qty = parseN(txn.qty);
        const proceeds = parseN(txn.amount) || parseN(txn.price) * qty;
        realized += proceeds - state.avgCost * qty;
        state.costBasis -= state.avgCost * qty;
        state.qty -= qty;
        if(state.qty <= 0.0000001){ state.qty = 0; state.costBasis = 0; state.avgCost = 0; }
        else state.avgCost = state.costBasis / state.qty;
      }else if(txn.type === 'fee'){
        realized -= parseN(txn.amount);
      }else if(txn.type === 'dividend'){
        realized += parseN(txn.amount);
      }
      states.set(txn.stockId, state);
    }
    return realized;
  }

  function getTransferTotals(transfers){
    let inbound = 0;
    let outbound = 0;
    for(const transfer of transfers){
      const amount = Math.max(0, parseN(transfer?.amount));
      if(!(amount > 0)) continue;
      if(transfer.to === EXPERIMENT_POOL_KEY && transfer.from !== EXPERIMENT_POOL_KEY) inbound += amount;
      if(transfer.from === EXPERIMENT_POOL_KEY && transfer.to !== EXPERIMENT_POOL_KEY) outbound += amount;
    }
    return { inbound, outbound };
  }

  function isPreciousMetalRow(row){
    const assetClass = String(row?.stock?.assetClass || '').toLowerCase();
    const symbol = String(row?.stock?.symbol || '').toLowerCase();
    const name = String(row?.stock?.name || '').toLowerCase();
    return /precious|gold|silver/.test(assetClass) || /黃金|白銀|gold|silver/.test(`${symbol} ${name}`);
  }

  function computeCapitalPools(summary = calculatePortfolioSummary()){
    const { config, txnMap, transfers } = readCapitalPoolMeta();
    const experimentTxns = (DB.txns || []).filter(txn => normalizeCapitalPoolKey(txnMap[txn.id]) === EXPERIMENT_POOL_KEY);
    const experimentPositions = buildExperimentPositions(experimentTxns);
    const experimentSymbols = new Set(experimentPositions.map(row => row.symbol));
    const initialCapital = Math.max(0, parseN(config.initialCapital));
    const compoundCap = Math.max(initialCapital, parseN(config.compoundCap) || parseN(config.hardCap) || initialCapital);
    const transferTotals = getTransferTotals(transfers);
    let experimentCash = initialCapital + transferTotals.inbound - transferTotals.outbound;
    for(const txn of experimentTxns){
      const amount = parseN(txn.amount) || parseN(txn.price) * parseN(txn.qty);
      if(txn.type === 'buy' || txn.type === 'fee') experimentCash -= amount;
      else if(txn.type === 'sell' || txn.type === 'dividend') experimentCash += amount;
    }

    const experimentCost = experimentPositions.reduce((sum, row) => sum + parseN(row.costBasis), 0);
    const experimentMarketValue = experimentPositions.reduce((sum, row) => sum + parseN(row.marketValue), 0);
    const experimentUnrealizedPnl = experimentPositions.reduce((sum, row) => sum + parseN(row.unrealized), 0);
    const experimentRealizedPnl = computeExperimentRealizedPnl(experimentTxns);
    const experimentNav = experimentCash + experimentMarketValue;
    const lifetimePnl = experimentNav + transferTotals.outbound - initialCapital - transferTotals.inbound;
    const excessAboveCap = Math.max(0, experimentNav - compoundCap);
    const cashSweepable = Math.min(Math.max(0, experimentCash), excessAboveCap);
    const unrealizedExcess = Math.max(0, excessAboveCap - cashSweepable);
    const pendingBuys = getTradeJournalPendingBuys();
    const freeCash = summary.cashAvailable - experimentCash;
    const availableExperimentCash = experimentCash - pendingBuys.experimentB;
    const reservation = typeof getReservationSummary === 'function'
      ? getReservationSummary()
      : { buyTotal: 0, buyCount: 0 };
    // Watchlist 與交易日誌可能記錄同一張預約單，取較高值避免重複扣款。
    const pendingFreeBuys = Math.max(pendingBuys.portfolio, parseN(reservation.buyTotal));
    const freeCashFloorPct = getCashFloorPct() ?? 1;
    const freeCashReserveTarget = Math.max(0, summary.totalAssets * freeCashFloorPct / 100);
    const freeCashRetained = Math.max(0, Math.min(freeCash, freeCashReserveTarget));
    const freeCashReserveGap = Math.max(0, freeCashReserveTarget - freeCash);
    const grossInvestableFreeCash = Math.max(0, freeCash - freeCashReserveTarget);
    const availableFreeCash = Math.max(0, grossInvestableFreeCash - pendingFreeBuys);
    const freeCashAfterReservations = freeCash - pendingFreeBuys;
    const freeCashRetainedAfterReservations = Math.max(0, Math.min(freeCashAfterReservations, freeCashReserveTarget));
    const reservationOverage = Math.max(0, pendingFreeBuys - grossInvestableFreeCash);

    const positionRows = [];
    const bucketTotals = { core: 0, satellite: 0, tactical: 0, preciousMetals: 0 };
    const experimentBySymbol = new Map(experimentPositions.map(row => [row.symbol, row]));
    for(const row of summary.heldRows){
      const symbol = String(row.stock.symbol || '').trim().toUpperCase();
      const experimentRow = experimentBySymbol.get(symbol);
      let pool = 'tactical';
      let costBasis = parseN(row.costBasis);
      let marketValue = parseN(row.marketValue);
      let unrealized = parseN(row.unrealized);
      if(experimentRow){
        pool = EXPERIMENT_POOL_KEY;
        costBasis = experimentRow.costBasis;
        marketValue = experimentRow.marketValue;
        unrealized = experimentRow.unrealized;
      }else if(isPreciousMetalRow(row)){
        pool = 'preciousMetals';
      }else{
        const tier = normalizeTierValue(getStockLabel(row.stock.id)?.tier);
        pool = tier === 'core' ? 'core' : (tier === 'satellite' ? 'satellite' : 'tactical');
      }
      if(pool !== EXPERIMENT_POOL_KEY) bucketTotals[pool] += marketValue;
      positionRows.push({
        pool,
        symbol,
        name: row.stock.name || '',
        qty: experimentRow ? experimentRow.qty : row.qty,
        avgCost: experimentRow ? experimentRow.avgCost : row.avgCost,
        costBasis,
        marketValue,
        unrealized,
        unrealizedPct: costBasis > 0 ? unrealized / costBasis * 100 : null,
        allocationPct: summary.totalAssets > 0 ? marketValue / summary.totalAssets * 100 : 0
      });
    }

    const allocatedTotal = bucketTotals.core + bucketTotals.satellite + bucketTotals.tactical
      + bucketTotals.preciousMetals + experimentNav + freeCash;
    const reconciliationDiff = allocatedTotal - summary.totalAssets;
    const maxSeats = Math.max(1, parseN(config.maxSeats) || 5);
    const seatLimit = Math.max(0, parseN(config.seatLimit) || 100000);
    const activeSeats = experimentPositions.length;
    const openSeats = Math.max(0, maxSeats - activeSeats);
    const newPositionCapacity = Math.max(0, Math.min(availableExperimentCash, openSeats * seatLimit));

    return {
      config,
      initialCapital,
      compoundCap,
      experimentTxns,
      experimentPositions,
      experimentSymbols,
      experimentCost,
      experimentMarketValue,
      experimentCash,
      experimentNav,
      experimentRealizedPnl,
      experimentUnrealizedPnl,
      lifetimePnl,
      excessAboveCap,
      cashSweepable,
      unrealizedExcess,
      freeCash,
      pendingExperimentBuys: pendingBuys.experimentB,
      pendingFreeBuys,
      pendingFreeBuyCount: parseN(reservation.buyCount),
      availableExperimentCash,
      availableFreeCash,
      freeCashFloorPct,
      freeCashReserveTarget,
      freeCashRetained,
      freeCashReserveGap,
      grossInvestableFreeCash,
      freeCashAfterReservations,
      freeCashRetainedAfterReservations,
      reservationOverage,
      activeSeats,
      openSeats,
      maxSeats,
      seatLimit,
      newPositionCapacity,
      bucketTotals,
      positionRows,
      allocatedTotal,
      reconciliationDiff,
      isReconciled: Math.abs(reconciliationDiff) < 1,
      progressPct: compoundCap > 0 ? experimentNav / compoundCap * 100 : 0,
      distanceToCap: Math.max(0, compoundCap - experimentNav),
      transferTotals
    };
  }

  function capitalPoolLabel(pool){
    return POOL_LABELS[pool] || pool;
  }

  function formatMoney(value){
    return fmtInt.format(Math.round(parseN(value)));
  }

  function formatSignedMoney(value){
    const amount = Math.round(parseN(value));
    return `${amount > 0 ? '+' : ''}${fmtInt.format(amount)}`;
  }

  function renderCapitalPools(summary = calculatePortfolioSummary()){
    const host = document.getElementById('capital-pools-panel');
    if(!host) return;
    const vm = computeCapitalPools(summary);
    const progressWidth = Math.min(100, Math.max(0, vm.progressPct));
    const statusClass = vm.excessAboveCap > 0 ? 'warn' : (vm.lifetimePnl >= 0 ? 'ok' : 'neutral');
    const reconClass = vm.isReconciled ? 'ok' : 'error';
    const reconText = vm.isReconciled
      ? `分艙合計與總資產一致（${formatMoney(summary.totalAssets)}）`
      : `分艙差額 ${formatSignedMoney(vm.reconciliationDiff)}，請先檢查資金池歸屬`;
    const bucketOrder = ['core', 'satellite', 'tactical', 'experimentB', 'preciousMetals'];
    const rowsByPool = Object.fromEntries(bucketOrder.map(key => [key, vm.positionRows.filter(row => row.pool === key)]));
    const bucketMv = {
      core: vm.bucketTotals.core,
      satellite: vm.bucketTotals.satellite,
      tactical: vm.bucketTotals.tactical,
      experimentB: vm.experimentMarketValue,
      preciousMetals: vm.bucketTotals.preciousMetals
    };

    const detailRows = bucketOrder.map(pool => {
      const rows = rowsByPool[pool];
      const groupRow = `<tr class="capital-pool-group-row"><td colspan="3">${cpEscape(capitalPoolLabel(pool))}</td><td class="num">${formatMoney(bucketMv[pool])}</td><td colspan="3"></td></tr>`;
      if(!rows.length){
        return `${groupRow}<tr class="capital-pool-empty-row"><td></td><td colspan="6">目前沒有${cpEscape(capitalPoolLabel(pool))}部位</td></tr>`;
      }
      return groupRow + rows.map(row => {
        const pnlClass = row.unrealized > 0 ? 'pos' : (row.unrealized < 0 ? 'neg' : '');
        const pnlPct = Number.isFinite(row.unrealizedPct)
          ? `${row.unrealizedPct > 0 ? '+' : ''}${row.unrealizedPct.toFixed(1)}%`
          : '—';
        return `<tr>
          <td><span class="capital-pool-tag pool-${cpEscape(pool)}">${cpEscape(capitalPoolLabel(pool))}</span></td>
          <td class="text-start"><strong>${cpEscape(row.symbol)}</strong> <span class="muted">${cpEscape(row.name)}</span></td>
          <td class="num">${formatMoney(row.costBasis)}</td>
          <td class="num">${formatMoney(row.marketValue)}</td>
          <td class="num ${pnlClass}">${formatSignedMoney(row.unrealized)}</td>
          <td class="num ${pnlClass}">${pnlPct}</td>
          <td class="num">${row.allocationPct.toFixed(2)}%</td>
        </tr>`;
      }).join('');
    }).join('');

    host.innerHTML = `
      <div class="capital-pools-head">
        <div>
          <div class="overview-panel-title">資金分艙</div>
          <div class="mini muted">40 萬起始本金可持續複利；艙值超過 50 萬後，超額部分才轉回自由現金。</div>
        </div>
        <span class="capital-pools-recon ${reconClass}">${cpEscape(reconText)}</span>
      </div>
      <div class="capital-pools-kpis">
        <div class="capital-pool-kpi"><span>目前使用成本</span><strong>${formatMoney(vm.experimentCost)}</strong><small>實驗持股市值 ${formatMoney(vm.experimentMarketValue)}</small></div>
        <div class="capital-pool-kpi"><span>實驗可用現金</span><strong>${formatMoney(vm.availableExperimentCash)}</strong><small>${vm.pendingExperimentBuys > 0 ? `已扣預約單 ${formatMoney(vm.pendingExperimentBuys)}` : `帳面 ${formatMoney(vm.experimentCash)}`}</small></div>
        <div class="capital-pool-kpi"><span>自由現金總額</span><strong>${formatMoney(vm.freeCash)}</strong><small>${(vm.freeCash / summary.totalAssets * 100).toFixed(2)}% 總資產</small></div>
        <div class="capital-pool-kpi"><span>需保留自由現金</span><strong>${formatMoney(vm.freeCashReserveTarget)}</strong><small>保留底線 ${vm.freeCashFloorPct}%</small></div>
        <div class="capital-pool-kpi ${vm.reservationOverage > 0 ? 'warn' : 'ok'}"><span>淨可投資金額</span><strong>${formatMoney(vm.availableFreeCash)}</strong><small>${vm.pendingFreeBuys > 0 ? `已扣預約單 ${formatMoney(vm.pendingFreeBuys)}` : `保留 ${vm.freeCashFloorPct}% 後`}</small></div>
        <div class="capital-pool-kpi ${statusClass}"><span>實驗艙總值</span><strong>${formatMoney(vm.experimentNav)}</strong><small>累計 ${formatSignedMoney(vm.lifetimePnl)}</small></div>
        <div class="capital-pool-kpi ${vm.cashSweepable > 0 ? 'warn' : ''}"><span>可轉出自由現金</span><strong>${formatMoney(vm.cashSweepable)}</strong><small>${vm.unrealizedExcess > 0 ? `另有待實現 ${formatMoney(vm.unrealizedExcess)}` : '超過 50 萬才啟動'}</small></div>
      </div>
      <div class="capital-pool-progress-wrap">
        <div class="capital-pool-progress-label"><span>50 萬複利門檻</span><strong>${Math.max(0, vm.progressPct).toFixed(1)}%</strong></div>
        <div class="capital-pool-progress"><span style="width:${progressWidth.toFixed(2)}%"></span></div>
        <div class="capital-pool-progress-meta">
          <span>起始 ${formatMoney(vm.initialCapital)}</span>
          <span>${vm.excessAboveCap > 0 ? `超額 ${formatMoney(vm.excessAboveCap)}` : `距門檻 ${formatMoney(vm.distanceToCap)}`}</span>
          <span>席位 ${vm.activeSeats}/${vm.maxSeats}，新標的可用上限 ${formatMoney(vm.newPositionCapacity)}</span>
        </div>
      </div>
      <details class="capital-pools-detail">
        <summary>查看每一個部位與金額</summary>
        <div class="table-wrap">
          <table class="capital-pools-table">
            <thead><tr><th>資金池</th><th class="text-start">標的</th><th class="num">投入成本</th><th class="num">目前市值</th><th class="num">未實現損益</th><th class="num">未實現獲利率</th><th class="num">總資產占比</th></tr></thead>
            <tbody>${detailRows}</tbody>
            <tfoot>
              <tr><td colspan="3">實驗艙現金</td><td class="num">${formatMoney(vm.experimentCash)}</td><td colspan="3"></td></tr>
              <tr><td colspan="3">自由現金（已保留）</td><td class="num">${formatMoney(vm.freeCashRetainedAfterReservations)}</td><td colspan="3"></td></tr>
              <tr><td colspan="3">自由現金（預約占用）</td><td class="num">${formatMoney(vm.pendingFreeBuys)}</td><td colspan="3"></td></tr>
              <tr><td colspan="3">自由現金（淨可投資）</td><td class="num">${formatMoney(vm.availableFreeCash)}</td><td colspan="3"></td></tr>
              <tr class="capital-pools-total-row"><td colspan="3">資產合計</td><td class="num">${formatMoney(vm.allocatedTotal)}</td><td colspan="3"></td></tr>
            </tfoot>
          </table>
        </div>
      </details>`;
  }

  window.EXPERIMENT_POOL_KEY = EXPERIMENT_POOL_KEY;
  window.normalizeCapitalPoolKey = normalizeCapitalPoolKey;
  window.ensureCapitalPoolMeta = ensureCapitalPoolMeta;
  window.getTxnCapitalPool = getTxnCapitalPool;
  window.setTxnCapitalPool = setTxnCapitalPool;
  window.deleteTxnCapitalPool = deleteTxnCapitalPool;
  window.computeCapitalPools = computeCapitalPools;
  window.renderCapitalPools = renderCapitalPools;
  window.capitalPoolLabel = capitalPoolLabel;
})();
