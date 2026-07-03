  // ========= Holdings 表格（分層 / 策略標籤，純 UI） =========
  const DEFAULT_TIERS = {
    '0050':   { tier: 'core',      strategy: 'hold-for-dividend' },
    '00878':  { tier: 'core',      strategy: 'hold-for-dividend' },
    '00646':  { tier: 'satellite', strategy: 'tradeable' },
    '00662':  { tier: 'flex',      strategy: 'tradeable' },
    '00687B': { tier: 'core',      strategy: 'hold-for-dividend' },
    '00772B': { tier: 'core',      strategy: 'hold-for-dividend' },
  };
  const holdingsTierOrder = { core: 1, satellite: 2, flex: 3 };
  const holdingsStrategyOrder = { 'hold-for-dividend': 1, tradeable: 2 };
  const holdingsTierText = { core: '核心', satellite: '衛星', flex: '偵查' };
  let activeTierFilter = 'all';
  let labelDialogStockId = null;

  function normalizeTierValue(raw){
    if(raw === 'bond') return 'core';
    if(raw === 'watch') return 'flex';
    return ['core', 'satellite', 'flex'].includes(raw) ? raw : 'flex';
  }

  function getTierDisplayText(raw){
    const tier = normalizeTierValue(raw);
    return holdingsTierText[tier] || tier;
  }

  function ensureStockLabelsMeta(){
    if(!DB.meta) DB.meta = {};
    if(!DB.meta.stockLabels) DB.meta.stockLabels = {};
  }

  function getStockLabel(stockId){
    const stock = DB.stocks.find(s => s.id === stockId);
    const symbol = stock?.symbol || '';
    const defaults = DEFAULT_TIERS[symbol] || { tier: 'flex', strategy: 'tradeable' };

    // 優先從 stock 物件讀取（新格式）
    if(stock && (stock.tier || stock.strategy || stock.stopLoss != null || stock.stopProfit != null)){
      return {
        tier: normalizeTierValue(stock.tier || defaults.tier),
        strategy: stock.strategy || defaults.strategy || 'tradeable',
        stopLoss: stock.stopLoss != null && Number.isFinite(Number(stock.stopLoss)) ? Number(stock.stopLoss) : null,
        stopProfit: stock.stopProfit != null && Number.isFinite(Number(stock.stopProfit)) ? Number(stock.stopProfit) : null,
      };
    }

    // Fallback：舊格式 meta.stockLabels（遷移前相容）
    const labelKey = getStockLabelKey(stockId);
    const saved = DB.meta?.stockLabels?.[labelKey] || DB.meta?.stockLabels?.[stockId];
    const merged = { ...defaults, ...(saved || {}) };
    return {
      tier: normalizeTierValue(merged.tier),
      strategy: merged.strategy || 'tradeable',
      stopLoss: merged.stopLoss != null && Number.isFinite(Number(merged.stopLoss)) ? Number(merged.stopLoss) : null,
      stopProfit: merged.stopProfit != null && Number.isFinite(Number(merged.stopProfit)) ? Number(merged.stopProfit) : null,
    };
  }

  function saveStockLabel(stockId, labelObj){
    ensureStockLabelsMeta();
    const stock = DB.stocks.find(s => s.id === stockId);
    if(stock){
      stock.tier = normalizeTierValue(labelObj.tier || '');
      stock.strategy = labelObj.strategy || '';
      stock.stopLoss = labelObj.stopLoss ?? null;
      stock.stopProfit = labelObj.stopProfit ?? null;
    }
    // 同步寫入舊格式（過渡期相容）
    const labelKey = getStockLabelKey(stockId);
    DB.meta.stockLabels[labelKey] = {
      tier: normalizeTierValue(labelObj.tier),
      strategy: labelObj.strategy,
      stopLoss: labelObj.stopLoss,
      stopProfit: labelObj.stopProfit,
    };
  }

  function parseStopLossPercentInput(val){
    const t = String(val ?? '').trim();
    if(t === '') return null;
    const raw = parseFloat(t);
    if(!Number.isFinite(raw)) return null;
    const pct = raw > 0 ? -raw : raw;
    return pct / 100;
  }

  function parseStopProfitPercentInput(val){
    const t = String(val ?? '').trim();
    if(t === '') return null;
    const raw = parseFloat(t);
    if(!Number.isFinite(raw) || raw <= 0) return null;
    return raw / 100;
  }

  const indicatorCache = {}; // symbol -> { pct52w, ma200Bias, ma5, ma10, ma20, currentPrice, updatedAt }
  const INDUSTRY_EXPOSURE_COLUMNS = [
    { key: 'advancedPackaging', label: '先進製程與封裝', isKey: true },
    { key: 'robotics', label: '機器人', isKey: true },
    { key: 'powerManagement', label: '重電與電源管理', isKey: true },
    { key: 'cpoNetwork', label: 'CPO與共同封裝光學', isKey: true },
    { key: 'pcbAbf', label: 'PCB與ABF載板', isKey: true },
    { key: 'semiconductorEquipment', label: '半導體設備', isKey: true },
    { key: 'memory', label: '記憶體', isKey: true },
    { key: 'leoSatellite', label: '低軌衛星', isKey: true },
    { key: 'other', label: '其他產業', isKey: false },
  ];
  const INDUSTRY_EXPOSURE_DATA = {
    '0050': {
      advancedPackaging: 68.95,
      robotics: 6.02,
      powerManagement: 4.52,
      cpoNetwork: 2.89,
      pcbAbf: 2.86,
      semiconductorEquipment: 0,
      memory: 0,
      leoSatellite: 0,
      other: 14.76,
    },
    '00646': {
      advancedPackaging: 8.72,
      robotics: 5.87,
      powerManagement: 2.42,
      cpoNetwork: 3.18,
      pcbAbf: 0,
      semiconductorEquipment: 0,
      memory: 0,
      leoSatellite: 0,
      other: 69.82,
    },
    '00878': {
      advancedPackaging: 25.50,
      robotics: 6.68,
      powerManagement: 0.92,
      cpoNetwork: 6.06,
      pcbAbf: 3.18,
      semiconductorEquipment: 0,
      memory: 0,
      leoSatellite: 0,
      other: 58.65,
    },
    '00910': {
      advancedPackaging: 0,
      robotics: 0,
      powerManagement: 0,
      cpoNetwork: 0,
      pcbAbf: 0,
      semiconductorEquipment: 0,
      memory: 0,
      leoSatellite: 100,
      other: 0,
    },
    '2330': {
      advancedPackaging: 100,
      robotics: 0,
      powerManagement: 0,
      cpoNetwork: 0,
      pcbAbf: 0,
      semiconductorEquipment: 0,
      memory: 0,
      leoSatellite: 0,
      other: 0,
    },
    '00403A': {
      advancedPackaging: 30.31,
      robotics: 11.09,
      powerManagement: 2.42,
      cpoNetwork: 3.43,
      pcbAbf: 14.82,
      semiconductorEquipment: 4.79,
      memory: 5.17,
      leoSatellite: 0.03,
      other: 27.94,
    },
    '00733': {
      advancedPackaging: 18.04,
      robotics: 8.82,
      powerManagement: 3.59,
      cpoNetwork: 0.67,
      pcbAbf: 22.87,
      semiconductorEquipment: 18.49,
      memory: 3.25,
      leoSatellite: 1.43,
      other: 21.40,
    },
    '00981A': {
      advancedPackaging: 27.46,
      robotics: 19.74,
      powerManagement: 5.30,
      cpoNetwork: 6.07,
      pcbAbf: 22.78,
      semiconductorEquipment: 9.08,
      memory: 0.57,
      leoSatellite: 0,
      other: 9.04,
    },
    '00988A': {
      advancedPackaging: 16.67,
      robotics: 1.51,
      powerManagement: 11.21,
      cpoNetwork: 20.60,
      pcbAbf: 17.93,
      semiconductorEquipment: 8.15,
      memory: 13.92,
      leoSatellite: 0,
      other: 10.01,
    },
    '00401A': {
      advancedPackaging: 26.65,
      robotics: 10.14,
      powerManagement: 6.75,
      cpoNetwork: 3.12,
      pcbAbf: 11.60,
      semiconductorEquipment: 13.59,
      memory: 0.69,
      leoSatellite: 3.89,
      other: 16.63,
    },
    '00983A': {
      advancedPackaging: 13.92,
      robotics: 11.54,
      powerManagement: 0,
      cpoNetwork: 1.60,
      pcbAbf: 0,
      semiconductorEquipment: 3.95,
      memory: 0,
      leoSatellite: 0,
      other: 70.21,
    },
    '00941': {
      advancedPackaging: 0,
      robotics: 0,
      powerManagement: 0.34,
      cpoNetwork: 0,
      pcbAbf: 0.79,
      semiconductorEquipment: 83.3,
      memory: 0,
      leoSatellite: 0,
      other: 15.57,
      otherBreakdown: {
        '化學與稀有金屬': 15.57,
      },
    },
  };

  function escapeIndustryHtml(value) {
    return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatIndustryPct(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return `${num.toFixed(1)}%`;
  }

  function getIndustryCellClass(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 'industry-cell-empty';
    if (num >= 50) return 'industry-cell-high';
    if (num >= 20) return 'industry-cell-mid';
    return 'industry-cell-low';
  }

  function buildOtherIndustryTitle(symbol, exposure) {
    const otherValue = Number(exposure?.other);
    if (!Number.isFinite(otherValue) || otherValue <= 0) return '其他產業：無';
    const breakdown = exposure?.otherBreakdown || {};
    const entries = Object.entries(breakdown)
      .map(([label, value]) => [label, Number(value)])
      .filter(([, value]) => Number.isFinite(value) && value > 0)
      .sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      return `${symbol} 其他產業 ${formatIndustryPct(otherValue)}\n待補其他產業拆解`;
    }
    return [
      `${symbol} 其他產業 ${formatIndustryPct(otherValue)}`,
      ...entries.map(([label, value]) => `${label}：${formatIndustryPct(value)}`)
    ].join('\n');
  }

  function getIndustryExposureForSymbol(symbol) {
    const raw = String(symbol || '').trim().toUpperCase();
    const normalized = raw.replace(/\.TW$/, '');
    return INDUSTRY_EXPOSURE_DATA[raw] || INDUSTRY_EXPOSURE_DATA[normalized] || null;
  }

  function buildIndustryExposureViewModel(summary = calculatePortfolioSummary()) {
    const rows = computeStockMetrics(summary).filter(row => row.qty > 0);
    const totalMarketValue = rows.reduce((sum, row) => (
      sum + (Number.isFinite(Number(row.marketValue)) ? Number(row.marketValue) : 0)
    ), 0);
    const totals = Object.fromEntries(INDUSTRY_EXPOSURE_COLUMNS.map(col => [col.key, 0]));
    let missingCount = 0;
    let completedCount = 0;

    const matrixRows = rows.map(row => {
      const symbol = String(row.stock.symbol || row.stock.id || '').trim().toUpperCase();
      const exposure = getIndustryExposureForSymbol(symbol);
      const hasExposure = !!exposure && INDUSTRY_EXPOSURE_COLUMNS.some(col => Number(exposure[col.key]) > 0);
      const marketValue = Number.isFinite(Number(row.marketValue)) ? Number(row.marketValue) : 0;
      let exposureTotal = 0;

      if (hasExposure) {
        completedCount += 1;
        for (const col of INDUSTRY_EXPOSURE_COLUMNS) {
          const pct = Number(exposure[col.key]);
          if (Number.isFinite(pct) && pct > 0) {
            totals[col.key] += marketValue * pct / 100;
            exposureTotal += pct;
          }
        }
      } else {
        missingCount += 1;
      }

      return { row, symbol, exposure, hasExposure, exposureTotal };
    });

    const totalPctRows = INDUSTRY_EXPOSURE_COLUMNS
      .map(col => ({
        ...col,
        value: totalMarketValue > 0 ? totals[col.key] / totalMarketValue * 100 : 0
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);

    return {
      matrixRows,
      totalPctRows,
      missingCount,
      completedCount,
      totalMarketValue,
    };
  }

  function renderIndustryExposure(summary = calculatePortfolioSummary()) {
    const panel = $('#industry-exposure-panel');
    const summaryEl = $('#industry-exposure-summary');
    if (!panel || !summaryEl) return;

    const vm = buildIndustryExposureViewModel(summary);
    const summaryRows = vm.totalPctRows.filter(item => item.key !== 'other');
    const topText = summaryRows.length
      ? summaryRows.map(item => `${item.label} ${formatIndustryPct(item.value)}`).join('｜')
      : '尚無產業資料';
    const missingText = vm.missingCount > 0 ? `｜待補 ${vm.missingCount} 檔` : '';
    summaryEl.textContent = `關鍵產業：${topText}${missingText}`;

    if (vm.matrixRows.length === 0) {
      panel.innerHTML = '<div class="industry-note">目前沒有持股可盤點。</div>';
      return;
    }

    const overviewRows = vm.totalPctRows.filter(item => item.key !== 'other');
    const overviewHtml = overviewRows.map(item => (
      `<span class="industry-overview-chip">${escapeIndustryHtml(item.label)} ${formatIndustryPct(item.value)}</span>`
    )).join('') || '<span class="industry-overview-chip">尚無已填資料</span>';

    const headHtml = `
      <tr>
        <th class="industry-stock-cell">標的</th>
        ${INDUSTRY_EXPOSURE_COLUMNS.map(col => `<th class="${col.isKey ? 'key-industry' : ''}">${escapeIndustryHtml(col.label)}</th>`).join('')}
        <th>狀態</th>
      </tr>`;

    const bodyHtml = vm.matrixRows.map(item => {
      const stock = item.row.stock;
      const cells = INDUSTRY_EXPOSURE_COLUMNS.map(col => {
        const value = item.hasExposure ? Number(item.exposure[col.key]) : null;
        const hasValue = Number.isFinite(value) && value > 0;
        const title = item.hasExposure && col.key === 'other'
          ? ` title="${escapeAttr(buildOtherIndustryTitle(item.symbol, item.exposure))}"`
          : '';
        return `<td class="${getIndustryCellClass(value)}"${title}>${hasValue ? formatIndustryPct(value) : '—'}</td>`;
      }).join('');
      const status = item.hasExposure
        ? `<span class="industry-status ok">已填 ${formatIndustryPct(item.exposureTotal)}</span>`
        : '<span class="industry-status missing">待補資料</span>';
      return `
        <tr class="${item.hasExposure ? '' : 'industry-missing-row'}">
          <td class="industry-stock-cell">
            <div class="industry-stock-symbol">${escapeIndustryHtml(item.symbol)}</div>
            <div class="industry-stock-name">${escapeIndustryHtml(stock.name || '')}</div>
          </td>
          ${cells}
          <td>${status}</td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
      <div class="industry-overview-row">${overviewHtml}</div>
      <div class="industry-note">資料由手動維護，不連網。整體曝險以目前持股市值加權計算；橘色列代表這檔持股尚未補產業比例。</div>
      <div class="industry-matrix-wrap">
        <table class="industry-matrix">
          <colgroup>
            <col class="industry-stock-col">
            ${INDUSTRY_EXPOSURE_COLUMNS.map(() => '<col class="industry-data-col">').join('')}
            <col class="industry-status-col">
          </colgroup>
          <thead>${headHtml}</thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>`;
  }

  function compute52wPercentile(history, currentPrice) {
    if (!history || history.length < 20) return null;
    const closes = history.map(d => d.close).filter(Number.isFinite);
    if (closes.length < 20) return null;
    const high = Math.max(...closes);
    const low = Math.min(...closes);
    if (high === low) return 0.5;
    return (currentPrice - low) / (high - low);
  }

  function computeMA200Bias(history, currentPrice) {
    if (!history || history.length < 200) return null;
    const last200 = history.slice(-200).map(d => d.close).filter(Number.isFinite);
    if (last200.length < 200) return null;
    const ma = last200.reduce((a, b) => a + b, 0) / last200.length;
    if (ma <= 0) return null;
    return (currentPrice - ma) / ma;
  }

  function computeMovingAverage(history, days) {
    if (!history || history.length < days) return null;
    const closes = history.map(d => d.close).filter(Number.isFinite);
    if (closes.length < days) return null;
    const recent = closes.slice(-days);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  function deriveIndicatorSignal(pct52w, ma200Bias) {
    if (!Number.isFinite(pct52w) || !Number.isFinite(ma200Bias)) {
      return { label: '資料不足', cls: 'wk1-signal-missing', note: '等資料補齊' };
    }
    const pct = pct52w * 100;
    const bias = ma200Bias * 100;
    if (pct < 20 && bias < -10) {
      return { label: '偏低估', cls: 'wk1-signal-add', note: '分批小買，不破低再加' };
    }
    if (pct > 80 && bias > 15) {
      return { label: '偏過熱', cls: 'wk1-signal-reduce', note: '分批減碼，暫不追價' };
    }
    if (pct > 80 && bias > 8 && bias <= 15) {
      return { label: '高檔偏熱', cls: 'wk1-signal-warm', note: '等回檔再接，不追高' };
    }
    if (bias > 15 && pct >= 70 && pct <= 80) {
      return { label: '均線過熱', cls: 'wk1-signal-warm', note: '先降倉位，觀察收斂' };
    }
    if (pct < 20 && bias >= -10 && bias < 0) {
      return { label: '低檔偏冷', cls: 'wk1-signal-cool', note: '小量試單，站回再加' };
    }
    if (bias < -10 && pct >= 20 && pct <= 35) {
      return { label: '均線偏冷', cls: 'wk1-signal-cool', note: '等止跌確認，再分批加' };
    }
    if (pct < 35 && bias < 0) {
      return { label: '偏冷', cls: 'wk1-signal-cool', note: '先觀察止跌，再小買' };
    }
    if (pct > 70 && bias > 8) {
      return { label: '偏熱', cls: 'wk1-signal-warm', note: '不追高，逢高減碼' };
    }
    return { label: '中性', cls: 'wk1-signal-neutral', note: '續抱觀察，按計畫走' };
  }

  function formatIndicatorPrice(value) {
    return Number.isFinite(Number(value)) ? fmt2.format(Number(value)) : '—';
  }

  function deriveTechnicalPosition(ind) {
    const currentPrice = Number(ind?.currentPrice);
    const ma5 = Number(ind?.ma5);
    const ma10 = Number(ind?.ma10);
    const ma20 = Number(ind?.ma20);
    const historyDays = Number(ind?.historyDays);
    const latestDate = String(ind?.historyLatestDate || '').trim();
    const hasPrice = Number.isFinite(currentPrice) && currentPrice > 0;
    const title = [
      `現價 ${formatIndicatorPrice(currentPrice)}`,
      `MA5 ${formatIndicatorPrice(ma5)}`,
      `MA10 ${formatIndicatorPrice(ma10)}`,
      `月線 ${formatIndicatorPrice(ma20)}`,
      Number.isFinite(historyDays) ? `歷史收盤 ${historyDays} 筆${latestDate ? `，最新 ${latestDate}` : ''}` : ''
    ].join('\n');

    if (!hasPrice) {
      return { label: '資料不足', cls: 'wk1-signal-missing', title };
    }
    if (!Number.isFinite(ma20)) {
      return {
        label: '資料不足',
        cls: 'wk1-signal-missing',
        title: `${title}\n至少需要 20 筆歷史收盤價，才產生可用交易訊號。`
      };
    }
    if (Number.isFinite(ma20) && currentPrice < ma20) {
      return { label: '跌破月線', cls: 'wk1-signal-reduce', title };
    }
    if (Number.isFinite(ma10) && currentPrice < ma10) {
      return { label: '跌破10日', cls: 'wk1-signal-warm', title };
    }
    if (Number.isFinite(ma5) && currentPrice < ma5) {
      return { label: '低於5日', cls: 'wk1-signal-warm', title };
    }
    if (Number.isFinite(ma5) && Number.isFinite(ma10) && Number.isFinite(ma20)) {
      return { label: '站上5/10/月', cls: 'wk1-signal-add', title };
    }
    return { label: '站上均線', cls: 'wk1-signal-neutral', title };
  }

  function deriveTradeStrategyAction(tierKey, tech) {
    const normalizedTier = normalizeTierValue(tierKey);
    const isCore = normalizedTier === 'core';
    const techLabel = String(tech?.label || '');
    const layerName = isCore ? '核心層' : '衛星/偵查層';
    const missing = {
      label: '資料不足',
      cls: 'trade-action-missing',
      title: '技術資料不足，先不調整交易動作。'
    };
    const meanings = {
      '站上5/10/月': '綠燈：趨勢轉強，動能回歸。',
      '站上均線': '綠燈：趨勢轉強，動能回歸。',
      '跌破10日': '黃燈：短線轉弱，漲多回測。',
      '低於5日': '黃燈：急跌中，短線恐慌。',
      '跌破月線': '紅燈：中期走弱，趨勢反轉。'
    };
    const build = (label, cls, action) => ({
      label,
      cls,
      title: `${meanings[techLabel] || '技術位置尚未明確。'}\n${layerName}：${action}`
    });

    if (!techLabel || techLabel === '資料不足') return missing;
    if (techLabel === '站上5/10/月' || techLabel === '站上均線') {
      return isCore
        ? build('不追高，靜靜享受複利', 'trade-action-green', '不追高，靜靜享受複利。')
        : build('可評估升級，持續奈米建倉', 'trade-action-green', '好兵晉升：可評估從偵查升衛星。持續奈米建倉。');
    }
    if (techLabel === '跌破10日') {
      return isCore
        ? build('無視波動，等美股跌時加碼', 'trade-action-yellow', '無視波動，等美股跌時大膽加碼。')
        : build('停止加碼，觀察是否止跌', 'trade-action-yellow', '暫停奈米打卡，觀察是否止跌。');
    }
    if (techLabel === '低於5日') {
      return isCore
        ? build('分批接貨，符合買黑可進場', 'trade-action-yellow', '若符合「買黑」原則，可進場。')
        : build('觀望，不接飛刀，等站回5日', 'trade-action-yellow', '不要接飛刀，等站回 5 日線再說。');
    }
    if (techLabel === '跌破月線') {
      return isCore
        ? build('L2/L3加碼點，撿大便宜', 'trade-action-red', '這是撿大便宜的好時機。')
        : build('保命停損，準備-10%出場', 'trade-action-red', '隨時準備執行 -10% 出場。降級處理。');
    }
    return missing;
  }

  function getIndicatorRefreshSymbols(options = {}) {
    if (Array.isArray(options.symbols) && options.symbols.length) {
      return Array.from(new Set(options.symbols.map(s => String(s || '').trim().toUpperCase()).filter(Boolean)));
    }
    try {
      const summary = calculatePortfolioSummary(true);
      const heldSymbols = (summary.heldRows || []).map(row => row.stock?.symbol);
      const list = Array.from(new Set(heldSymbols.map(s => String(s || '').trim().toUpperCase()).filter(Boolean)));
      if (list.length) return list;
    } catch (e) { /* fallback below */ }
    return Array.from(new Set(DB.stocks.map(s => String(s.symbol || s.id || '').trim().toUpperCase()).filter(Boolean)));
  }

  async function refreshIndicatorsForAll(options = {}) {
    try {
      const symbols = getIndicatorRefreshSymbols(options);
      const forceHistory = !!(options.force || options.forceHistory);
      for (const rawSym of symbols) {
        const sym = String(rawSym).trim().toUpperCase();
        if (!sym) continue;
        const history = await fetchPriceHistory(sym, forceHistory);
        const stock = DB.stocks.find(s => String(s.symbol || s.id).trim().toUpperCase() === sym);
        if (!Array.isArray(history) || history.length === 0) {
          const currentPrice = parseN(stock?.price) || parseN(stock?.currentPrice);
          indicatorCache[sym] = {
            pct52w: null,
            ma200Bias: null,
            ma5: null,
            ma10: null,
            ma20: null,
            currentPrice,
            historyDays: 0,
            historyLatestDate: '',
            updatedAt: Date.now()
          };
          continue;
        }
        const currentPrice = parseN(stock?.price) || parseN(stock?.currentPrice) || parseN(history[history.length - 1]?.close);
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;
        indicatorCache[sym] = {
          pct52w: compute52wPercentile(history, currentPrice),
          ma200Bias: computeMA200Bias(history, currentPrice),
          ma5: computeMovingAverage(history, 5),
          ma10: computeMovingAverage(history, 10),
          ma20: computeMovingAverage(history, 20),
          currentPrice,
          historyDays: history.length,
          historyLatestDate: history[history.length - 1]?.date || '',
          updatedAt: Date.now()
        };
      }
      if (typeof renderHoldings === 'function') renderHoldings();
    } catch (e) {
      console.warn('[indicator] refresh failed:', e);
    }
  }

  const holdingsSortDefaults = {
    tier: 'asc',
    symbol: 'asc',
    qty: 'desc',
    avgCost: 'desc',
    price: 'desc',
    marketValue: 'desc',
    allocation: 'desc',
    pct52w: 'desc',
    ma200Bias: 'desc',
    unrealized: 'desc',
    unrealizedPct: 'desc',
    dividends: 'desc',
    totalPnl: 'desc',
    cycleMonthlyReturnPct: 'desc',
    totalReturnPct: 'desc',
    strategy: 'asc'
  };
  let holdingsSort = { key: 'tier', dir: 'asc' };

  function getHoldingsSortValue(row, key){
    const label = row._label || getStockLabel(row.stock.id);
    const pos = row.pos;
    const costB = pos?.costBasis ?? 0;
    const unreal = pos?.unrealized;
    const unrealPct = costB > 0 && Number.isFinite(unreal) ? (unreal / costB * 100) : null;
    const totPnl = pos?.totalPnl;
    const totPct = costB > 0 && Number.isFinite(totPnl) ? (totPnl / costB * 100) : null;
    switch(key){
      case 'tier': return holdingsTierOrder[label.tier] || 99;
      case 'symbol': return (row.stock.symbol || '').toString();
      case 'qty': return row.qty;
      case 'avgCost': return row.avgCost;
      case 'price': return row.currentPrice;
      case 'marketValue': return row.marketValue;
      case 'allocation': return Number.isFinite(row.allocationRatio) ? row.allocationRatio : Number.NEGATIVE_INFINITY;
      case 'pct52w': {
        const sym = String(row.stock.symbol || '').trim().toUpperCase();
        const value = indicatorCache[sym]?.pct52w;
        return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
      }
      case 'ma200Bias': {
        const sym = String(row.stock.symbol || '').trim().toUpperCase();
        const value = indicatorCache[sym]?.ma200Bias;
        return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
      }
      case 'unrealized': return Number.isFinite(unreal) ? unreal : Number.NEGATIVE_INFINITY;
      case 'unrealizedPct': return Number.isFinite(unrealPct) ? unrealPct : Number.NEGATIVE_INFINITY;
      case 'dividends': return row.dividends;
      case 'totalPnl': return Number.isFinite(totPnl) ? totPnl : Number.NEGATIVE_INFINITY;
      case 'cycleMonthlyReturnPct': return Number.isFinite(row.cycleMonthlyReturnPct) ? row.cycleMonthlyReturnPct : Number.NEGATIVE_INFINITY;
      case 'totalReturnPct': return Number.isFinite(totPct) ? totPct : Number.NEGATIVE_INFINITY;
      case 'strategy': return holdingsStrategyOrder[label.strategy] || 99;
      default: return 0;
    }
  }

  function compareHoldingsRows(a,b){
    const {key, dir} = holdingsSort;
    const dirFactor = dir === 'asc' ? 1 : -1;
    const va = getHoldingsSortValue(a, key);
    const vb = getHoldingsSortValue(b, key);

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

    if(key === 'tier'){
      const mvA = Number.isFinite(Number(a.marketValue)) ? Number(a.marketValue) : Number.NEGATIVE_INFINITY;
      const mvB = Number.isFinite(Number(b.marketValue)) ? Number(b.marketValue) : Number.NEGATIVE_INFINITY;
      if(mvA !== mvB) return mvB - mvA;
    }

    return (a.stock.symbol || '').localeCompare(b.stock.symbol || '', 'zh-Hant', {numeric:true, sensitivity:'base'});
  }

  function updateHoldingsSortIndicators(){
    $$('#tbl-holdings thead th.sortable').forEach(th=>{
      th.classList.remove('sort-asc','sort-desc');
      th.removeAttribute('aria-sort');
      if(th.dataset.sort === holdingsSort.key){
        th.classList.add(holdingsSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        th.setAttribute('aria-sort', holdingsSort.dir === 'asc' ? 'ascending' : 'descending');
      }
    });
  }

  function computeStockMetrics(summary = calculatePortfolioSummary()){
    return summary.rows.map(row => ({
      instrumentKey: row.instrumentKey,
      stock: row.stock,
      stockIds: row.stockIds,
      pos: {
        qty: row.qty,
        avgCost: row.avgCost,
        costBasis: row.costBasis,
        price: row.price,
        marketValue: row.marketValue,
        unrealized: row.unrealized,
        dividends: row.dividends,
        totalPnl: row.totalPnl
      },
      currentPrice: row.currentPrice,
      marketValue: row.marketValue,
      allocationRatio: summary.holdingsMarketValue > 0 && Number.isFinite(Number(row.marketValue)) ? Number(row.marketValue) / summary.holdingsMarketValue : null,
      stockPnlWithFees: row.stockPnlWithFees,
      stockReturnPct: row.stockReturnPct,
      totalPnlWithFees: row.totalPnlWithFees,
      totalReturnPct: row.totalReturnPct,
      cycleStartTime: row.cycleStartTime,
      cycleHoldingDays: row.cycleHoldingDays,
      cycleTotalReturnPct: row.cycleTotalReturnPct,
      cycleMonthlyReturnPct: row.cycleMonthlyReturnPct,
      cycleWeeklyReturnPct: row.cycleWeeklyReturnPct,
      cycleShortSample: row.cycleShortSample,
      dividends: row.dividends,
      avgCost: row.avgCost,
      qty: row.qty,
      wholeLotQty: row.wholeLotQty,
      oddLotQty: row.oddLotQty,
      boardLotSize: row.boardLotSize,
      quoteTime: row.quoteTime,
      quoteSyncWarning: row.quoteSyncWarning,
      missingPrice: row.missingPrice,
      hasDuplicateRecords: row.hasDuplicateRecords,
      txnCount: row.txnCount
    }));
  }

  const longTermSortDefaults = {
    symbol: 'asc',
    name: 'asc',
    allocation: 'desc',
    totalReturn: 'desc',
    contribution: 'desc',
    yield: 'desc'
  };
  let longTermSort = { key: 'allocation', dir: 'desc' };

  function getLongTermSortValue(row, key){
    switch(key){
      case 'symbol': return (row.stock.symbol || '').toString();
      case 'name': return (row.stock.name || '').toString();
      case 'allocation': return Number.isFinite(row.allocationRatio) ? row.allocationRatio : Number.NEGATIVE_INFINITY;
      case 'totalReturn': return Number.isFinite(row.totalReturnPct) ? row.totalReturnPct : Number.NEGATIVE_INFINITY;
      case 'contribution': return Number.isFinite(row.contributionRatio) ? row.contributionRatio : Number.NEGATIVE_INFINITY;
      case 'yield': return Number.isFinite(row.yieldPct) ? row.yieldPct : Number.NEGATIVE_INFINITY;
      default: return 0;
    }
  }

  function compareLongTermRows(a,b){
    const { key, dir } = longTermSort;
    const dirFactor = dir === 'asc' ? 1 : -1;
    const va = getLongTermSortValue(a, key);
    const vb = getLongTermSortValue(b, key);

    if(typeof va === 'string' || typeof vb === 'string'){
      const sa = (va ?? '').toString();
      const sb = (vb ?? '').toString();
      const cmp = sa.localeCompare(sb, 'zh-Hant', {numeric:true, sensitivity:'base'});
      if(cmp !== 0) return cmp * dirFactor;
      return (a.stock.symbol || '').localeCompare(b.stock.symbol || '', 'zh-Hant', {numeric:true, sensitivity:'base'});
    }

    const aNum = Number(va);
    const bNum = Number(vb);
    const safeA = Number.isFinite(aNum) ? aNum : (dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const safeB = Number.isFinite(bNum) ? bNum : (dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    if(safeA === safeB){
      return (a.stock.symbol || '').localeCompare(b.stock.symbol || '', 'zh-Hant', {numeric:true, sensitivity:'base'});
    }
    return safeA > safeB ? dirFactor : -dirFactor;
  }

  function updateLongTermSortIndicators(){
    $$('#tbl-long-term thead th.sortable').forEach(th=>{
      th.classList.remove('sort-asc','sort-desc');
      th.removeAttribute('aria-sort');
      if(th.dataset.sort === longTermSort.key){
        th.classList.add(longTermSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        th.setAttribute('aria-sort', longTermSort.dir === 'asc' ? 'ascending' : 'descending');
      }
    });
  }

  function formatPctSigned(value){
    if(!Number.isFinite(value)) return '—';
    const color = value < 0 ? '#dc2626' : (value > 0 ? '#059669' : 'inherit');
    return `<span style="color:${color}">${fmt2.format(value)}%</span>`;
  }

  /** 持有標的「市場實價」欄備註：僅顯示時刻（對應 stock.lastPriceAt） */
  function formatStockPriceUpdatedAt(iso){
    if(iso == null || String(iso).trim() === '') return '—';
    const t = new Date(iso);
    if(Number.isNaN(t.getTime())) return '—';
    return t.toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false });
  }

  function formatStockPriceUpdatedAtFull(iso){
    if(iso == null || String(iso).trim() === '') return '—';
    const t = new Date(iso);
    if(Number.isNaN(t.getTime())) return '—';
    return t.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace(',', '');
  }

  function formatQuoteTimeDiff(ms){
    if(!Number.isFinite(ms) || ms < 0) return '—';
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if(hours <= 0) return `${minutes} 分`;
    if(minutes === 0) return `${hours} 小時`;
    return `${hours} 小時 ${minutes} 分`;
  }

  function getQuoteTimeRangeSummary(quoteTimes){
    const values = (quoteTimes || [])
      .map(iso => ({ iso, ts: getQuoteTimeValue(iso) }))
      .filter(item => Number.isFinite(item.ts))
      .sort((a, b) => a.ts - b.ts);

    if(values.length === 0){
      return {
        text: '尚無持倉報價',
        detail: '尚未抓到可用的報價更新時間',
        earliest: null,
        latest: null,
        diffMs: null,
        level: 'missing'
      };
    }

    if(values.length === 1){
      const timeText = formatStockPriceUpdatedAt(values[0].iso);
      return {
        text: `報價更新 ${timeText}`,
        detail: `所有持倉共用同一個更新時間：${timeText}`,
        earliest: values[0].iso,
        latest: values[0].iso,
        diffMs: 0,
        level: 'aligned'
      };
    }

    const earliest = values[0];
    const latest = values[values.length - 1];
    const diffMs = latest.ts - earliest.ts;
    const diffMinutes = diffMs / 60000;
    let level = 'minor';
    if(diffMinutes >= 180) level = 'major';
    else if(diffMinutes >= 30) level = 'medium';

    return {
      text: `最早 ${formatStockPriceUpdatedAt(earliest.iso)} / 最晚 ${formatStockPriceUpdatedAt(latest.iso)} / 時差 ${formatQuoteTimeDiff(diffMs)}`,
      detail: `${values.length} 個不同更新時間，最早 ${formatStockPriceUpdatedAt(earliest.iso)}，最晚 ${formatStockPriceUpdatedAt(latest.iso)}，最大時間差 ${formatQuoteTimeDiff(diffMs)}`,
      earliest: earliest.iso,
      latest: latest.iso,
      diffMs,
      level
    };
  }

  function buildHoldingsValidationViewModel(summary = calculatePortfolioSummary()){
    const diff = summary.holdingsVsDetailsDiff;
    const diffAbs = Math.abs(diff);
    const hasError = !summary.validation.isConsistent;
    const hasWarn = !hasError && summary.hasSyncWarning;
    const statusClass = hasError ? 'error' : (hasWarn ? 'warn' : 'ok');
    const panelStatusText = hasError ? '需處理' : (hasWarn ? '請注意' : '正確');
    const triggerText = hasError ? '需處理' : (hasWarn ? '請注意' : '持倉正確');
    const statusDesc = !summary.validation.holdingsMatchesDetails
      ? '持倉市值與明細加總不一致，請檢查零股、重複持倉或資料同步時間'
      : (summary.hasSyncWarning ? '資料更新時間不同，數值可能暫時不一致' : '持倉市值與明細加總一致，摘要卡與表格共用同一份持倉資料');
    const quoteRangeSummary = getQuoteTimeRangeSummary(summary.quoteTimes);
    const heldRows = summary.heldRows.slice().sort((a, b) => b.marketValue - a.marketValue);

    return {
      diff,
      diffAbs,
      statusClass,
      panelStatusText,
      triggerText,
      statusDesc,
      quoteRangeSummary,
      heldRows
    };
  }

  function renderHoldingsValidationTrigger(summary = calculatePortfolioSummary()){
    const trigger = $('#holdings-validation-trigger');
    if(!trigger) return;
    const vm = buildHoldingsValidationViewModel(summary);
    trigger.className = `holdings-validation-trigger ${vm.statusClass}`;
    trigger.textContent = vm.triggerText;
    trigger.setAttribute('aria-expanded', holdingsValidationState.popoverOpen ? 'true' : 'false');
    trigger.setAttribute('aria-label', `開啟持倉驗算，目前狀態：${vm.panelStatusText}`);
  }

  function setHoldingsValidationPopoverOpen(open){
    const shouldOpen = !!open;
    const popover = $('#holdings-validation-popover');
    const backdrop = $('#holdings-validation-popover-backdrop');
    const trigger = $('#holdings-validation-trigger');
    if(!popover || !backdrop || !trigger) return;
    holdingsValidationState.popoverOpen = shouldOpen;
    popover.hidden = !shouldOpen;
    backdrop.hidden = !shouldOpen;
    trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if(shouldOpen){
      $('#holdings-validation-popover-close')?.focus();
    }else{
      trigger.focus();
    }
  }
  window.setHoldingsValidationPopoverOpen = setHoldingsValidationPopoverOpen;

  function renderHoldingsValidation(summary = calculatePortfolioSummary()){
    const panel = $('#holdings-validation-panel');
    if(!panel) return;
    const vm = buildHoldingsValidationViewModel(summary);
    panel.className = `holdings-validation-panel ${vm.statusClass}`;
    panel.innerHTML = `
      <div class="holdings-validation-head">
        <div>
          <div class="holdings-validation-title">持倉驗算</div>
          <div class="holdings-validation-desc">${vm.statusDesc}</div>
        </div>
        <div class="holdings-validation-status">${vm.panelStatusText}</div>
      </div>
      <div class="holdings-validation-grid">
        <div class="holdings-validation-item">
          <div class="label">明細市值加總</div>
          <div class="value">${fmtInt.format(Math.round(summary.detailMarketValueSum))}</div>
        </div>
        <div class="holdings-validation-item">
          <div class="label">持倉市值</div>
          <div class="value">${fmtInt.format(Math.round(summary.holdingsMarketValue))}</div>
        </div>
        <div class="holdings-validation-item">
          <div class="label">差額</div>
          <div class="value ${vm.diffAbs < 0.5 ? 'ok' : 'error'}">${vm.diff >= 0 ? '+' : ''}${fmtInt.format(Math.round(vm.diff))}</div>
        </div>
        <div class="holdings-validation-item">
          <div class="label">總資產公式</div>
          <div class="value ${summary.validation.totalAssetsMatchesEquation ? 'ok' : 'error'}">${summary.validation.totalAssetsMatchesEquation ? '正確' : '不一致'}</div>
        </div>
        <div class="holdings-validation-item">
          <div class="label">可用現金</div>
          <div class="value">${fmtInt.format(Math.round(summary.cashAvailable))}</div>
        </div>
        <div class="holdings-validation-item">
          <div class="label">報價更新時間</div>
          <div class="value ${summary.hasSyncWarning ? 'warn' : ''}" style="font-size:15px">${vm.quoteRangeSummary.text}</div>
        </div>
      </div>
      <details>
        <summary>展開 debug 資訊</summary>
        <div class="mini muted" style="margin-top:8px">下表為標準化後持倉。若同一商品分散在整股、零股或重複標的，會先合併再計算。</div>
        <div class="holdings-debug-table-wrap">
          <table class="holdings-debug-table">
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th class="num">整股</th>
                <th class="num">零股</th>
                <th class="num">合計股數</th>
                <th class="num">市價</th>
                <th class="num">個別市值</th>
                <th>重複計算</th>
                <th>更新時間</th>
              </tr>
            </thead>
            <tbody>
              ${vm.heldRows.map(row => `
                <tr>
                  <td>${escapeAttr(row.stock.symbol || '—')}</td>
                  <td>${escapeAttr(row.stock.name || '')}</td>
                  <td class="num">${formatHoldingQty(row.wholeLotQty)}</td>
                  <td class="num">${formatHoldingQty(row.oddLotQty)}</td>
                  <td class="num">${formatHoldingQty(row.qty)}</td>
                  <td class="num">${row.missingPrice ? '缺價格' : fmt2.format(row.price)}</td>
                  <td class="num">${fmtInt.format(Math.round(row.marketValue))}</td>
                  <td>${row.hasDuplicateRecords ? `是（合併 ${row.stockIds.length} 筆）` : '否'}</td>
                  <td>${row.quoteTime ? formatStockPriceUpdatedAt(row.quoteTime) : '—'}</td>
                </tr>
              `).join('') || '<tr><td colspan="9" class="empty">尚無持倉資料</td></tr>'}
            </tbody>
          </table>
        </div>
      </details>`;
  }

  function formatDataHealthSourceIds(stockIds){
    if(!Array.isArray(stockIds) || stockIds.length === 0) return '—';
    return stockIds.map(id => escapeAttr(id)).join(', ');
  }

  function renderDataHealthDebugTable(rows){
    if(!rows.length){
      return '<div class="data-health-debug-empty">目前沒有需要列出的明細。</div>';
    }
    return `
      <div class="data-health-debug-table-wrap">
        <table class="data-health-debug-table">
          <thead>
            <tr>
              <th>代號</th>
              <th>名稱</th>
              <th class="num">整股</th>
              <th class="num">零股</th>
              <th class="num">合計股數</th>
              <th class="num">市價</th>
              <th class="num">市值</th>
              <th>更新時間</th>
              <th class="num">來源筆數</th>
              <th>來源 ID</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${escapeAttr(row.symbol || '—')}</td>
                <td>${escapeAttr(row.name || '')}</td>
                <td class="num">${formatHoldingQty(row.wholeLotQty)}</td>
                <td class="num">${formatHoldingQty(row.oddLotQty)}</td>
                <td class="num">${formatHoldingQty(row.qty)}</td>
                <td class="num">${row.missingPrice ? '缺價格' : fmt2.format(row.price)}</td>
                <td class="num">${fmtInt.format(Math.round(row.marketValue || 0))}</td>
                <td>${row.quoteTime ? formatStockPriceUpdatedAt(row.quoteTime) : '—'}</td>
                <td class="num">${fmtInt.format(row.sourceCount || 0)}</td>
                <td>${formatDataHealthSourceIds(row.stockIds)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderDataHealthIssueBadges(issues){
    if(!Array.isArray(issues) || issues.length === 0) return '<span class="data-health-issue-badge">—</span>';
    return issues.map(issue => `<span class="data-health-issue-badge ${issue.type}">${escapeAttr(issue.label)}</span>`).join('');
  }

  function renderDataHealthReportTable(rows){
    if(!rows.length){
      return '<div class="data-health-debug-empty">目前沒有異常標的，資料口徑一致。</div>';
    }
    return `
      <div class="data-health-debug-table-wrap">
        <table class="data-health-debug-table">
          <thead>
            <tr>
              <th>代號</th>
              <th>名稱</th>
              <th>異常類型</th>
              <th class="num">合計股數</th>
              <th class="num">市價</th>
              <th class="num">市值</th>
              <th>更新時間</th>
              <th class="num">來源筆數</th>
              <th>來源 ID</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${escapeAttr(row.symbol || '—')}</td>
                <td>${escapeAttr(row.name || '')}</td>
                <td><div class="data-health-issue-badges">${renderDataHealthIssueBadges(row.issues)}</div></td>
                <td class="num">${formatHoldingQty(row.qty)}</td>
                <td class="num">${row.missingPrice ? '缺價格' : fmt2.format(row.price)}</td>
                <td class="num">${fmtInt.format(Math.round(row.marketValue || 0))}</td>
                <td>${row.quoteTime ? formatStockPriceUpdatedAt(row.quoteTime) : '—'}</td>
                <td class="num">${fmtInt.format(row.sourceCount || 0)}</td>
                <td>${formatDataHealthSourceIds(row.stockIds)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function buildDataHealthViewModel(summary = calculatePortfolioSummary()){
    const issues = [];
    if(!summary.validation.holdingsMatchesDetails){
      issues.push({
        type: 'error',
        text: `持倉驗算不一致：差額 ${fmtInt.format(Math.round(summary.holdingsVsDetailsDiff))}`
      });
    }
    if(!summary.validation.totalAssetsMatchesEquation){
      issues.push({
        type: 'error',
        text: `總資產公式不一致：差額 ${fmtInt.format(Math.round(summary.totalAssetsDiff))}`
      });
    }
    if(summary.missingPriceCount > 0){
      issues.push({
        type: 'warn',
        text: `${summary.missingPriceCount} 檔持倉缺少價格，市值可能被低估`
      });
    }
    if(summary.quoteMismatchCount > 0){
      issues.push({
        type: 'warn',
        text: `${summary.quoteMismatchCount} 檔持倉的報價時間不同步`
      });
    }
    if(summary.duplicateRecordCount > 0){
      issues.push({
        type: 'warn',
        text: `${summary.duplicateRecordCount} 檔持倉由多筆資料合併`
      });
    }
    if(dataHealthState.storageWriteError){
      issues.push({
        type: 'error',
        text: dataHealthState.storageMessage || '資料儲存失敗，重新整理後可能回到舊資料'
      });
    }

    const hasError = issues.some(x => x.type === 'error');
    const statusClass = hasError ? 'error' : (issues.length > 0 ? 'warn' : 'ok');
    const statusText = hasError ? '需處理' : (issues.length > 0 ? '請注意' : '健康');
    const desc = issues.length
      ? '以下項目可能導致畫面數值暫時不一致，建議先確認後再判讀報表。'
      : '目前未發現會直接導致資料錯誤或不一致的高風險訊號。';
    const quoteRangeSummary = getQuoteTimeRangeSummary(summary.quoteTimes);
    const debugSections = [
      {
        type: 'error',
        title: '缺少價格的持倉',
        desc: '這些標的沒有可用市價，持倉市值會被壓成 0，總資產也會跟著偏低。',
        rows: summary.missingPriceRows
      },
      {
        type: 'warn',
        title: '報價時間不同步的持倉',
        desc: '同一批持倉使用了不同更新時間的價格，或尚未拿到更新時間，短時間內可能造成摘要與外部數據對不上。',
        rows: summary.quoteMismatchRows
      },
      {
        type: 'warn',
        title: '由多筆來源合併的持倉',
        desc: '同一商品分散在多筆 stock 記錄，系統已先合併再計算。若來源資料本身重複，這裡會最先看出來。',
        rows: summary.duplicateRows
      }
    ].filter(section => section.rows.length > 0);

    return {
      issues,
      statusClass,
      statusText,
      desc,
      quoteRangeSummary,
      debugSections,
      shouldShowDebug: issues.length > 0,
      triggerCountText: issues.length > 0 ? String(issues.length) : '0',
      triggerSubText: issues.length > 0
        ? `${summary.heldRows.length} 檔持倉，${quoteRangeSummary.summary}`
        : '點開查看資料一致性與異常明細'
    };
  }

  function buildDataHealthReport(summary = calculatePortfolioSummary()){
    const vm = buildDataHealthViewModel(summary);
    const lines = [];
    const nowText = new Date().toLocaleString('zh-TW', { hour12: false });
    lines.push(`投資儀表板資料自檢報告`);
    lines.push(`產生時間：${nowText}`);
    lines.push(`狀態：${vm.statusText}`);
    lines.push(`持倉檔數：${summary.heldRows.length}`);
    lines.push(`持倉市值：${fmtInt.format(Math.round(summary.holdingsMarketValue))}`);
    lines.push(`明細市值加總：${fmtInt.format(Math.round(summary.detailMarketValueSum))}`);
    lines.push(`持倉差額：${fmtInt.format(Math.round(summary.holdingsVsDetailsDiff))}`);
    lines.push(`總資產：${fmtInt.format(Math.round(summary.totalAssets))}`);
    lines.push(`可用現金：${fmtInt.format(Math.round(summary.cashAvailable))}`);
    lines.push(`總資產公式差額：${fmtInt.format(Math.round(summary.totalAssetsDiff))}`);
    lines.push(`缺價格檔數：${summary.missingPriceCount}`);
    lines.push(`報價不同步檔數：${summary.quoteMismatchCount}`);
    lines.push(`多來源合併檔數：${summary.duplicateRecordCount}`);
    if(dataHealthState.storageWriteError){
      lines.push(`儲存異常：${dataHealthState.storageMessage || 'IndexedDB 寫入失敗'}`);
    }
    lines.push('');
    if(!summary.anomalyRows.length){
      lines.push('目前沒有異常標的。');
      return lines.join('\n');
    }
    lines.push('異常標的清單：');
    summary.anomalyRows.forEach((row, index) => {
      const issueText = row.issues.map(issue => issue.label).join(' / ');
      const priceText = row.missingPrice ? '缺價格' : fmt2.format(row.price);
      const quoteText = row.quoteTime ? formatStockPriceUpdatedAt(row.quoteTime) : '—';
      lines.push(
        `${index + 1}. ${row.symbol} ${row.name} | ${issueText} | 股數 ${formatHoldingQty(row.qty)} | 市價 ${priceText} | 市值 ${fmtInt.format(Math.round(row.marketValue || 0))} | 更新 ${quoteText} | 來源 ${row.sourceCount} 筆 | IDs ${row.stockIds.join(', ')}`
      );
    });
    return lines.join('\n');
  }

  async function copyTextToClipboard(text){
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(text);
      }else{
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      return true;
    }catch(err){
      console.warn('複製文字失敗：', err);
      return false;
    }
  }

  function buildHoldingsExportText(summary = calculatePortfolioSummary()){
    const dataset = computeStockMetrics(summary)
      .filter(row => row.qty > 0)
      .map(row => {
        const label = getStockLabel(row.stock.id);
        return { ...row, _label: label };
      });

    dataset.sort(compareHoldingsRows);

    const lines = [
      ['代號', '名稱', '分層', '分層代碼', '總股數', '平均成本', '市場時價', '市值', '佔比%', '股票損益', '含息損益', '更新時間'].join('\t')
    ];

    dataset.forEach((row) => {
      const stock = row.stock || {};
      const price = parseN(stock.price);
      const avgCost = parseN(row.avgCost);
      const unrealized = Number.isFinite(row.unrealized) ? Math.round(row.unrealized) : null;
      const totalPnl = Number.isFinite(row.totalPnlWithFees) ? Math.round(row.totalPnlWithFees) : null;
      const tier = normalizeTierValue(row._label?.tier);
      lines.push([
        stock.symbol || '—',
        stock.name || '',
        getTierDisplayText(tier),
        tier,
        formatHoldingQty(row.qty),
        avgCost > 0 ? fmt2.format(avgCost) : '—',
        !row.missingPrice && Number.isFinite(price) && price > 0 ? fmt2.format(price) : '—',
        Number.isFinite(row.marketValue) ? fmtInt.format(Math.round(row.marketValue)) : '—',
        Number.isFinite(row.allocationRatio) ? `${fmt2.format(row.allocationRatio * 100)}%` : '—',
        unrealized != null ? fmtInt.format(unrealized) : '—',
        totalPnl != null ? fmtInt.format(totalPnl) : '—',
        formatStockPriceUpdatedAtFull(stock.lastPriceAt)
      ].join('\t'));
    });

    return lines.join('\n');
  }

  async function copyDataHealthReport(){
    const text = buildDataHealthReport(calculatePortfolioSummary());
    const copied = await copyTextToClipboard(text);
    if(copied){
      showBackupStatus('資料自檢報告已複製 ✓');
    }else{
      showBackupStatus('資料自檢報告複製失敗', true);
    }
  }

  async function copyHoldingsExport(){
    const text = buildHoldingsExportText(calculatePortfolioSummary());
    const copied = await copyTextToClipboard(text);
    if(copied){
      showBackupStatus('持股資料已複製 ✓');
    }else{
      showBackupStatus('持股資料複製失敗', true);
    }
  }

  function renderDataHealthTrigger(summary = calculatePortfolioSummary()){
    const trigger = $('#data-health-trigger');
    if(!trigger) return;
    const vm = buildDataHealthViewModel(summary);
    const statusEl = $('#data-health-trigger-status');
    const triggerText = vm.statusText === '健康' ? '資料健康' : vm.statusText;
    trigger.className = `data-health-trigger ${vm.statusClass}`;
    trigger.setAttribute('aria-expanded', dataHealthState.popoverOpen ? 'true' : 'false');
    trigger.setAttribute('aria-label', `開啟資料健康檢查，目前狀態：${vm.statusText}`);
    if(statusEl) statusEl.textContent = triggerText;
  }

  function setDataHealthPopoverOpen(open){
    const shouldOpen = !!open;
    const popover = $('#data-health-popover');
    const backdrop = $('#data-health-popover-backdrop');
    const trigger = $('#data-health-trigger');
    if(!popover || !backdrop || !trigger) return;
    dataHealthState.popoverOpen = shouldOpen;
    popover.hidden = !shouldOpen;
    backdrop.hidden = !shouldOpen;
    document.body.classList.toggle('data-health-modal-open', shouldOpen);
    trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if(shouldOpen){
      $('#data-health-popover-close')?.focus();
    }else{
      trigger.focus();
    }
  }
  window.setDataHealthPopoverOpen = setDataHealthPopoverOpen;

  function renderDataHealth(summary = calculatePortfolioSummary()){
    const panel = $('#data-health-panel');
    if(!panel) return;
    const vm = buildDataHealthViewModel(summary);
    panel.className = `data-health-panel ${vm.statusClass}`;
    panel.innerHTML = `
      <div class="data-health-head">
        <div class="data-health-head-main">
          <div class="data-health-title">Data Health</div>
          <div class="data-health-desc">${vm.desc}</div>
        </div>
        <div class="data-health-head-side">
          <button type="button" class="data-health-action" data-action="copy-data-health-report">複製自檢報告</button>
          <div class="data-health-status">${vm.statusText}</div>
        </div>
      </div>
      <div class="data-health-list">
        ${vm.issues.length
          ? vm.issues.map(issue => `<span class="data-health-chip ${issue.type}">${issue.text}</span>`).join('')
          : '<span class="data-health-chip ok">持倉、總資產與報價口徑目前一致</span>'}
      </div>
      <div class="data-health-note">目前追蹤：${vm.quoteRangeSummary.detail}；持倉 ${summary.heldRows.length} 檔；明細加總 ${fmtInt.format(Math.round(summary.detailMarketValueSum))}。</div>
      <div class="data-health-report">
        <div class="data-health-report-head">
          <div>
            <div class="data-health-report-title">資料自檢報告</div>
            <div class="data-health-report-desc">將所有異常標的集中成單一清單，方便對帳、截圖或貼給其他人協查。</div>
          </div>
        </div>
        ${renderDataHealthReportTable(summary.anomalyRows)}
      </div>
      ${vm.shouldShowDebug ? `
        <details class="data-health-debug">
          <summary>展開資料健康明細 debug</summary>
          <div class="data-health-debug-wrap">
            ${vm.debugSections.map(section => `
              <div class="data-health-debug-card ${section.type}">
                <div class="data-health-debug-title">${section.title}（${section.rows.length}）</div>
                <div class="data-health-debug-desc">${section.desc}</div>
                ${renderDataHealthDebugTable(section.rows)}
              </div>
            `).join('')}
          </div>
        </details>` : ''}`;
  }

  function renderHoldings(summary = calculatePortfolioSummary()){
    const tbody = $('#tbl-holdings tbody');
    tbody.innerHTML = '';
    $$('#view-holdings .tier-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.tier === activeTierFilter));
    renderHoldingsValidationTrigger(summary);
    renderHoldingsValidation(summary);

    const tierLabelText = { core: '核心', satellite: '衛星', flex: '偵查' };

    let dataset = computeStockMetrics(summary)
      .filter(row => row.qty > 0)
      .map(row => {
        const label = getStockLabel(row.stock.id);
        return { ...row, _label: label };
      });

    if(activeTierFilter !== 'all'){
      dataset = dataset.filter(row => row._label.tier === activeTierFilter);
    }

    dataset.sort(compareHoldingsRows);

    const formatPnlInt = (value) => {
      if(!Number.isFinite(value)) return '—';
      const color = value < 0 ? '#dc2626' : (value > 0 ? '#059669' : 'inherit');
      return `<span style="color:${color}">${fmtInt.format(Math.round(value))}</span>`;
    };
    const formatPct1 = (value) => {
      if(!Number.isFinite(value)) return '—';
      return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
    };
    const formatUnsignedPct1 = (value) => {
      if(!Number.isFinite(value)) return '—';
      return `${Number(value).toFixed(1)}%`;
    };

    for(const row of dataset){
      const s = row.stock;
      const pos = row.pos;
      const label = row._label;
      const price = parseN(s.price);
      const avgCost = pos.avgCost;
      const costBasis = pos.costBasis;
      const unreal = pos.unrealized;
      const unrealPct = costBasis > 0 && Number.isFinite(unreal) ? (unreal / costBasis * 100) : null;
      const totPnl = pos.totalPnl;
      const totPct = costBasis > 0 && Number.isFinite(totPnl) ? (totPnl / costBasis * 100) : null;

      let stopHit = false;
      let profitHit = false;
      if(Number.isFinite(price) && avgCost > 0){
        const ret = (price - avgCost) / avgCost;
        if(label.stopLoss != null && ret <= label.stopLoss) stopHit = true;
        if(label.stopProfit != null && ret >= label.stopProfit) profitHit = true;
      }

      const hasPrice = !row.missingPrice && Number.isFinite(price) && price > 0;
      const stale = hasPrice && s.lastPriceAt && (Date.now() - new Date(s.lastPriceAt).getTime() > 86400000);
      const priceStr = hasPrice ? fmt2.format(price) : '—';
      const priceHtml = stale && hasPrice
        ? `<span class="price-stale-warn" title="報價超過 24 小時未更新">${priceStr}</span>`
        : priceStr;
      const priceUpdatedNote = formatStockPriceUpdatedAt(s.lastPriceAt);

      const tr = document.createElement('tr');
      tr.style.lineHeight = '1.2';
      if(stopHit) tr.classList.add('row-stop-hit');
      else if(profitHit) tr.classList.add('row-profit-hit');

      const tierKey = normalizeTierValue(label.tier);
      const tierShort = tierLabelText[tierKey] || tierKey;

      const qtyDisplay = formatHoldingQty(row.qty);
      const avgCostDisplay = avgCost ? fmt2.format(avgCost) : '—';
      const mvDisplay = Number.isFinite(row.marketValue) ? fmtInt.format(Math.round(row.marketValue)) : '—';
      const allocationDisplay = Number.isFinite(row.allocationRatio) ? formatUnsignedPct1(row.allocationRatio * 100) : '—';
      const divDisplay = row.dividends > 0 ? fmtInt.format(Math.round(row.dividends)) : '—';
      const cycleMonthly = row.cycleMonthlyReturnPct;
      const cycleHoldingDays = row.cycleHoldingDays;
      const cycleHoldingMonths = Number.isFinite(cycleHoldingDays) ? cycleHoldingDays / 30.4375 : null;
      const cycleRateColor = Number.isFinite(cycleMonthly)
        ? (cycleMonthly < 0 ? '#dc2626' : cycleMonthly > 0 ? '#059669' : 'inherit')
        : 'inherit';
      const cycleMonthlyDisplay = Number.isFinite(cycleMonthly) ? formatPct1(cycleMonthly) : '—';
      const cycleMonthsDisplay = Number.isFinite(cycleHoldingMonths) ? `${cycleHoldingMonths.toFixed(1)}個月` : '—';
      const flags = [];
      if(row.hasDuplicateRecords) flags.push('<span class="holdings-flag warn">合併重複</span>');
      if(row.missingPrice) flags.push('<span class="holdings-flag error">缺價格</span>');
      else if(row.quoteSyncWarning) flags.push('<span class="holdings-flag info">時間差</span>');
      tr.dataset.tierKey = tierKey;

      tr.innerHTML = `
        <td><span class="tier-tag tier-${tierKey}">${tierShort}</span></td>
        <td class="text-start"><div class="cell-stack"><div class="holding-symbol-main"><span class="sym">${s.symbol}</span><a class="mini muted wl-stock-link" href="https://www.wantgoo.com/stock/${isEtfSymbol(s.symbol) ? 'etf' : String(s.symbol).endsWith('B') ? 'bond' : 'stock'}/${s.symbol}" target="_blank" rel="noopener">${s.name||''}</a></div>${flags.length ? `<div class="holding-flags">${flags.join('')}</div>` : ''}</div></td>
        <td class="num"><div class="cell-stack" style="align-items:flex-end"><span>${qtyDisplay}</span><span class="mini muted">均價 ${avgCostDisplay}</span></div></td>
        <td class="num"><div class="cell-stack" style="align-items:flex-end"><span>${priceHtml}</span><span class="mini muted" title="此筆市場實價的取得或手動儲存時刻">${priceUpdatedNote}</span></div></td>
        <td class="num">${mvDisplay}</td>
        <td class="num">${allocationDisplay}</td>
        <td class="num">
          <div class="cell-stack" style="align-items:flex-end">
            <span title="股票損益（未含股息）">${formatPnlInt(unreal)}</span>
            <span class="mini" style="color:${unrealPct != null ? (unrealPct < 0 ? '#dc2626' : unrealPct > 0 ? '#059669' : 'inherit') : 'inherit'}">${unrealPct != null ? formatPct1(unrealPct) : '—'}</span>
          </div>
        </td>
        <td class="num">${divDisplay}</td>
        <td class="num">
          <div class="cell-stack" style="align-items:flex-end">
            <span title="含息損益">${formatPnlInt(totPnl)}</span>
            <span class="mini" style="color:${totPct != null ? (totPct < 0 ? '#dc2626' : totPct > 0 ? '#059669' : 'inherit') : 'inherit'}">${totPct != null ? formatPct1(totPct) : '—'}</span>
          </div>
        </td>
        <td class="num">
          <div class="cell-stack" style="align-items:flex-end">
            <span class="mini muted" title="本輪持有時間，以平均每月 30.4375 天換算">${cycleMonthsDisplay}</span>
            <span style="color:${cycleRateColor}" title="本輪持倉月化報酬率">${cycleMonthlyDisplay}</span>
          </div>
        </td>
        <td class="wk1-tech-position"><span class="wk1-signal-badge wk1-signal-missing">資料不足</span></td>
        <td class="trade-strategy-cell"><span class="trade-action-tag trade-action-missing">資料不足</span></td>
        <td class="num"><div class="op-btns">
          <button type="button" class="btn mini" data-action="edit-stock" data-id="${s.id}">編輯</button>
          <button type="button" class="btn mini ghost" data-action="edit-label" data-id="${s.id}">標籤</button>
        </div></td>`;
      tbody.appendChild(tr);
    }

    updateHoldingsSortIndicators();
    renderIndustryExposure(summary);
    injectIndicatorCells();
  }

  function injectIndicatorCells() {
    try {
      const rows = document.querySelectorAll('#tbl-holdings tbody tr');
      rows.forEach(tr => {
        const symbolCell = tr.querySelector('td:nth-child(2)');
        if (!symbolCell) return;
        const symbolEl = symbolCell.querySelector('.sym');
        const symbol = (symbolEl?.textContent || (symbolCell.textContent.trim().match(/^\S+/) || [])[0] || '').trim();
        if (!symbol) return;
        const ind = indicatorCache[String(symbol).toUpperCase()];

        let techCell = tr.querySelector('.wk1-tech-position');
        if (!techCell) {
          techCell = document.createElement('td');
          techCell.className = 'wk1-tech-position';
          const refCell = tr.children[9];
          if (refCell && refCell.nextSibling) {
            tr.insertBefore(techCell, refCell.nextSibling);
          } else {
            tr.appendChild(techCell);
          }
        }

        const tech = deriveTechnicalPosition(ind);
        techCell.innerHTML = `<span class="wk1-signal-badge ${tech.cls}" title="${escapeAttr(tech.title)}">${tech.label}</span>`;

        let strategyCell = tr.querySelector('.trade-strategy-cell');
        if (!strategyCell) {
          strategyCell = document.createElement('td');
          strategyCell.className = 'trade-strategy-cell';
          if (techCell.nextSibling) {
            tr.insertBefore(strategyCell, techCell.nextSibling);
          } else {
            tr.appendChild(strategyCell);
          }
        }
        const action = deriveTradeStrategyAction(tr.dataset.tierKey, tech);
        strategyCell.innerHTML = `<span class="trade-action-tag ${action.cls}" title="${escapeAttr(action.title)}">${action.label}</span>`;
      });
    } catch (e) {
      console.warn('[indicator] inject cells failed:', e);
    }
  }

  function renderLongTermMetrics(summary = calculatePortfolioSummary()){
    const tbody = $('#tbl-long-term tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
  const dataset = computeStockMetrics(summary).filter(row => row.qty > 0);
    if(dataset.length === 0){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" class="empty">尚無標的資料</td>`;
      tbody.appendChild(tr);
      updateLongTermSortIndicators();
      return;
    }

    const totalMarketValue = dataset.reduce((sum, row) => {
      const value = Number.isFinite(row.marketValue) ? row.marketValue : 0;
      return sum + value;
    }, 0);
    const totalPnlWithFees = dataset.reduce((sum, row) => {
      const value = Number.isFinite(row.totalPnlWithFees) ? row.totalPnlWithFees : 0;
      return sum + value;
    }, 0);
    const rows = dataset.map(row => {
      const allocationRatio = totalMarketValue > 0 ? row.marketValue / totalMarketValue : 0;
      const contributionRatio = totalPnlWithFees !== 0 ? (row.totalPnlWithFees / totalPnlWithFees * 100) : null;
      const dividendInfo = getCurrentDividendInfo(row.stock.symbol);
      const yieldValue = parseFloat(dividendInfo?.yield);
      const yieldPct = Number.isFinite(yieldValue) ? yieldValue : null;
      return {
        ...row,
        allocationRatio,
        contributionRatio,
        yieldPct
      };
    });

    const buildHighlightSets = (accessor) => {
      const entries = rows
        .map(r => ({ id: r.instrumentKey, value: accessor(r) }))
        .filter(entry => Number.isFinite(entry.value));
      if(entries.length === 0){
        return { max: new Set(), min: new Set() };
      }
      entries.sort((a,b)=> b.value - a.value);
      const maxSet = new Set(entries.slice(0, Math.min(3, entries.length)).map(entry => entry.id));
      entries.sort((a,b)=> a.value - b.value);
      const minSet = new Set(entries.slice(0, Math.min(3, entries.length)).map(entry => entry.id));
      return { max: maxSet, min: minSet };
    };

    const highlightMap = {
      allocation: buildHighlightSets(r => r.allocationRatio),
      totalReturn: buildHighlightSets(r => r.totalReturnPct),
      contribution: buildHighlightSets(r => r.contributionRatio),
      yield: buildHighlightSets(r => r.yieldPct)
    };

    const wrapHighlight = (text, metricKey, hasValue, id) => {
      if(!hasValue) return text;
      const entry = highlightMap[metricKey];
      if(!entry) return text;
      if(entry.max.has(id)){
        return `<span class="highlight-max">${text}</span>`;
      }
      if(entry.min.has(id) && !entry.max.has(id)){
        return `<span class="highlight-min">${text}</span>`;
      }
      return text;
    };

    rows.sort(compareLongTermRows);
    
    for(const row of rows){
      const allocationDisplayRaw = Number.isFinite(row.allocationRatio) ? `${fmt2.format(row.allocationRatio * 100)}%` : '—';
      const totalReturnDisplayRaw = Number.isFinite(row.totalReturnPct) ? `${fmt2.format(row.totalReturnPct)}%` : '—';
      const contributionDisplayRaw = Number.isFinite(row.contributionRatio) ? `${fmt2.format(row.contributionRatio)}%` : '—';
      const yieldDisplayRaw = Number.isFinite(row.yieldPct) && row.yieldPct > 0 ? `${fmt2.format(row.yieldPct)}%` : '—';

      const allocationDisplay = Number.isFinite(row.allocationRatio)
        ? wrapHighlight(allocationDisplayRaw, 'allocation', true, row.instrumentKey)
        : allocationDisplayRaw;
      const totalReturnDisplay = Number.isFinite(row.totalReturnPct)
        ? wrapHighlight(totalReturnDisplayRaw, 'totalReturn', true, row.instrumentKey)
        : totalReturnDisplayRaw;
      const contributionDisplay = Number.isFinite(row.contributionRatio)
        ? wrapHighlight(contributionDisplayRaw, 'contribution', true, row.instrumentKey)
        : contributionDisplayRaw;
      const yieldDisplay = Number.isFinite(row.yieldPct) && row.yieldPct > 0
        ? wrapHighlight(yieldDisplayRaw, 'yield', true, row.instrumentKey)
        : yieldDisplayRaw;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge blue">${row.stock.symbol}</span></td>
        <td>${row.stock.name || ''}</td>
        <td class="num">${allocationDisplay}</td>
        <td class="num">${totalReturnDisplay}</td>
        <td class="num">${contributionDisplay}</td>
        <td class="num">${yieldDisplay}</td>
      `;
      tbody.appendChild(tr);
    }

    updateLongTermSortIndicators();
  }

  function renderLongTermMetricsIfOpen(summary = calculatePortfolioSummary()){
    const d = document.getElementById('longterm-details');
    if(d && d.open) renderLongTermMetrics(summary);
  }
