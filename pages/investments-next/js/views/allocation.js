  // ========= 資產成果（圖表／表格 DOM 若不存在則略過）=========
  function renderSnapshots(){
    const tbl = $('#tbl-snapshots');
    if(!tbl) return;
    const tbody = $('#tbl-snapshots tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    const list = getRenderableSnapshots().sort((a,b)=> a.date<b.date?1:-1);
    if(list.length===0){ 
      tbody.innerHTML = `<tr><td colspan="8" class="empty">尚無紀錄</td></tr>`; 
      const changeContainer = $('#change-chart-svg-container');
      if(changeContainer){ changeContainer.innerHTML = '<div class="empty">尚無資料</div>'; }
      const totalContainer = $('#chart-svg-container');
      if(totalContainer){ totalContainer.innerHTML = '<div class="empty">尚無資料</div>'; }
      const summaryEl = $('#summary-change');
      if(summaryEl){ summaryEl.textContent = '—'; }
      return; 
    }
    
    // 準備圖表資料
    const chartData = [];
    const initialCapital = getInitialCapitalAmount();
    
    for(let i = 0; i < list.length; i++){
      const s = list[i];
      const currentTotal = parseN(s.total);
      
      // 計算與前一筆的差異（按日期排序，找最近的較早日期）
      let deltaAmt = 0;
      let deltaPct = 0;
      
      if(i < list.length - 1) { // 不是最後一筆（最新的）
        const prevSnapshot = list[i + 1]; // 前一筆記錄
        const prevTotal = parseN(prevSnapshot.total);
        deltaAmt = currentTotal - prevTotal;
        deltaPct = prevTotal > 0 ? (deltaAmt / prevTotal) : 0;
      }
      
      const capitalAdjustmentsToDate = sumCapitalAdjustments(s.date);
      const investedCapitalToDate = initialCapital + capitalAdjustmentsToDate;
      const cumulativeChange = currentTotal - investedCapitalToDate;
      // 收集圖表資料（反轉順序，讓最早的日期在左邊）
      chartData.unshift({
        date: s.date,
        deltaAmt: deltaAmt,
        deltaPct: deltaPct,
        totalAsset: currentTotal,
        cumulativeChange,
        investedCapital: investedCapitalToDate
      });
      
      const tr = document.createElement('tr');
      const cumulativeText = cumulativeChange>=0
        ? '▲ '+fmtInt.format(Math.round(cumulativeChange))
        : '▼ '+fmtInt.format(Math.round(Math.abs(cumulativeChange)));
      tr.innerHTML = `
        <td>${s.date}</td>
        <td class="num">${fmtInt.format(Math.round(parseN(s.holdings)))}</td>
        <td class="num">${fmtInt.format(Math.round(parseN(s.cash)))}</td>
        <td class="num">${fmtInt.format(Math.round(currentTotal))}</td>
        <td class="num">${deltaAmt>=0? '▲ '+fmtInt.format(Math.round(deltaAmt)): '▼ '+fmtInt.format(Math.round(Math.abs(deltaAmt)))}</td>
        <td class="num">${deltaPct>=0? '+'+ (deltaPct*100).toFixed(2)+'%': (deltaPct*100).toFixed(2)+'%'}</td>
        <td class="num">${cumulativeText}</td>
        <td class="num">
          <button class="btn mini" type="button" data-id="${s.date}" data-action="edit-snapshot">編輯</button>
          <button class="btn mini danger" type="button" data-id="${s.date}" data-action="del-snapshot">刪除</button>
        </td>`;
      tbody.appendChild(tr);
    }
    
    // 渲染 Highcharts 折線圖
    renderSnapshotChangeChart(chartData);
    renderSnapshotChart(chartData);
  }

  // ========= 每日自動快照（24:00 前最後一筆）=========
  let _autoSnapshotInitialized = false;
  let _autoSnapshotIntervalId = null;
  let _autoSnapshotDeadlineId = null;

  const TWSE_MARKET_HOLIDAYS_2026 = new Set([
    '2026-01-01',
    '2026-02-12',
    '2026-02-13',
    '2026-02-15',
    '2026-02-16',
    '2026-02-17',
    '2026-02-18',
    '2026-02-19',
    '2026-02-20',
    '2026-02-27',
    '2026-04-03',
    '2026-04-04',
    '2026-04-05',
    '2026-04-06',
    '2026-05-01',
    '2026-06-19',
    '2026-09-25',
    '2026-09-28',
    '2026-10-09',
    '2026-10-10',
    '2026-10-25',
    '2026-10-26',
    '2026-12-25'
  ]);

  function isSnapshotDisplayDateAllowed(dateStr){
    const d = parseLocalDateOnly(dateStr);
    if(!d) return false;
    const day = d.getDay();
    if(day === 0 || day === 6) return false;
    if(TWSE_MARKET_HOLIDAYS_2026.has(dateStr)) return false;
    return true;
  }

  function getRenderableSnapshots(){
    return [...(DB.snapshots || [])]
      .filter(s => s && s.date && isSnapshotDisplayDateAllowed(s.date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function isAutoSnapshotDateAllowed(dateStr){
    return isSnapshotDisplayDateAllowed(dateStr);
  }

  function computeCurrentAssetSnapshotBase(dateStr){
    const summary = calculatePortfolioSummary();
    const holdings = Math.round(summary.holdingsMarketValue);
    const cash = Math.round(summary.cashAvailable);
    const total = Math.round(summary.totalAssets);
    const investedCapitalToDate = getInitialCapitalAmount() + sumCapitalAdjustments(dateStr);
    const returnAmount = Math.round(total - investedCapitalToDate);
    const prev = getRenderableSnapshots()
      .filter(s => s.date < dateStr)
      .sort((a, b) => a.date < b.date ? 1 : -1)[0];
    const prevTotal = prev ? parseN(prev.total) : 0;
    const deltaAmt = prev ? (total - prevTotal) : 0;
    const deltaPct = prev && prevTotal !== 0 ? (deltaAmt / prevTotal) : 0;
    return { date: dateStr, holdings, cash, total, returnAmount, deltaAmt, deltaPct };
  }

  const HISTORICAL_SNAPSHOT_IMPORT_202604_TRADING_DAYS = [
    { date: '2026-04-01', holdings: 3949131, cash: 18631, total: 3967762, deltaAmt: null },
    { date: '2026-04-02', holdings: 4119078, cash: -207040, total: 3912038, deltaAmt: -55724 },
    { date: '2026-04-07', holdings: 3951650, cash: 244940, total: 4196590, deltaAmt: 54552 },
    { date: '2026-04-08', holdings: 4083698, cash: 244940, total: 4328638, deltaAmt: 132048 },
    { date: '2026-04-09', holdings: 4076822, cash: 244940, total: 4321762, deltaAmt: -6876 },
    { date: '2026-04-10', holdings: 3813526, cash: 550945, total: 4364471, deltaAmt: 42709 },
    { date: '2026-04-13', holdings: 3970524, cash: 377980, total: 4348504, deltaAmt: -15967 },
    { date: '2026-04-14', holdings: 4358338, cash: 52364, total: 4410702, deltaAmt: 62198 },
    { date: '2026-04-15', holdings: 4094550, cash: 353568, total: 4448118, deltaAmt: 37416 },
    { date: '2026-04-16', holdings: 4235839, cash: 252774, total: 4488613, deltaAmt: 40495 }
  ];

  async function importHistoricalSnapshots202604TradingDays(){
    if(!DB || !Array.isArray(DB.snapshots)) return false;
    if(!DB.meta || typeof DB.meta !== 'object') DB.meta = {};
    if(!DB.meta.seedFlags || typeof DB.meta.seedFlags !== 'object') DB.meta.seedFlags = {};

    const seedKey = 'historicalSnapshots_202604_trading_days_v3';
    if(DB.meta.seedFlags[seedKey]) return false;

    const importNote = '匯入：2026-04-01~2026-04-16 歷史快照（僅交易日）';

    HISTORICAL_SNAPSHOT_IMPORT_202604_TRADING_DAYS.forEach((row, index) => {
      const prevImported = index > 0 ? HISTORICAL_SNAPSHOT_IMPORT_202604_TRADING_DAYS[index - 1] : null;
      const deltaAmt = row.deltaAmt == null ? 0 : Math.round(parseN(row.deltaAmt));
      const deltaPct = prevImported && parseN(prevImported.total) !== 0
        ? (deltaAmt / parseN(prevImported.total))
        : 0;
      const investedCapitalToDate = getInitialCapitalAmount() + sumCapitalAdjustments(row.date);
      const returnAmount = Math.round(parseN(row.total) - investedCapitalToDate);
      const idx = DB.snapshots.findIndex(snapshot => snapshot.date === row.date);
      const existing = idx >= 0 ? (DB.snapshots[idx] || {}) : {};
      const note = existing.note
        ? (existing.note.includes(importNote) ? existing.note : `${existing.note}｜${importNote}`)
        : importNote;

      const payload = {
        ...existing,
        date: row.date,
        holdings: Math.round(parseN(row.holdings)),
        cash: Math.round(parseN(row.cash)),
        total: Math.round(parseN(row.total)),
        returnAmount,
        deltaAmt,
        deltaPct,
        note
      };

      if(idx >= 0) DB.snapshots[idx] = payload;
      else DB.snapshots.push(payload);
    });

    DB.meta.seedFlags[seedKey] = {
      importedAt: nowISO(),
      count: HISTORICAL_SNAPSHOT_IMPORT_202604_TRADING_DAYS.length
    };

    await saveDB({backup:true});
    return true;
  }

  function getStockQuoteDateKey(stock){
    if(!stock?.lastPriceAt) return '';
    try{ return localDateStr(new Date(stock.lastPriceAt)); }
    catch(e){ return ''; }
  }

  function getStockQuoteMinutes(stock){
    if(!stock?.lastPriceAt) return null;
    const d = new Date(stock.lastPriceAt);
    if(Number.isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes();
  }

  // 指定日期是否已有任何標的抓到該日報價（lastPriceAt 屬於該日）。
  // 若整天都沒有新鮮報價（價格停在前一交易日），代表這是停損/休市/代理離線情況，
  // 此時寫入的快照會用 stale 價格，造成日變化圖把延後的漲跌灌到隔天（2026-06-11 的根因）。
  function holdingsPricesFreshForDate(dateStr){
    return (DB.stocks || []).some(s => {
      return getStockQuoteDateKey(s) === dateStr;
    });
  }

  function holdingsPricesFreshToday(){
    return holdingsPricesFreshForDate(localDateStr());
  }

  function quoteCloseReadyForDate(dateStr){
    const closeMinutes = 13 * 60 + 30;
    return (DB.stocks || []).some(s => (
      getStockQuoteDateKey(s) === dateStr
      && Number.isFinite(getStockQuoteMinutes(s))
      && getStockQuoteMinutes(s) >= closeMinutes
    ));
  }

  function isAfterTwseCloseSnapshotTime(date = new Date()){
    const local = date instanceof Date ? date : new Date(date);
    if(Number.isNaN(local.getTime())) return false;
    const minutes = local.getHours() * 60 + local.getMinutes();
    return minutes >= (15 * 60 + 30);
  }

  function getLatestAutoSnapshotDate(){
    const today = localDateStr();
    const quoteDates = [...new Set((DB.stocks || [])
      .map(getStockQuoteDateKey)
      .filter(date => date && isAutoSnapshotDateAllowed(date) && date <= today))]
      .sort()
      .reverse();
    for(const date of quoteDates){
      if(date < today) return date;
      if(isAfterTwseCloseSnapshotTime() || quoteCloseReadyForDate(date)) return date;
    }
    return '';
  }

  function requestDailyArchiveForSnapshotDate(date, reason){
    if(!date || typeof captureDailyArchive !== 'function') return;
    Promise.resolve()
      .then(() => captureDailyArchive('auto', { date, reason: `snapshot-${reason || 'auto'}` }))
      .catch(err => console.warn('[archive] auto capture for snapshot failed:', date, err));
  }

  async function captureLatestReturnDailyArchive(reason = 'auto'){
    if(typeof captureDailyArchive !== 'function') return false;
    const date = getLatestAutoSnapshotDate();
    if(!date) return false;
    return captureDailyArchive('auto', { date, reason: `snapshot-${reason || 'auto'}` });
  }
  window.captureLatestReturnDailyArchive = captureLatestReturnDailyArchive;

  function upsertAutoDailySnapshot(reason = 'auto', force = false){
    if(!DB || !Array.isArray(DB.snapshots)) return false;
    const date = getLatestAutoSnapshotDate();
    if(!date) return false;
    if(!isAutoSnapshotDateAllowed(date)) return false;
    if(date === localDateStr() && !isAfterTwseCloseSnapshotTime() && !quoteCloseReadyForDate(date)){
      console.warn('[snapshot] 台股收盤前略過自動快照：', date, reason);
      return false;
    }
    // 防止 stale 快照：目標日期若完全沒有新鮮報價，就不要自動寫入該日快照
    // （寧可趨勢圖少一天、也不要記一筆用舊價算出的誤導值）。
    if(!holdingsPricesFreshForDate(date)){
      console.warn('[snapshot] 今日無新鮮報價，略過自動快照以避免 stale 資料：', date, reason);
      return false;
    }
    const base = computeCurrentAssetSnapshotBase(date);
    const idx = DB.snapshots.findIndex(s => s.date === date);

    if(idx >= 0){
      const existing = DB.snapshots[idx] || {};
      const hasReturnAmount = existing.returnAmount !== undefined && existing.returnAmount !== null && existing.returnAmount !== '';
      const isSame = parseN(existing.holdings) === base.holdings
        && parseN(existing.cash) === base.cash
        && parseN(existing.total) === base.total
        && hasReturnAmount
        && parseN(existing.returnAmount) === base.returnAmount;
      if(!force && isSame){
        if(!DB.meta?.dailyArchive?.[date]) requestDailyArchiveForSnapshotDate(date, reason);
        return false;
      }
      DB.snapshots[idx] = {
        ...existing,
        ...base,
        note: existing.note || '',
        auto: true,
        autoUpdatedAt: nowISO(),
        autoReason: reason
      };
    } else {
      DB.snapshots.push({
        ...base,
        note: '',
        auto: true,
        autoUpdatedAt: nowISO(),
        autoReason: reason
      });
    }

    saveDB();
    requestDailyArchiveForSnapshotDate(date, reason);
    return true;
  }

  function scheduleAutoSnapshotBeforeMidnight(){
    if(_autoSnapshotDeadlineId) clearTimeout(_autoSnapshotDeadlineId);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 50, 0);
    if(target <= now) target.setDate(target.getDate() + 1);
    _autoSnapshotDeadlineId = setTimeout(() => {
      upsertAutoDailySnapshot('eod', true);
      scheduleAutoSnapshotBeforeMidnight();
    }, target.getTime() - now.getTime());
  }

  function startAutoDailySnapshotWatcher(){
    if(_autoSnapshotInitialized) return;
    _autoSnapshotInitialized = true;

    // 進頁先寫一筆，確保當日趨勢有資料
    upsertAutoDailySnapshot('init');

    // 週期更新當日快照（覆蓋同一天）
    _autoSnapshotIntervalId = setInterval(() => {
      upsertAutoDailySnapshot('interval');
    }, 5 * 60 * 1000);

    // 24:00 前強制寫入最後一筆
    scheduleAutoSnapshotBeforeMidnight();

    // 切背景或離頁前補寫，盡量保留最後狀態
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'hidden'){
        upsertAutoDailySnapshot('hidden', true);
      }
    });
    window.addEventListener('pagehide', () => {
      upsertAutoDailySnapshot('pagehide', true);
    });
  }

  function handleSnapshotAction(action, date){
    if(!date) return;
    const snapshot = DB.snapshots.find(s=>s.date===date);
    if(action === 'edit'){
      if(snapshot){ openSnapshotDialog(snapshot); }
      return;
    }
    if(action === 'delete'){
      if(confirm('確定刪除此筆資產成果記錄？')){
        DB.snapshots = DB.snapshots.filter(s=>s.date!==date);
        persistAndRefresh({
          chrome: true,
          overview: true,
          holdings: true,
          txns: true,
          dividend: true,
          returns: true,
          snapshots: true
        }, {backup:true, allowPerformanceDelete:true});
      }
    }
  }
  window.handleSnapshotAction = handleSnapshotAction;
  
  // 當前選中的時間範圍
  let currentRange = 14;
  
  // 渲染累計資產增減圖表（Highcharts 折線圖）
  function renderSnapshotChangeChart(data){
    const containerId = 'change-chart-svg-container';
    const containerEl = $('#'+containerId);
    if (!containerEl) return;

    if (data.length === 0) {
      containerEl.innerHTML = '<div class="empty">尚無資料</div>';
      $('#summary-change').textContent = '—';
      return;
    }

    const filteredData = getFilteredData(data, currentRange);
    if (filteredData.length === 0) {
      containerEl.innerHTML = '<div class="empty">選定範圍內尚無資料</div>';
      $('#summary-change').textContent = '—';
      return;
    }

    updateAssetSummary(filteredData);

    if (typeof Highcharts === 'undefined') {
      containerEl.innerHTML = '<div class="empty">圖表庫未載入</div>';
      return;
    }

    containerEl.textContent = '';

    const categories = filteredData.map(item => {
      if(!item.date) return '';
      const raw = item.date.slice(5);
      return raw.replace('-', '/');
    });
    const toWan = (value) => {
      const num = parseN(value);
      return Number.isFinite(num) ? Number((num / 10000).toFixed(2)) : null;
    };
    const changeSeries = filteredData.map(item => toWan(item.cumulativeChange));

    Highcharts.chart(containerId, {
      chart: { type: 'line', height: 340, spacingBottom: 40 },
      title: { text: null },
      subtitle: { text: null },
      credits: { enabled: false },
      xAxis: {
        categories,
        labels: { style: { color: '#6b7280', fontSize: '12px' } }
      },
      yAxis: {
        title: { text: '累計資產增減 (萬元)' },
        labels: {
          formatter() { return this.value.toFixed(1); },
          style: { color: '#6b7280', fontSize: '12px' }
        },
        plotLines: [{ value: 0, color: '#94a3b8', width: 1, dashStyle: 'Dash' }]
      },
      legend: { enabled: false },
      plotOptions: {
        line: {
          dataLabels: {
            enabled: true,
            formatter() {
              return this.y != null ? this.y.toFixed(1) : '';
            }
          },
          enableMouseTracking: false,
          marker: { symbol: 'circle' }
        },
        series: { animation: false }
      },
      series: [{
        name: '資產變化金額',
        data: changeSeries,
        color: '#ef4444'
      }]
    });
  }

  // 渲染總資產變化圖表（Highcharts 折線圖）
  function renderSnapshotChart(data) {
    const containerId = 'chart-svg-container';
    const containerEl = $('#'+containerId);
    if (!containerEl) return;
  
    if (data.length === 0) {
      containerEl.innerHTML = '<div class="empty">尚無資料</div>';
      $('#summary-change').textContent = '—';
      return;
    }
  
    const filteredData = getFilteredData(data, currentRange);
    if (filteredData.length === 0) {
      containerEl.innerHTML = '<div class="empty">選定範圍內尚無資料</div>';
      $('#summary-change').textContent = '—';
      return;
    }
  
    if (typeof Highcharts === 'undefined') {
      containerEl.innerHTML = '<div class="empty">圖表庫未載入</div>';
      return;
    }
  
    containerEl.textContent = '';
  
    const categories = filteredData.map(item => {
      if(!item.date) return '';
      const raw = item.date.slice(5); // 取出 MM-DD
      return raw.replace('-', '/');
    });
    const toWan = (value) => {
      const num = parseN(value);
      return Number.isFinite(num) ? Number((num / 10000).toFixed(2)) : null;
    };
    const totalSeries = filteredData.map(item => toWan(item.totalAsset));
  
    Highcharts.chart(containerId, {
      chart: { type: 'line', height: 340, spacingBottom: 40 },
      title: { text: null },
      subtitle: { text: null },
      credits: { enabled: false },
      xAxis: {
        categories,
        labels: { style: { color: '#6b7280', fontSize: '12px' } }
      },
      yAxis: {
        title: { text: '總資產 (萬元)' },
        labels: {
          formatter() { return this.value.toFixed(1); },
          style: { color: '#6b7280', fontSize: '12px' }
        }
      },
      legend: { enabled: false },
      plotOptions: {
        line: {
          dataLabels: {
            enabled: true,
            formatter() {
              return this.y != null ? this.y.toFixed(1) : '';
            }
          },
          enableMouseTracking: false,
          marker: { symbol: 'circle' }
        },
        series: { animation: false }
      },
      series: [{
        name: '總資產',
        data: totalSeries,
        color: '#3b82f6'
      }]
    });
  }
  
  // 根據時間範圍篩選數據
  function getFilteredData(data, range) {
    if (range >= data.length) return data;
    return data.slice(-range);
  }
  
  // 更新資產變化摘要
  function updateAssetSummary(data) {
    const summary = $('#asset-summary');
    if(summary){ summary.style.display = 'none'; }
  }

  // ========= 配置 =========
  function renderAllocation(summary = calculatePortfolioSummary()){
    const donutStocks = $('#donut-stocks');
    const labelStocks = $('#label-stocks');
    const stocksList = $('#stocks-list');
    const donutRegion = $('#donut-region');
    const labelRegion = $('#label-region');
    const regionList = $('#region-list');
    const classList = $('#class-list');
    const portfolioStats = $('#portfolio-stats');
    const allocationNote = $('#allocation-rebalance-note');
    const regionNote = $('#region-rebalance-note');
    if(
      !donutStocks || !labelStocks || !stocksList ||
      !donutRegion || !labelRegion || !regionList ||
      !classList || !portfolioStats
    ){
      return;
    }

    const rows = summary.heldRows.map(row => ({ s: row.stock, mval: row.marketValue })).filter(r=>r.mval>0);
    const total = rows.reduce((a,b)=>a+b.mval,0) || 1;

    // 1. 個股投資占比
    const stockColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];
    const sortedStocks = rows.sort((a,b)=>b.mval-a.mval);
    let stockGradient = '', currentAngle = 0;
    sortedStocks.forEach((r, i) => {
      const pct = r.mval / total, angle = pct * 360;
      const color = stockColors[i % stockColors.length];
      stockGradient += `${color} ${currentAngle}deg ${currentAngle + angle}deg, `;
      currentAngle += angle;
    });
    stockGradient = stockGradient.slice(0, -2);
    donutStocks.style.background = `conic-gradient(${stockGradient})`;
    labelStocks.textContent = `${sortedStocks.length} 檔標的`;
    stocksList.innerHTML = sortedStocks.map((r,i)=>{
      const p = (r.mval/total*100).toFixed(1), color = stockColors[i % stockColors.length];
      return `<div class="chart-legend"><div class="color" style="background:${color}"></div><div class="label">${r.s.symbol} · ${r.s.name}</div><div class="value">${p}%</div></div>`;
    }).join('') || '<div class="empty">尚無部位</div>';

    // 2. 台灣 vs 全球
    const byRegion = {TW:0, Global:0};
    for(const r of rows){ byRegion[r.s.market||'Global'] += r.mval; }
    const twPct = byRegion.TW/total, glbPct = byRegion.Global/total;
    donutRegion.style.background = `conic-gradient(#3b82f6 0 ${twPct*360}deg, #10b981 ${twPct*360}deg 360deg)`;
    labelRegion.textContent = `${(twPct*100).toFixed(1)}% / ${(glbPct*100).toFixed(1)}%`;
    regionList.innerHTML = `
      <div class="chart-legend"><div class="color" style="background:#3b82f6"></div><div class="label">台灣</div><div class="value">${(twPct*100).toFixed(1)}%</div></div>
      <div class="chart-legend"><div class="color" style="background:#10b981"></div><div class="label">全球</div><div class="value">${(glbPct*100).toFixed(1)}%</div></div>`;

    // 3. 資產類別（個股 / 被動式ETF / 主動式ETF / 債券ETF）
    const classDef = [
      { key: 'Equity',     label: '個股',     color: '#ef4444' },
      { key: 'PassiveETF', label: '被動式ETF', color: '#3b82f6' },
      { key: 'ActiveETF',  label: '主動式ETF', color: '#8b5cf6' },
      { key: 'BondETF',    label: '債券ETF',   color: '#f59e0b' },
    ];
    const byClass = {};
    classDef.forEach(c => byClass[c.key] = 0);
    for(const r of rows){
      let ac = r.s.assetClass || 'Equity';
      if(ac === 'Bond') ac = 'BondETF'; // 舊值相容
      if(!(ac in byClass)) ac = 'Equity';
      byClass[ac] += r.mval;
    }
    const classSlices = classDef.map(c => ({ ...c, value: byClass[c.key], pct: total > 0 ? byClass[c.key] / total : 0 })).filter(s => s.value > 0);
    const wrapEl = document.getElementById('donut-class-wrap');
    if(wrapEl){
      wrapEl.innerHTML = '';
      wrapEl.appendChild(buildSvgDonut(classSlices));
    }
    classList.innerHTML = classSlices.map(s =>
      `<div class="chart-legend"><div class="color" style="background:${s.color}"></div><div class="label">${s.label}</div><div class="value">${(s.pct*100).toFixed(1)}%</div></div>`
    ).join('');

    // 4. 投資組合統計（✅ 這裡用 kpi-grid）
    const cash = DB.accounts.reduce((a,acc)=> a + (parseN(acc.actual) + parseN(acc.settlement)), 0);
    const totalAssets = total + cash;
    const cashPct = totalAssets > 0 ? (cash / totalAssets * 100) : 0;
    const stats = `
      <div class="item"><div class="label">總投資標的</div><div class="value">${sortedStocks.length} 檔</div></div>
      <div class="item"><div class="label">持有市值</div><div class="value">${fmtInt.format(Math.round(total))}</div></div>
      <div class="item"><div class="label">可用現金</div><div class="value">${fmtInt.format(Math.round(cash))}</div></div>
      <div class="item"><div class="label">總資產</div><div class="value">${fmtInt.format(Math.round(totalAssets))}</div></div>
      <div class="item"><div class="label">現金占比</div><div class="value">${cashPct.toFixed(1)}%</div></div>
    `;
    portfolioStats.innerHTML = stats;

    const eqPct = classSlices.filter(s => s.key !== 'BondETF').reduce((a, s) => a + s.pct, 0);
    const bdPct = classSlices.filter(s => s.key === 'BondETF').reduce((a, s) => a + s.pct, 0);
    const actualAllocation = {
      equity: Number((eqPct * 100).toFixed(2)),
      bond: Number((bdPct * 100).toFixed(2))
    };
    const allocationTarget = getAllocationTarget();
    const allocationExceeded = actualAllocation.equity > allocationTarget.equity + 5 || actualAllocation.bond > allocationTarget.bond + 5;
    if(allocationNote){
      if(allocationExceeded){
        allocationNote.textContent = '⚠️ 實際佔比已超出股票 / 債券目標 5%，建議啟動再平衡機制調整結構。';
        allocationNote.style.color = '#b91c1c';
      }else{
        allocationNote.textContent = '✓ 目前股票 / 債券實際佔比維持在目標範圍內。';
        allocationNote.style.color = '#047857';
      }
    }

    const regionActual = {
      tw: Number((twPct * 100).toFixed(2)),
      global: Number((glbPct * 100).toFixed(2))
    };
    const regionTarget = getRegionTarget();
    const regionExceeded = regionActual.tw > regionTarget.tw + 5 || regionActual.global > regionTarget.global + 5;
    if(regionNote){
      if(regionExceeded){
        regionNote.textContent = '⚠️ 實際佔比已超出台灣 / 全球目標 5%，建議啟動再平衡機制調整結構。';
        regionNote.style.color = '#b91c1c';
      }else{
        regionNote.textContent = '✓ 目前台灣 / 全球實際佔比維持在目標範圍內。';
        regionNote.style.color = '#047857';
      }
    }

    updateTargetLabels(allocationTarget, regionTarget);

    renderAllocationOverviewChart(regionActual, actualAllocation);
  }

  function getAllocationTarget(){
    try{
      const saved = JSON.parse(localStorage.getItem(allocationTargetStorageKey));
      if(saved){
        let equity = Number.parseFloat(saved.equity);
        let bond = Number.parseFloat(saved.bond);
        if(!Number.isFinite(equity)) equity = allocationTargetDefaults.equity;
        if(!Number.isFinite(bond)) bond = allocationTargetDefaults.bond;
        const total = equity + bond;
        if(total > 0){
          const normalizedEquity = equity / total * 100;
          const normalizedBond = bond / total * 100;
          return {
            equity: Number(normalizedEquity.toFixed(2)),
            bond: Number(normalizedBond.toFixed(2))
          };
        }
      }
    }catch(err){
      console.warn('解析配置目標失敗，改用預設值', err);
    }
    return { ...allocationTargetDefaults };
  }

  function saveAllocationTarget(target){
    localStorage.setItem(allocationTargetStorageKey, JSON.stringify(target));
  }

  function getRegionTarget(){
    try{
      const saved = JSON.parse(localStorage.getItem(regionTargetStorageKey));
      if(saved){
        let tw = Number.parseFloat(saved.tw);
        let global = Number.parseFloat(saved.global);
        if(!Number.isFinite(tw)) tw = regionTargetDefaults.tw;
        if(!Number.isFinite(global)) global = regionTargetDefaults.global;
        const total = tw + global;
        if(total > 0){
          const normalizedTw = tw / total * 100;
          const normalizedGlobal = global / total * 100;
          return {
            tw: Number(normalizedTw.toFixed(2)),
            global: Number(normalizedGlobal.toFixed(2))
          };
        }
      }
    }catch(err){
      console.warn('解析台灣 / 全球目標失敗，改用預設值', err);
    }
    return { ...regionTargetDefaults };
  }

  function saveRegionTarget(target){
    localStorage.setItem(regionTargetStorageKey, JSON.stringify(target));
  }

  function updateTargetLabels(allocationTarget, regionTarget){
    const allocationLabel = $('#allocation-target-label');
    if(allocationLabel){
      const eqTarget = Number.isFinite(allocationTarget?.equity) ? Math.round(allocationTarget.equity) : allocationTargetDefaults.equity;
      const bondTarget = Number.isFinite(allocationTarget?.bond) ? Math.round(allocationTarget.bond) : allocationTargetDefaults.bond;
      allocationLabel.textContent = `目標：股票 ${eqTarget}% / 債券 ${bondTarget}%`;
    }
    const regionLabel = $('#region-target-label');
  if(regionLabel){
    const twTarget = Number.isFinite(regionTarget?.tw) ? Math.round(regionTarget.tw) : regionTargetDefaults.tw;
    const globalTarget = Number.isFinite(regionTarget?.global) ? Math.round(regionTarget.global) : regionTargetDefaults.global;
    regionLabel.textContent = `目標：台灣 ${twTarget}% / 全球 ${globalTarget}%`;
  }
}

