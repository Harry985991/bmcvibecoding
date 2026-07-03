  // ========= 價格 CSV 匯入 (symbol,price) =========
  $('#import-csv').addEventListener('change', (e)=>{
    const f = e.target.files[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split(/\r?\n/).filter(Boolean);
      for(const line of lines){
        const [sym, price] = line.split(',').map(s=>s.trim());
        const s = DB.stocks.find(x=>x.symbol===sym);
        if(s){ s.price = parseN(price); s.lastPriceAt = nowISO(); }
      }
      persistAndRefresh({
        chrome: true,
        overview: true,
        holdings: true,
        txns: true,
	        dividend: true,
	        returns: true,
	        snapshots: true,
	        watchlist: true,
	        shortDividend: true
	      });
    };
    reader.readAsText(f);
  });

  // ========= 互動：Tabs / 子頁籤 / 搜尋 =========
  // 子頁籤渲染分派
  function renderSubviewById(target){
    try{
      if(target === '#view-return'){ renderReturnOverview(); }
      if(target === '#view-period-return'){ renderPeriodicReturnDashboard(calculatePortfolioSummary(), { forceQuote: true }); }
      if(target === '#view-stock-return'){ renderReturnContribBars(); }
      if(target === '#view-return-table'){ renderReturnOverview(); }
      if(target === '#view-watchlist'){ renderWatchlist(); }
      if(target === '#view-market-hub'){ renderMarketHub(); }
      if(target === '#view-decision-log' && typeof renderDecisionLog === 'function'){ renderDecisionLog(); }
      if(target === '#view-trade-journal' && typeof window.renderTradeJournal === 'function'){ window.renderTradeJournal(); }
      if(target === '#view-analysis' && typeof renderAnalysis === 'function'){ renderAnalysis(); }
      if(target === '#view-settings'){ renderAccounts(); }
    }catch(err){
      console.error(`[subtab] render ${target} failed`, err);
    }
  }

  function setActiveSubtab(groupEl, target, { render = true } = {}){
    if(!groupEl) return;
    const group = groupEl.dataset.subtabGroup || '';
    groupEl.querySelectorAll('.subtab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtarget === target);
    });
    const section = groupEl.closest('.view');
    if(section){
      section.querySelectorAll(':scope > .subview, :scope .subview').forEach(sv => {
        sv.classList.toggle('active', `#${sv.id}` === target);
      });
    }
    try{ localStorage.setItem(`next.subtab.${group}`, target); }catch(e){}
    if(render) renderSubviewById(target);
  }

  function activateSavedSubtab(group){
    const groupEl = document.querySelector(`.subtabs[data-subtab-group="${group}"]`);
    if(!groupEl) return;
    let saved = null;
    try{ saved = localStorage.getItem(`next.subtab.${group}`); }catch(e){}
    const valid = saved && groupEl.querySelector(`.subtab[data-subtarget="${saved}"]`);
    const target = valid ? saved : groupEl.querySelector('.subtab')?.dataset.subtarget;
    if(target) setActiveSubtab(groupEl, target);
  }

  $$('.subtabs').forEach(groupEl => {
    groupEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.subtab');
      if(!btn) return;
      setActiveSubtab(groupEl, btn.dataset.subtarget);
    });
  });

  // 跨頁跳轉：支援主頁籤與工具/報酬子頁籤
  function gotoView(target){
    if(!target) return;
    const mainTab = document.querySelector(`.tab[data-target="${target}"]`);
    if(mainTab){ mainTab.click(); return; }
    const subview = document.querySelector(target);
    const parentView = subview?.closest('.view');
    if(parentView){
      document.querySelector(`.tab[data-target="#${parentView.id}"]`)?.click();
      const groupEl = parentView.querySelector('.subtabs');
      if(groupEl) setActiveSubtab(groupEl, target);
    }
  }
  window.gotoView = gotoView;

  $$('.tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      if(dataHealthState.popoverOpen) setDataHealthPopoverOpen(false);
      if(holdingsValidationState.popoverOpen) setHoldingsValidationPopoverOpen(false);
      $$('.tab').forEach(t=>t.setAttribute('aria-selected','false'));
      tab.setAttribute('aria-selected','true');
      $$('.view').forEach(v=>v.classList.remove('active'));
      $(tab.dataset.target).classList.add('active');
      // 首頁已有完整 KPI 卡，header mini strip 僅在其他頁籤顯示
      document.body.classList.toggle('on-home-tab', tab.dataset.target === '#view-snapshots');

      // 切到持有標的時，確保重算（包含目前啟用的持股視角）
      if(tab.dataset.target==='#view-holdings'){ renderHoldings(); }
      // 切到異動紀錄時，確保重算
      if(tab.dataset.target==='#view-txns'){ renderTxns(); }
	      // 切到股息規劃時，確保重算
	      if(tab.dataset.target==='#view-dividend'){ renderDividend(); }
	      // 切到短期股息投資時，確保重算
	      if(tab.dataset.target==='#view-short-dividend' && typeof renderShortDividend === 'function'){ renderShortDividend(); }
	      // 報酬 / 工具：依記憶的子頁籤渲染
	      if(tab.dataset.target==='#view-returns-hub'){ activateSavedSubtab('returns'); }
      if(tab.dataset.target==='#view-tools'){ activateSavedSubtab('tools'); }
      if(tab.dataset.target==='#view-snapshots'){
        const summary = calculatePortfolioSummary();
        renderOverview(summary);
        updateSearchDropdown();
        refreshKPI(summary);
        renderAllocation(summary);
        try{ renderDataHealthTrigger(summary); }catch(err){ console.error('[tab:view-snapshots] renderDataHealthTrigger failed', err); }
        try{ renderDataHealth(summary); }catch(err){ console.error('[tab:view-snapshots] renderDataHealth failed', err); }
      }
      syncPeriodReturnAutoRefresh();
    })
  });
  document.body.classList.add('on-home-tab');
  $('#data-health-trigger')?.addEventListener('click', ()=>{
    if(!dataHealthState.popoverOpen && holdingsValidationState.popoverOpen){
      setHoldingsValidationPopoverOpen(false);
    }
    setDataHealthPopoverOpen(!dataHealthState.popoverOpen);
  });
  $('#data-health-popover-close')?.addEventListener('click', ()=>{
    setDataHealthPopoverOpen(false);
  });
  $('#data-health-popover-backdrop')?.addEventListener('click', ()=>{
    setDataHealthPopoverOpen(false);
  });
  $('#holdings-export-trigger')?.addEventListener('click', ()=>{
    copyHoldingsExport();
  });
  $('#holdings-validation-trigger')?.addEventListener('click', ()=>{
    if(!holdingsValidationState.popoverOpen && dataHealthState.popoverOpen){
      setDataHealthPopoverOpen(false);
    }
    setHoldingsValidationPopoverOpen(!holdingsValidationState.popoverOpen);
  });
  $('#holdings-validation-popover-close')?.addEventListener('click', ()=>{
    setHoldingsValidationPopoverOpen(false);
  });
  $('#holdings-validation-popover-backdrop')?.addEventListener('click', ()=>{
    setHoldingsValidationPopoverOpen(false);
  });
  window.addEventListener('keydown', (event)=>{
    if(event.key === 'Escape' && dataHealthState.popoverOpen){
      setDataHealthPopoverOpen(false);
      return;
    }
    if(event.key === 'Escape' && holdingsValidationState.popoverOpen){
      setHoldingsValidationPopoverOpen(false);
    }
  });
  $('#q').addEventListener('change', ()=> {
    renderHoldings();
    renderTxns();
  });

  const allocationTargetBtn = $('#btn-edit-allocation-target');
  if(allocationTargetBtn){ allocationTargetBtn.addEventListener('click', openAllocationTargetDialog); }
  const allocationTargetDialog = $('#dlg-allocation-target');
  if(allocationTargetDialog){
    allocationTargetDialog.addEventListener('close', ()=>{
      if(allocationTargetDialog.returnValue !== 'ok') return;
      const equityInput = $('#target-equity');
      const bondInput = $('#target-bond');
      const equity = parseN(equityInput.value);
      const bond = parseN(bondInput.value);
      const total = equity + bond;
      if(total <= 0){
        alert('請輸入大於 0 的比例');
        setTimeout(openAllocationTargetDialog, 0);
        return;
      }
      if(Math.abs(total - 100) > 0.01){
        alert('股票與債券比例總和需為 100%');
        setTimeout(openAllocationTargetDialog, 0);
        return;
      }
      const target = {
        equity: Number(equity.toFixed(2)),
        bond: Number(bond.toFixed(2))
      };
      saveAllocationTarget(target);
      renderAllocation();
    });
  }

  const regionTargetBtn = $('#btn-edit-region-target');
  if(regionTargetBtn){ regionTargetBtn.addEventListener('click', openRegionTargetDialog); }
  const regionTargetDialog = $('#dlg-region-target');
  if(regionTargetDialog){
    regionTargetDialog.addEventListener('close', ()=>{
      if(regionTargetDialog.returnValue !== 'ok') return;
      const twInput = $('#target-tw');
      const globalInput = $('#target-global');
      const tw = parseN(twInput.value);
      const global = parseN(globalInput.value);
      const total = tw + global;
      if(total <= 0){
        alert('請輸入大於 0 的比例');
        setTimeout(openRegionTargetDialog, 0);
        return;
      }
      if(Math.abs(total - 100) > 0.01){
        alert('台灣與全球比例總和需為 100%');
        setTimeout(openRegionTargetDialog, 0);
        return;
      }
      const target = {
        tw: Number(tw.toFixed(2)),
        global: Number(global.toFixed(2))
      };
      saveRegionTarget(target);
      renderAllocation();
    });
  }

  // 異動紀錄頁面的篩選器事件監聽器
  $('#q-txn').addEventListener('change', ()=> {
    renderTxns();
  });
  
  $('#type-filter').addEventListener('change', ()=> {
    renderTxns();
  });

  const scoreFilterEl = $('#score-filter');
  if(scoreFilterEl){
    scoreFilterEl.addEventListener('change', ()=> renderTxns());
  }

  $('#view-dividend').addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-action="dividend-settings"]');
    if(!btn) return;
    const sym = btn.dataset.symbol;
    if(sym) openDividendEdit(sym);
  });
  
  // 自定義網址按鈕（已移除 UI，保留占位避免事件綁定錯誤）

  // ========= 互動：持有表格 =========
  $('#tbl-holdings').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.dataset.id; const action = btn.dataset.action;
    const stock = DB.stocks.find(s=>s.id===id);
    if(action==='edit-stock'){
      openStockDialog(stock);
    }
    if(action==='edit-label'){
      openLabelDialog(id);
    }
  });

  $('#view-holdings').addEventListener('click', (e)=>{
    const pill = e.target.closest('.tier-filter-btn');
    if(pill){
      const t = pill.dataset.tier;
      if(t == null) return;
      activeTierFilter = t;
      renderHoldings();
    }
  });

  function uniqueSymbols(list){
    const out = [];
    const seen = new Set();
    (list || []).forEach((item) => {
      const sym = String(item || '').trim().toUpperCase();
      if(!sym || seen.has(sym)) return;
      seen.add(sym);
      out.push(sym);
    });
    return out;
  }

  function getHeldRefreshSymbols(){
    try{
      const summary = calculatePortfolioSummary(true);
      return uniqueSymbols((summary.heldRows || []).map(row => row.stock?.symbol));
    }catch(err){
      console.warn('[refresh-all] unable to calculate held symbols, fallback to DB order:', err);
      return uniqueSymbols(DB.stocks.map(s => s.symbol));
    }
  }

  function getRefreshSymbolQueue(){
    const heldSymbols = getHeldRefreshSymbols();
    const allSymbols = uniqueSymbols(DB.stocks.map(s => s.symbol));
    return uniqueSymbols([...heldSymbols, ...allSymbols]);
  }

  let _postPriceRefreshJobId = 0;

  function schedulePostPriceRefreshTasks(context = {}){
    const jobId = ++_postPriceRefreshJobId;
    const {
      heldSymbols = [],
      stockSymbols = [],
      changedCount = 0,
      isAutoRefresh = false
    } = context;
    const symbols = heldSymbols.length ? heldSymbols : stockSymbols;

    window.setTimeout(async () => {
      if(jobId !== _postPriceRefreshJobId) return;
      try{
        showBackupStatus(
          isAutoRefresh
            ? '自動更新報酬已完成，正在背景校準技術位置與封存資料…'
            : '報酬已更新，正在背景校準技術位置與封存資料…'
        );
        await refreshIndicatorsForAll({
          symbols,
          force: false
        });
        const summary = calculatePortfolioSummary();
        refreshPortfolioViews({
          holdings: true,
          txns: true,
	          dividend: true,
	          snapshots: true,
	          watchlist: true,
	          shortDividend: true,
	          summary
	        });
        if(changedCount > 0 && typeof captureLatestReturnDailyArchive === 'function'){
          try{ await captureLatestReturnDailyArchive('price-refresh-background'); }
          catch(archiveErr){ console.warn('[archive] background capture failed:', archiveErr); }
        }
        if(jobId === _postPriceRefreshJobId){
          showBackupStatus(
            isAutoRefresh
              ? '自動更新完成：報酬、技術位置與每日封存已校準 ✓'
              : '股價、報酬、技術位置與每日封存已更新 ✓'
          );
        }
      }catch(err){
        console.warn('[refresh-all] background refresh failed:', err);
        showBackupStatus('報酬已更新；背景技術位置或封存校準失敗，請稍後再重新抓資料', true);
      }
    }, 50);
  }

  // 重新抓資料（全部持股）
  const handleRefreshAllClick = async (e)=>{
    const isAutoRefresh = e === true;
    const buttons = $$('[data-action="refresh-all"]');
    const originalStates = buttons.map(btn => ({btn, text: btn.textContent}));
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.textContent = '更新中…';
    });

    let successCount = 0;
    let changedCount = 0;
    let backgroundScheduled = false;
    const failedSymbols = [];
    const staleSymbols = [];

    try{
      const heldSymbols = getHeldRefreshSymbols();
      const stockSymbols = getRefreshSymbolQueue();
      const batch = typeof priceProvider.fetchBatch === 'function'
        ? await priceProvider.fetchBatch(stockSymbols)
        : null;
      const quoteMap = batch?.quotes instanceof Map ? batch.quotes : new Map();

      const tasks = DB.stocks.map(async (s) => {
        const key = String(s.symbol || '').trim().toUpperCase();
        const q = quoteMap.get(key) || await priceProvider.fetch(s.symbol);
        if (q && !q.error && typeof q.price === 'number') {
          const incomingTimeMs = Number.isFinite(Number(q.marketTime)) ? Number(q.marketTime) * 1000 : Number.NaN;
          const existingTimeMs = s.lastPriceAt ? new Date(s.lastPriceAt).getTime() : Number.NaN;
          const incomingTradeDate = toTradeDateKey(incomingTimeMs);
          const existingTradeDate = toTradeDateKey(existingTimeMs);
          if (incomingTradeDate && existingTradeDate && incomingTradeDate < existingTradeDate) {
            staleSymbols.push(s.symbol);
            return { ok: false, symbol: s.symbol, message: '來源交易日較舊，未覆蓋現有價格' };
          }
          const nextPrice = q.price;
          const nextLastPriceAt = Number.isFinite(incomingTimeMs)
            ? new Date(incomingTimeMs).toISOString()
            : (s.lastPriceAt || nowISO());
          const currentPrice = Number(s.price);
          const priceChanged = !Number.isFinite(currentPrice) || Math.abs(currentPrice - nextPrice) > 0.000001;
          const timeChanged = String(s.lastPriceAt || '') !== String(nextLastPriceAt || '');
          if (priceChanged || timeChanged) {
            s.price = nextPrice;
            s.lastPriceAt = nextLastPriceAt;
            changedCount++;
          }
          successCount++;
          return { ok: true, symbol: s.symbol };
        }
        failedSymbols.push(s.symbol);
        return { ok: false, symbol: s.symbol, message: q?.message || '無法取得價格' };
      });

      await Promise.allSettled(tasks);
      if (changedCount > 0) {
        await saveDB();
        upsertAutoDailySnapshot(isAutoRefresh ? 'price-refresh-auto' : 'price-refresh-manual', true);
        refreshPortfolioViews({
          chrome: true,
          overview: true,
          returns: true,
          snapshots: true,
          shortDividend: true
        });
        schedulePostPriceRefreshTasks({ heldSymbols, stockSymbols, changedCount, isAutoRefresh });
        backgroundScheduled = true;
      }
      showBackupStatus(
        isAutoRefresh
          ? (changedCount > 0
            ? `自動更新報價完成，${changedCount} 檔有變動；報酬已先更新，背景校準 ${heldSymbols.length || stockSymbols.length} 檔技術位置…`
            : '自動更新報價完成，資料無變動，略過重繪')
          : `股價取得 ${successCount} 個標的，${changedCount} 檔有變動；報酬已先更新，技術位置背景校準中…`
      );
    } catch(err) {
      console.error('重新抓資料（全部）時發生錯誤:', err);
    } finally {
      originalStates.forEach(({btn, text}) => {
        btn.disabled = false;
        btn.textContent = text;
      });
    }

    if (!isAutoRefresh) {
      if ((failedSymbols.length > 0 || staleSymbols.length > 0) && successCount === 0) {
        if (staleSymbols.length > 0 && failedSymbols.length === 0) {
          alert(
            '股價更新未覆蓋任何資料，因為代理回傳的交易日比目前資料更舊。\n\n' +
            `受影響標的：${staleSymbols.join(', ')}\n\n` +
            '請先確認資料來源是否為最新交易日。'
          );
        } else {
        alert(
          '股價更新失敗，本地代理伺服器無回應。\n\n' +
          `請在終端機執行：\n${LOCAL_PROXY_START_COMMAND}\n\n` +
          '然後重新點擊「重新抓資料」。'
        );
        }
      } else if (failedSymbols.length > 0 || staleSymbols.length > 0) {
        const parts = [];
        if (failedSymbols.length > 0) parts.push(`${failedSymbols.length} 失敗（${failedSymbols.join(', ')}）`);
        if (staleSymbols.length > 0) parts.push(`${staleSymbols.length} 較舊未覆蓋（${staleSymbols.join(', ')}）`);
        showBackupStatus(`更新完成：${successCount} 成功，${parts.join('；')}`, true);
      } else if(backgroundScheduled) {
        showBackupStatus(`股價已更新 ${successCount} 個標的；報酬已先更新，技術位置背景校準中…`);
      } else {
        showBackupStatus(`股價資料無變動，維持目前報酬檢視 ✓`);
      }
    } else if ((failedSymbols.length > 0 || staleSymbols.length > 0) && successCount === 0) {
      if (staleSymbols.length > 0 && failedSymbols.length === 0) {
        showBackupStatus(`自動更新略過：來源較舊，未覆蓋現有市場實價（${staleSymbols.join(', ')}）`, true);
      } else {
      showBackupStatus(`自動更新失敗：本地代理伺服器未啟動，市場實價未更新。請執行 ${LOCAL_PROXY_START_COMMAND}`, true);
      checkProxyStatus().catch(err => {
        console.warn('[proxy] check after auto refresh failure failed:', err);
      });
      }
    }
  };

  $$('[data-action="refresh-all"]').forEach(btn=>{
    btn.addEventListener('click', handleRefreshAllClick);
  });


  // ========= 代理伺服器控制 =========
  // ========= 代理伺服器控制 =========
  // 檢查是否在 Electron 環境中
  const isElectron = typeof window !== 'undefined' && window.electronAPI;
  
  // 啟動代理伺服器
  async function startProxyServer() {
    if (isElectron) {
      try {
        const result = await window.electronAPI.startProxyServer();
        if (result.success) {
          updateProxyStatus('running', '代理伺服器已啟動');
          const startBtn = $('#btn-start-proxy');
          if (startBtn) startBtn.style.display = 'none';
          await checkProxyStatus();
        } else {
          alert('啟動失敗：' + result.message);
        }
      } catch (error) {
        alert('啟動失敗：' + error.message);
      }
    } else {
      // 在瀏覽器環境中，提供手動啟動指引
      alert(`請在終端機中執行以下指令來啟動代理伺服器：\n\n${LOCAL_PROXY_START_COMMAND}\n\n或者使用 Electron 版本：\ncd ${LOCAL_PROXY_PROJECT_DIR}\nnpm run electron`);
    }
  }
  
  // 更新代理伺服器狀態顯示
  function updateProxyStatus(status, message) {
    const statusEl = $('#proxy-status');
    if (!statusEl) return;
    statusEl.textContent = message;
  
    if (status === 'running') {
      statusEl.className = 'badge green';
    } else if (status === 'stopped') {
      statusEl.className = 'badge red';
    } else {
      statusEl.className = 'badge gray';
    }
  }
  
  // 檢查代理伺服器狀態
  async function checkProxyStatus() {
    const startBtn = $('#btn-start-proxy');
    const banner = document.getElementById('proxy-offline-banner');
    let running = false;

    if (isElectron) {
      try {
        const result = await window.electronAPI.getProxyStatus();
        running = !!result.running;
        if (running) {
          updateProxyStatus('running', '代理伺服器運行中');
          if (startBtn) startBtn.style.display = 'none';
        } else {
          updateProxyStatus('stopped', '代理伺服器未運行');
          if (startBtn) startBtn.style.display = '';
        }
      } catch (error) {
        console.error('檢查代理伺服器狀態失敗:', error);
        updateProxyStatus('stopped', '代理伺服器未運行');
        if (startBtn) startBtn.style.display = '';
        running = false;
      }
    } else {
      try {
        const response = await fetch('http://localhost:3000/health');
        running = response.ok;
        if (running) {
          updateProxyStatus('running', '代理伺服器運行中');
          if (startBtn) startBtn.style.display = 'none';
        } else {
          updateProxyStatus('stopped', '代理伺服器未運行');
          if (startBtn) startBtn.style.display = '';
        }
      } catch (error) {
        updateProxyStatus('stopped', '代理伺服器未運行');
        if (startBtn) startBtn.style.display = '';
        running = false;
      }
    }

    if (banner) banner.style.display = running ? 'none' : '';
    return running;
  }
  window.checkProxyStatus = checkProxyStatus;

  async function autoRefreshMarketPricesOnLoad() {
    try {
      const running = await checkProxyStatus();
      if (!running) {
        showBackupStatus('開啟頁面時略過市場實價自動更新：代理伺服器未啟動', true);
        return;
      }
      await handleRefreshAllClick(true);
      showBackupStatus('已自動更新市場實價');
    } catch (error) {
      console.warn('[auto-refresh-on-load] failed:', error);
      showBackupStatus('開啟頁面時自動更新市場實價失敗', true);
    }
  }

  // 綁定按鈕事件
  const btnStartProxy = $('#btn-start-proxy');
  if (btnStartProxy) btnStartProxy.addEventListener('click', startProxyServer);
  $('#btn-check-proxy')?.addEventListener('click', checkProxyStatus);
  $('#btn-manual-backup')?.addEventListener('click', () => triggerAutoBackup(true));
  $('#proxy-offline-settings-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    gotoView('#view-settings');
  });
  $('#data-health-panel')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="copy-data-health-report"]');
    if(!btn) return;
    copyDataHealthReport();
  });
  
  // 綁定時間範圍選擇器事件
  $$('.range-btn[data-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rangeValue = parseInt(btn.dataset.range);
      // 更新所有按鈕的 active 狀態
      $$('.range-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.range) === rangeValue);
      });
      // 更新當前範圍
      currentRange = rangeValue;
      if($('#tbl-snapshots')) renderSnapshots();
    });
  });

  const returnRangeToolbar = $('.return-chart-toolbar');
  if(returnRangeToolbar){
    returnRangeToolbar.addEventListener('click', (event) => {
      const btn = event.target.closest('.return-range-btn');
      if(!btn) return;
      const nextRange = btn.dataset.returnRange || 'all';
      if(!returnChartRangeConfig[nextRange]) return;
      if(returnChartRange === nextRange) return;
      returnChartRange = nextRange;
      refreshReturnCharts();
    });
  }
  
  // 監聽 Electron 的代理伺服器狀態更新
  if (isElectron) {
    window.electronAPI.onProxyServerStatus((event, data) => {
      console.log('代理伺服器狀態更新:', data);
      if (data.status === 'running') {
        updateProxyStatus('running', '代理伺服器運行中');
        const startBtn = $('#btn-start-proxy');
        if (startBtn) startBtn.style.display = 'none';
        const banner = document.getElementById('proxy-offline-banner');
        if (banner) banner.style.display = 'none';
      } else if (data.status === 'stopped') {
        updateProxyStatus('stopped', '代理伺服器已停止');
        const startBtn = $('#btn-start-proxy');
        if (startBtn) startBtn.style.display = '';
        const banner = document.getElementById('proxy-offline-banner');
        if (banner) banner.style.display = '';
      }
    });
  }


  // ========= 主程式入口 =========
  function refreshPortfolioViews(options = {}){
    const {
      chrome = false,
      overview = false,
      holdings = false,
      txns = false,
      accounts = false,
      dividend = false,
      returns = false,
      snapshots = false,
      watchlist = false,
      shortDividend = false,
      marketHub = false,
      proxy = false,
      summary: providedSummary = null
    } = options;

    const needsSummary = chrome || overview || holdings || txns || dividend || returns;
    const summary = needsSummary ? (providedSummary || calculatePortfolioSummary()) : providedSummary;
    const runRefreshStep = (label, fn) => {
      try{
        fn();
      }catch(err){
        console.error(`[refreshPortfolioViews] ${label} failed`, err);
      }
    };

    if(chrome && summary){
      runRefreshStep('renderDataHealthTrigger', ()=>renderDataHealthTrigger(summary));
      runRefreshStep('renderDataHealth', ()=>renderDataHealth(summary));
      runRefreshStep('updateSearchDropdown', ()=>updateSearchDropdown());
      runRefreshStep('refreshKPI', ()=>refreshKPI(summary));
    }
    if(overview && summary){
      runRefreshStep('renderOverview', ()=>renderOverview(summary));
      runRefreshStep('renderAllocation', ()=>renderAllocation(summary));
    }
    if(holdings && summary){
      runRefreshStep('renderHoldings', ()=>renderHoldings(summary));
    }
    if(txns && summary){
      runRefreshStep('renderTxns', ()=>renderTxns(summary));
    }
    if(accounts){
      runRefreshStep('renderAccounts', ()=>renderAccounts());
    }
    if(dividend && summary){
      runRefreshStep('renderDividend', ()=>renderDividend(summary));
    }
    if(returns && summary){
      runRefreshStep('renderReturnOverview', ()=>renderReturnOverview(summary));
      if($('#view-period-return')?.classList.contains('active')){
        runRefreshStep('renderPeriodicReturnDashboard', ()=>renderPeriodicReturnDashboard(summary));
      }
    }
    if(snapshots){
      if($('#tbl-snapshots')) runRefreshStep('renderSnapshots', ()=>renderSnapshots());
      if($('#drawdown-chart') || $('#drawdown-chart-wrap')) runRefreshStep('renderDrawdownChart', ()=>renderDrawdownChart());
    }
    if(watchlist){
      runRefreshStep('renderWatchlist', ()=>renderWatchlist());
    }
    if(shortDividend){
      runRefreshStep('renderShortDividend', ()=>renderShortDividend());
    }
    if(marketHub){
      runRefreshStep('renderMarketHub', ()=>renderMarketHub());
    }
    if(proxy){
      runRefreshStep('checkProxyStatus', ()=>checkProxyStatus());
    }
    return summary;
  }

  async function persistAndRefresh(refreshOptions = {}, saveOptions = {}){
    await saveDB(saveOptions);
    fullRender();
    return refreshOptions;
  }

  // ========= 初次渲染 =========
  function fullRender(){
    setInitDebugStatus('fullRender:start');
    const summary = calculatePortfolioSummary();
    renderOverview(summary);
    updateSearchDropdown();
    refreshKPI(summary);
    renderHoldings(summary);
    renderTxns(summary);
    renderAccounts();
    renderAllocation(summary);
    renderDividend(summary);
    if(typeof renderShortDividend === 'function') renderShortDividend();
    renderReturnOverview(summary);
    if($('#view-period-return')?.classList.contains('active')){
      renderPeriodicReturnDashboard(summary);
    }
    renderSnapshots();
    renderDrawdownChart();
    try{ renderDataHealthTrigger(summary); }catch(err){ console.error('[fullRender] renderDataHealthTrigger failed', err); }
    try{ renderDataHealth(summary); }catch(err){ console.error('[fullRender] renderDataHealth failed', err); }
    renderWatchlist();
    renderMarketHub();
    if(typeof window.renderTradeJournal === 'function') window.renderTradeJournal();
    checkProxyStatus();
    setInitDebugStatus(`fullRender:done rows=${summary.heldRows.length}`);
  }
  
  function ensureDividendMonthOptions(){
    const container = $('#dividend-months');
    if(!container || container.dataset.ready === 'true') return;
    for(let month = 1; month <= 12; month++){
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '4px';
      label.style.fontSize = '12px';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(month);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(`${month}月`));
      container.appendChild(label);
    }
    container.dataset.ready = 'true';
  }


  // ========= 初始化 =========
  // ── 等待 IndexedDB 就緒後才渲染（取代同步 fullRender）────
  setInitDebugStatus('pre-dbReady:reached');
  function migrateStockLabelsToStocks(){
    const labels = DB.meta?.stockLabels;
    if(!labels || typeof labels !== 'object') return false;
    if(Object.keys(labels).length === 0){
      delete DB.meta.stockLabels;
      return false;
    }
    let migrated = 0;
    for(const stock of DB.stocks){
      const instrumentKey = getHoldingInstrumentKey(stock);
      const label = labels[instrumentKey] || labels[stock.id];
      if(label && typeof label === 'object'){
        if(label.tier && !stock.tier) stock.tier = label.tier;
        if(label.strategy && !stock.strategy) stock.strategy = label.strategy;
        if(label.stopLoss != null && stock.stopLoss == null) stock.stopLoss = label.stopLoss;
        if(label.stopProfit != null && stock.stopProfit == null) stock.stopProfit = label.stopProfit;
        migrated++;
      }
    }
    if(migrated > 0){
      delete DB.meta.stockLabels;
      saveDB();
      console.log(`[Migration] 已將 ${migrated} 筆 stockLabels 合併至 stock 物件`);
    }
    return migrated > 0;
  }

  _dbReady.then(() => {
    setInitDebugStatus('dbReady:resolved');
    migrateStockLabelsToStocks();
    updateTargetLabels(getAllocationTarget(), getRegionTarget());
    fullRender();

    // 交易日誌自動匯入：開頁時讀收件匣，純附加（不阻塞主畫面）
    if(typeof window.autoImportTradeJournalInbox === 'function'){
      Promise.resolve().then(() => window.autoImportTradeJournalInbox());
    }

    Promise.resolve().then(async () => {
      try{
        const imported = await importHistoricalSnapshots202604TradingDays();
        if(imported){
          setInitDebugStatus('seed:imported');
          fullRender();
        }
      }catch(err){
        setInitDebugStatus('seed:error', true);
        console.warn('[Init] 歷史快照匯入失敗，略過背景補齊：', err);
      }
    });

    startAutoDailySnapshotWatcher();
    setTimeout(() => refreshIndicatorsForAll(), 2500);
    // 開頁後自動更新市場實價：先確認代理可用，再執行一次靜默刷新。
    setTimeout(() => {
      autoRefreshMarketPricesOnLoad().catch(err => {
        console.warn('[auto-refresh-on-load] unexpected failure:', err);
      });
    }, 1200);
  }).catch(err => {
    setInitDebugStatus('dbReady:error', true);
    console.error('[Init] DB 載入失敗，使用空資料渲染：', err);
    updateTargetLabels(getAllocationTarget(), getRegionTarget());
    fullRender();
    startAutoDailySnapshotWatcher();
  });

  // ── 手動備份按鈕（設定頁用）─────────────────────────────
  window.triggerManualBackup = () => triggerAutoBackup(true);
