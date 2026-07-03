  // ========= Returns / 共用工具 =========
  // 從 returns.js 拆出（2026-05-17）
  // 包含：排序設定、格式化 helpers、分類、chart 共用工具、TWR/現金流計算
  // 以及 dialogs.js 使用的 txnScoreDashboardHintTimer 全域共用變數

  // ========= 報酬檢視 =========
  const returnSortDefaults = {
    category: 'asc',
    symbol: 'asc',
    name: 'asc',
    totalReturnPct: 'desc',
    allocation: 'desc',
    receivedDividend: 'desc',
    unrealizedPnl: 'desc',
    realizedPnl: 'desc',
    totalPnl: 'desc'
  };
  let returnSort = { key: 'category', dir: 'asc' };
  
  // 分類排序順序：台灣股票 → 美國股票 → 美國債券
  const categoryOrder = { '台灣股票': 1, '美國股票': 2, '美國債券': 3, '台灣債券': 4, '其他': 5 };

  function formatReturnWanLabel(value){
    const num = parseN(value);
    if(!Number.isFinite(num)) return '—';
    const wan = num / 10000;
    const absWan = Math.abs(wan);
    const digits = absWan > 0 && absWan < 10 ? 1 : 0;
    return `${wan.toLocaleString('zh-TW', {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    })}萬`;
  }

  function formatReturnWanNumber(value){
    const num = parseN(value);
    if(!Number.isFinite(num)) return '—';
    const wan = num / 10000;
    const absWan = Math.abs(wan);
    const digits = absWan > 0 && absWan < 10 ? 1 : 0;
    return wan.toLocaleString('zh-TW', {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    });
  }

  function getReturnSortValue(row, key){
    switch(key){
      case 'category': return categoryOrder[row.category] || 999;
      case 'symbol': return (row.stock.symbol || '').toString();
      case 'name': return (row.stock.name || '').toString();
      case 'totalReturnPct': return Number.isFinite(row.totalReturnPct) ? row.totalReturnPct : Number.NEGATIVE_INFINITY;
      case 'allocation': return Number.isFinite(row.allocationRatio) ? row.allocationRatio : Number.NEGATIVE_INFINITY;
      case 'receivedDividend': return Number.isFinite(row.receivedDividend) ? row.receivedDividend : Number.NEGATIVE_INFINITY;
      case 'unrealizedPnl': return Number.isFinite(row.unrealizedPnl) ? row.unrealizedPnl : Number.NEGATIVE_INFINITY;
      case 'realizedPnl': return Number.isFinite(row.realizedPnl) ? row.realizedPnl : Number.NEGATIVE_INFINITY;
      case 'totalPnl': return Number.isFinite(row.totalPnl) ? row.totalPnl : Number.NEGATIVE_INFINITY;
      default: return 0;
    }
  }

  function compareReturnRows(a,b){
    const { key, dir } = returnSort;
    const dirFactor = dir === 'asc' ? 1 : -1;
    
    // 先按分類排序（台灣股票 → 美國股票 → 美國債券）
    const catA = categoryOrder[a.category] || 999;
    const catB = categoryOrder[b.category] || 999;
    if(catA !== catB) return catA - catB;
    
    // 再按投資占比降序（目前持有優先）
    const allocA = a.isCurrentlyHeld ? (a.allocationRatio || 0) : -1;
    const allocB = b.isCurrentlyHeld ? (b.allocationRatio || 0) : -1;
    if(allocA !== allocB) return allocB - allocA;
    
    // 如果使用者點擊其他欄位排序，則按該欄位排序
    if(key !== 'category'){
      const va = getReturnSortValue(a, key);
      const vb = getReturnSortValue(b, key);

      if(typeof va === 'string' || typeof vb === 'string'){
        const sa = (va ?? '').toString();
        const sb = (vb ?? '').toString();
        const cmp = sa.localeCompare(sb, 'zh-Hant', {numeric:true, sensitivity:'base'});
        if(cmp !== 0) return cmp * dirFactor;
      } else {
        const aNum = Number(va);
        const bNum = Number(vb);
        const safeA = Number.isFinite(aNum) ? aNum : (dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        const safeB = Number.isFinite(bNum) ? bNum : (dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        if(safeA !== safeB) return safeA > safeB ? dirFactor : -dirFactor;
      }
    }
    
    // 最後按股票代號排序
    return (a.stock.symbol || '').localeCompare(b.stock.symbol || '', 'zh-Hant', {numeric:true, sensitivity:'base'});
  }

  function updateReturnSortIndicators(){
    $$('#tbl-return thead th.sortable').forEach(th=>{
      th.classList.remove('sort-asc','sort-desc');
      th.removeAttribute('aria-sort');
      if(th.dataset.sort === returnSort.key){
        th.classList.add(returnSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        th.setAttribute('aria-sort', returnSort.dir === 'asc' ? 'ascending' : 'descending');
      }
    });
  }

  // 計算每檔股票的已實現損益（含息）
  function computeRealizedPnlByStock(summary = calculatePortfolioSummary()){
    const realizedMap = {};
    const txList = computeTxnRealizedList();
    for(const t of txList){
      const instrumentKey = t.instrumentKey || findSummaryRowByStockId(t.stockId, summary)?.instrumentKey;
      if(!instrumentKey) continue;
      if(!realizedMap[instrumentKey]){
        realizedMap[instrumentKey] = 0;
      }
      // 已實現損益包含：賣出損益 + 股息收入
      if(t.type === 'sell' || t.type === 'dividend'){
        realizedMap[instrumentKey] += Number.isFinite(t.realized) ? t.realized : 0;
      }
    }
    return realizedMap;
  }

  // 計算每檔股票的歷史總投入成本（所有買入金額 + 手續費）
  function computeTotalCostByStock(summary = calculatePortfolioSummary()){
    const costMap = {};
    const stockIdToInstrumentKey = new Map();
    summary.rows.forEach(row => {
      row.stockIds.forEach(id => stockIdToInstrumentKey.set(id, row.instrumentKey));
    });
    for(const t of DB.txns){
      const instrumentKey = stockIdToInstrumentKey.get(t.stockId);
      if(!instrumentKey) continue;
      if(!costMap[instrumentKey]){
        costMap[instrumentKey] = 0;
      }
      if(t.type === 'buy'){
        const amount = parseN(t.price) * parseN(t.qty);
        costMap[instrumentKey] += amount;
      } else if(t.type === 'fee'){
        costMap[instrumentKey] += parseN(t.amount);
      }
    }
    for(const instrumentKey in costMap){
      costMap[instrumentKey] += estimateFee(costMap[instrumentKey]);
    }
    return costMap;
  }

  // 取得股票分類名稱
  function getStockCategory(stock){
    const market = stock.market || 'TW';
    const assetClass = stock.assetClass || 'Equity';
    if(assetClass === 'BondETF') return '債券ETF';
    if(assetClass === 'PassiveETF') return '被動式ETF';
    if(assetClass === 'ActiveETF') return '主動式ETF';
    if(assetClass === 'Bond') return '債券ETF'; // 舊值相容
    if(market === 'Global' && assetClass === 'Equity') return '美國股票';
    if(market === 'TW' && assetClass === 'Equity') return '個股';
    return '其他';
  }

  // 取得分類對應的 badge 樣式
  function getCategoryBadgeClass(category){
    switch(category){
      case '台灣股票': return 'badge blue';
      case '美國股票': return 'badge green';
      case '美國債券': return 'badge gray';
      case '台灣債券': return 'badge neutral';
      default: return 'badge neutral';
    }
  }

  let returnDailyChangeChart = null;
  let returnAssetTrendChart = null;
  let returnChartRange = 'two-weeks';
  let returnChartLastInput = { totalAssets: null, holdingsMarketValue: null, cashAvailable: null };
  let _highchartsLoaderPromise = null;

  const returnChartRangeConfig = {
    all: { label: '全部', type: 'all' },
    'half-year': { label: '近半年', type: 'months', value: 6 },
    'three-months': { label: '近三個月', type: 'months', value: 3 },
    quarter: { label: '近一季', type: 'days', value: 90 },
    'one-month': { label: '近一月', type: 'months', value: 1 },
    'two-weeks': { label: '近二周', type: 'days', value: 14 }
  };

  function getLocalDateOnly(date = new Date()){
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function parseLocalDateOnly(dateStr){
    if(!dateStr) return null;
    const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function subtractLocalMonths(date, months){
    const d = getLocalDateOnly(date);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() - months);
    const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, maxDay));
    return d;
  }

  function getReturnChartRangeStart(rangeKey){
    const cfg = returnChartRangeConfig[rangeKey] || returnChartRangeConfig.all;
    if(cfg.type === 'all') return null;
    const today = getLocalDateOnly();
    if(cfg.type === 'months') return subtractLocalMonths(today, cfg.value);
    if(cfg.type === 'days'){
      const start = getLocalDateOnly(today);
      start.setDate(start.getDate() - cfg.value);
      return start;
    }
    return null;
  }

  function getReturnChartRangeLabel(rangeKey){
    return (returnChartRangeConfig[rangeKey] || returnChartRangeConfig.all).label;
  }

  function filterReturnChartDateData(data, rangeKey, getDate){
    const list = Array.isArray(data) ? data : [];
    const start = getReturnChartRangeStart(rangeKey);
    if(!start) return list.slice();
    return list.filter(item => {
      const dateObj = parseLocalDateOnly(getDate(item));
      return dateObj && dateObj >= start;
    });
  }

  function syncReturnRangeButtons(){
    $$('.return-range-btn').forEach(btn => {
      const active = btn.dataset.returnRange === returnChartRange;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  /** file:// 或 CDN 被擋時，head 的 Highcharts 可能未注入；改以備援網址動態載入 */
  function loadHighchartsIfNeeded(){
    if(typeof Highcharts !== 'undefined'){
      return week1EnsureHighchartsTreemapModule();
    }
    if(_highchartsLoaderPromise) return _highchartsLoaderPromise.then(() => week1EnsureHighchartsTreemapModule());
    _highchartsLoaderPromise = new Promise((resolve, reject) => {
      const urls = [
        'https://cdn.jsdelivr.net/npm/highcharts@11/highcharts.js',
        'https://unpkg.com/highcharts@11/highcharts.js',
        'https://code.highcharts.com/highcharts.js'
      ];
      let idx = 0;
      const tryNext = () => {
        if(typeof Highcharts !== 'undefined'){
          resolve();
          return;
        }
        if(idx >= urls.length){
          _highchartsLoaderPromise = null;
          reject(new Error('Highcharts unavailable'));
          return;
        }
        const s = document.createElement('script');
        s.src = urls[idx++];
        s.async = false;
        s.onload = () => {
          if(typeof Highcharts !== 'undefined') resolve();
          else tryNext();
        };
        s.onerror = () => tryNext();
        (document.head || document.documentElement).appendChild(s);
      };
      tryNext();
    });
    return _highchartsLoaderPromise.then(() => week1EnsureHighchartsTreemapModule());
  }

  function destroyChartInstance(chart){
    if(!chart) return null;
    try{ chart.destroy(); }catch(e){}
    return null;
  }

  function setChartSurfaceState({ msgEl, chartDiv, message = '', showMessage = false, hideChart = false } = {}){
    if(msgEl){
      msgEl.style.display = showMessage ? '' : 'none';
      msgEl.textContent = showMessage ? message : '';
    }
    if(chartDiv){
      chartDiv.style.display = hideChart ? 'none' : '';
    }
  }

  async function ensureChartRuntime({ msgEl, chartDiv, loadingText = '載入圖表中…' } = {}){
    if(typeof Highcharts === 'undefined'){
      setChartSurfaceState({ msgEl, chartDiv, message: loadingText, showMessage: true, hideChart: true });
    }
    try{
      await loadHighchartsIfNeeded();
      setChartSurfaceState({ msgEl, chartDiv, showMessage: false, hideChart: false });
      return typeof Highcharts !== 'undefined';
    }catch(e){
      setChartSurfaceState({ msgEl, chartDiv, showMessage: false, hideChart: false });
      return typeof Highcharts !== 'undefined';
    }
  }

  function buildCashFlowEvents(){
    const events = [];
    const init = DB.meta && DB.meta.initialCapital;
    if(init && init.time){
      events.push({ date: String(init.time).slice(0, 10), amount: parseN(init.amount), type: 'initial' });
    }
    for(const acct of DB.accounts || []){
      for(const h of acct.history || []){
        if(h && (h.type === 'deposit' || h.type === 'withdraw')){
          const ds = h.time ? String(h.time).slice(0, 10) : '';
          if(!ds) continue;
          events.push({ date: ds, amount: parseN(h.amount), type: h.type });
        }
      }
    }
    const typeOrder = { initial: 0, deposit: 1, withdraw: 2 };
    events.sort((a, b) => {
      const c = a.date.localeCompare(b.date);
      if(c !== 0) return c;
      return (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
    });
    return events;
  }

  function getTotalAssetOnDate(dateStr){
    const sorted = getRenderableSnapshots();
    let best = null;
    for(const s of sorted){
      if(s.date <= dateStr) best = s;
    }
    return best != null ? parseN(best.total) : null;
  }

  function calcTWR(asOfDateStr){
    const asOf = asOfDateStr || new Date().toISOString().slice(0, 10);
    const events = buildCashFlowEvents();
    if(events.length < 2) return { twr: null, periods: [] };
    if(asOf < events[0].date) return { twr: null, periods: [] };

    let cumulativeProduct = 1;
    const periods = [];

    for(let i = 0; i < events.length; i++){
      const startDate = events[i].date;
      if(startDate > asOf) break;

      const endDateRaw = i + 1 < events.length ? events[i + 1].date : asOf;
      const endDate = endDateRaw > asOf ? asOf : endDateRaw;
      if(endDate < startDate) continue;

      const startAsset = getTotalAssetOnDate(startDate);
      const endAsset = getTotalAssetOnDate(endDate);
      if(startAsset === null || endAsset === null) continue;

      const cashFlowIn = i > 0 ? parseN(events[i].amount) : 0;
      const adjustedStart = startAsset + cashFlowIn;
      if(adjustedStart === 0) continue;

      const periodReturn = (endAsset - adjustedStart) / adjustedStart;
      if(!Number.isFinite(periodReturn)) continue;

      cumulativeProduct *= (1 + periodReturn);
      periods.push({
        startDate,
        endDate,
        startAsset: adjustedStart,
        endAsset,
        periodReturn,
        cumulativeReturn: cumulativeProduct - 1
      });
    }

    if(periods.length === 0 || !Number.isFinite(cumulativeProduct)) return { twr: null, periods: [] };
    return { twr: cumulativeProduct - 1, periods };
  }

  function calc0050BaselineReturn(){
    const stock0050 = DB.stocks.find(s => s.symbol === '0050');
    if(!stock0050) return null;
    const txns = DB.txns
      .filter(t => t.stockId === stock0050.id && t.type === 'buy')
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    if(!txns.length) return null;
    const firstBuy = txns[0];
    const currentPrice = parseN(stock0050.price);
    const buyPrice = parseN(firstBuy.price);
    if(!buyPrice || !currentPrice) return null;
    return (currentPrice - buyPrice) / buyPrice;
  }

  function buildBaselinePctArray(snapshotDates, baselineFrac){
    if(baselineFrac == null || !Number.isFinite(baselineFrac) || !snapshotDates.length){
      return snapshotDates.map(() => null);
    }
    const t0 = Date.parse(snapshotDates[0] + 'T12:00:00');
    const t1 = Date.parse(snapshotDates[snapshotDates.length - 1] + 'T12:00:00');
    if(!Number.isFinite(t0) || !Number.isFinite(t1) || Math.abs(t1 - t0) < 1){
      return snapshotDates.map(() => baselineFrac * 100);
    }
    return snapshotDates.map(d => {
      const t = Date.parse(d + 'T12:00:00');
      const frac = (t - t0) / (t1 - t0);
      return frac * baselineFrac * 100;
    });
  }

  let txnScoreDashboardHintTimer = null;