function renderAllocationOverviewChart(regionActual, allocationActual){
  const container = document.getElementById('allocation-overview-chart');
  if(!container){ return; }

  if(typeof Highcharts === 'undefined'){
    container.innerHTML = '<div class="empty">Highcharts 未載入，無法顯示指標圖。</div>';
    return;
  }

  const targetRegion = getRegionTarget();
  const targetAllocation = getAllocationTarget();

  const categories = ['台灣', '全球', '股票', '債券'];
  const actualSeries = [
    Number(regionActual.tw?.toFixed(2)) || 0,
    Number(regionActual.global?.toFixed(2)) || 0,
    Number(allocationActual.equity?.toFixed(2)) || 0,
    Number(allocationActual.bond?.toFixed(2)) || 0
  ];
  const targetSeries = [
    Number(targetRegion.tw?.toFixed(2)) || 0,
    Number(targetRegion.global?.toFixed(2)) || 0,
    Number(targetAllocation.equity?.toFixed(2)) || 0,
    Number(targetAllocation.bond?.toFixed(2)) || 0
  ];

  Highcharts.chart('allocation-overview-chart', {
    chart: { type: 'column' },
    title: { text: '配置實際 vs 目標' },
    xAxis: { categories },
    yAxis: [{
      min: 20,
      max: 80,
      title: { text: '占比 (%)' }
    }],
    legend: { shadow: false },
    tooltip: { shared: true, valueSuffix: '%' },
    plotOptions: {
      column: {
        grouping: false,
        shadow: false,
        borderWidth: 0
      }
    },
    series: [{
      name: '實際占比',
      color: 'rgba(126,86,134,1)',
      data: actualSeries,
      pointPadding: 0.15,
      pointPlacement: 0,
      pointRange: 0.4,
      borderRadius: 6,
      dataLabels: { enabled: true, format: '{y:.1f}%' }
    }, {
      name: '目標占比',
      color: 'rgba(186,60,61,.5)',
      data: targetSeries,
      pointPadding: 0,
      pointRange: 0.45,
      borderRadius: 14,
      zIndex: -1,
      states: { hover: { enabled: false } },
      enableMouseTracking: false
    }]
  });
}

function renderAllocationPlanner(stockSources, actualAllocation, regionActual, allocationTarget, regionTarget){
  const tbody = $('#tbl-allocation-planner tbody');
  const regionSummary = $('#planner-summary-region');
  const classSummary = $('#planner-summary-class');
  const tradingSummary = $('#planner-summary-trading');
  if(!tbody){ return; }

  allocationPlannerContext = { allocationTarget, regionTarget };
  allocationPlannerBase = stockSources.map(source => {
    const stock = source.stock;
    const position = source.position || {};
    const qty = parseN(position.qty);
    const priceRaw = parseN(stock.price);
    const fallbackValue = parseN(position.marketValue);
    const price = Number.isFinite(priceRaw) && priceRaw > 0
      ? priceRaw
      : (qty > 0 ? fallbackValue / qty : 0);
    return {
      id: stock.id,
      symbol: stock.symbol,
      name: stock.name || '',
      market: (stock.market === 'TW' ? 'TW' : 'Global'),
      assetClass: stock.assetClass || 'Equity',
      qty,
      price: Number.isFinite(price) && price > 0 ? price : 0
    };
  }).filter(item => item.price > 0);

  const baseIds = new Set(allocationPlannerBase.map(item => item.id));
  Object.keys(allocationPlannerAdjustments).forEach(id => {
    if(!baseIds.has(id)) delete allocationPlannerAdjustments[id];
  });
  allocationPlannerBase.forEach(item => {
    if(!Number.isFinite(parseN(allocationPlannerAdjustments[item.id]))){
      allocationPlannerAdjustments[item.id] = 0;
    }
  });

  if(allocationPlannerBase.length === 0){
    tbody.innerHTML = '<tr><td colspan="7" class="empty">尚無持有標的可模擬</td></tr>';
    if(regionSummary){ regionSummary.textContent = '模擬後 台灣 / 全球：—'; }
    if(classSummary){ classSummary.textContent = '模擬後 股票 / 債券：—'; }
    if(tradingSummary){ tradingSummary.textContent = '預估總交易金額：—'; }
    const allocationNote = $('#allocation-rebalance-note');
    if(allocationNote){ allocationNote.textContent = '尚無持股可進行模擬。'; allocationNote.style.color = '#6b7280'; }
    const regionNote = $('#region-rebalance-note');
    if(regionNote){ regionNote.textContent = '尚無持股可進行模擬。'; regionNote.style.color = '#6b7280'; }
    return;
  }

  tbody.innerHTML = allocationPlannerBase.map(item => {
    const delta = parseN(allocationPlannerAdjustments[item.id]) || 0;
    const simulated = Math.max(item.qty + delta, 0);
    const minAdjust = -Math.round(item.qty);
    const tradeValue = delta * item.price;
    const simulatedValue = simulated * item.price;
    return `
      <tr>
        <td><span class="badge blue">${item.symbol}</span></td>
        <td>${item.name}</td>
        <td class="num">${fmtInt.format(Math.round(item.qty))}</td>
        <td class="num"><input type="number" class="planner-input" data-id="${item.id}" value="${delta}" step="1" min="${minAdjust}" /></td>
        <td class="num"><span class="planner-sim" data-id="${item.id}">${fmtInt.format(Math.round(simulated))}</span></td>
        <td class="num"><span class="planner-trade" data-id="${item.id}">${fmtInt.format(Math.round(tradeValue))}</span></td>
        <td class="num"><span class="planner-value" data-id="${item.id}">${fmtInt.format(Math.round(simulatedValue))}</span></td>
      </tr>`;
  }).join('');

  updateAllocationPlannerSummary();
}

function updateAllocationPlannerSummary(){
  const context = allocationPlannerContext;
  const regionSummary = $('#planner-summary-region');
  const classSummary = $('#planner-summary-class');
  const tradingSummary = $('#planner-summary-trading');
  if(!context){
    if(regionSummary) regionSummary.textContent = '模擬後 台灣 / 全球：—';
    if(classSummary) classSummary.textContent = '模擬後 股票 / 債券：—';
    if(tradingSummary) tradingSummary.textContent = '預估總交易金額：—';
    return;
  }

  if(allocationPlannerBase.length === 0){
    if(regionSummary) regionSummary.textContent = '模擬後 台灣 / 全球：—';
    if(classSummary) classSummary.textContent = '模擬後 股票 / 債券：—';
    if(tradingSummary) tradingSummary.textContent = '預估總交易金額：—';
    return;
  }

  let totalValue = 0;
  const byRegion = { TW:0, Global:0 };
  const byClass = { Equity:0, Bond:0 };
  let totalTradeValue = 0;

  allocationPlannerBase.forEach(item => {
    const adj = parseN(allocationPlannerAdjustments[item.id]) || 0;
    const simulatedQty = Math.max(item.qty + adj, 0);
    const value = simulatedQty * item.price;
    const tradeValue = adj * item.price;
    totalValue += value;
    totalTradeValue += tradeValue;
    const regionKey = item.market === 'TW' ? 'TW' : 'Global';
    byRegion[regionKey] += value;
    const classKey = (item.assetClass === 'Bond' || item.assetClass === 'BondETF') ? 'Bond' : 'Equity';
    byClass[classKey] += value;
    const simCell = document.querySelector(`.planner-sim[data-id="${item.id}"]`);
    if(simCell){ simCell.textContent = fmtInt.format(Math.round(simulatedQty)); }
    const tradeCell = document.querySelector(`.planner-trade[data-id="${item.id}"]`);
    if(tradeCell){ tradeCell.textContent = fmtInt.format(Math.round(tradeValue)); }
    const valueCell = document.querySelector(`.planner-value[data-id="${item.id}"]`);
    if(valueCell){ valueCell.textContent = fmtInt.format(Math.round(simulatedQty * item.price)); }
  });

  let regionTwPct = 0, regionGlobalPct = 0, equityPct = 0, bondPct = 0;
  if(totalValue > 0){
    regionTwPct = byRegion.TW / totalValue * 100;
    regionGlobalPct = byRegion.Global / totalValue * 100;
    equityPct = byClass.Equity / totalValue * 100;
    bondPct = byClass.Bond / totalValue * 100;
  }

  if(regionSummary){
    regionSummary.textContent = `模擬後 台灣 ${regionTwPct.toFixed(1)}% / 全球 ${regionGlobalPct.toFixed(1)}% （目標 台灣 ${Math.round(context.regionTarget.tw)}% / 全球 ${Math.round(context.regionTarget.global)}%）`;
  }
  if(classSummary){
    classSummary.textContent = `模擬後 股票 ${equityPct.toFixed(1)}% / 債券 ${bondPct.toFixed(1)}% （目標 股票 ${Math.round(context.allocationTarget.equity)}% / 債券 ${Math.round(context.allocationTarget.bond)}%）`;
  }

  if(tradingSummary){
    tradingSummary.textContent = `預估總交易金額：${fmtInt.format(Math.round(totalTradeValue))} 元`;
  }

  const regionNote = $('#region-rebalance-note');
  if(regionNote){
    const regionExceeded = regionTwPct > context.regionTarget.tw + 5 || regionGlobalPct > context.regionTarget.global + 5;
    if(regionExceeded){
      regionNote.textContent = '⚠️ 模擬結果已讓台灣 / 全球超出目標 5%，建議再平衡。';
      regionNote.style.color = '#b91c1c';
    }else{
      regionNote.textContent = '✓ 模擬結果維持台灣 / 全球在目標範圍內。';
      regionNote.style.color = '#047857';
    }
  }

  const allocationNote = $('#allocation-rebalance-note');
  if(allocationNote){
    const allocationExceeded = equityPct > context.allocationTarget.equity + 5 || bondPct > context.allocationTarget.bond + 5;
    if(allocationExceeded){
      allocationNote.textContent = '⚠️ 模擬結果已讓股票 / 債券超出目標 5%，建議再平衡。';
      allocationNote.style.color = '#b91c1c';
    }else{
      allocationNote.textContent = '✓ 模擬結果維持股票 / 債券在目標範圍內。';
      allocationNote.style.color = '#047857';
    }
  }
}

  function openAllocationTargetDialog(){
    const dlg = $('#dlg-allocation-target');
    if(!dlg) return;
    const target = getAllocationTarget();
    $('#target-equity').value = Math.round(target.equity);
    $('#target-bond').value = Math.round(target.bond);
    dlg.returnValue = '';
    dlg.showModal();
  }

  function openRegionTargetDialog(){
    const dlg = $('#dlg-region-target');
    if(!dlg) return;
    const target = getRegionTarget();
    $('#target-tw').value = Math.round(target.tw);
    $('#target-global').value = Math.round(target.global);
    dlg.returnValue = '';
    dlg.showModal();
  }
