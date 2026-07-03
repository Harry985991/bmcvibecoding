  // 確保 DB.watchlist 存在
  function normalizeWatchSide(side) {
    return side === 'sell' ? 'sell' : 'buy';
  }

  function ensureWatchlist() {
    if (!Array.isArray(DB.watchlist)) DB.watchlist = [];
    DB.watchlist.forEach(item => {
      if (!item || typeof item !== 'object') return;
      item.side = normalizeWatchSide(item.side);
    });
  }

  function updateWatchDialogLabels() {
    const side = normalizeWatchSide(document.getElementById('wl-side')?.value);
    const priceLabel = document.getElementById('wl-plan-price-label');
    const qtyLabel = document.getElementById('wl-plan-qty-label');
    if (priceLabel) {
      priceLabel.textContent = side === 'sell' ? '計劃賣出單價（元）' : '計劃買入單價（元）';
    }
    if (qtyLabel) {
      qtyLabel.textContent = side === 'sell' ? '計劃賣出張數' : '計劃買入張數';
    }
  }

  // ── 輔助：根據 symbol 嘗試從 DB.stocks 取得名稱 ──────────────
  function getStockNameBySymbol(symbol) {
    const s = DB.stocks.find(x => x.symbol === symbol.toUpperCase());
    return s?.name || '';
  }

  // ── 行情刷新：更新單筆筆記的 quoteCache ─────────────────────
  async function refreshWatchItemQuote(item) {
    const sym = String(item.symbol || '').trim().toUpperCase();
    // 平行取得：即時報價 + 歷史收盤 + NAV 折溢價（ETF 限定）
    const [quoteResult, historyResult, navResult] = await Promise.allSettled([
      priceProvider.fetchQuote(sym),
      fetchPriceHistory(sym),
      isEtfSymbol(sym) ? fetchNavPremium(sym) : Promise.resolve(null)
    ]);

    const result = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
    const history = historyResult.status === 'fulfilled' ? historyResult.value : null;
    const nav = navResult.status === 'fulfilled' ? navResult.value : null;

    if (!result || result.error) {
      // 即使報價失敗，仍更新歷史與 NAV（如有）
      if (!item.quoteCache) item.quoteCache = {};
      if (history) item.quoteCache.recentCloses = history.slice(-60);
      if (nav) item.quoteCache.navPremium = nav;
      return false;
    }
    item.quoteCache = {
      prevClose:     result.prevClose ?? null,
      prevChangePct: result.prevChangePct ?? null,
      todayOpen:     result.todayOpen ?? null,
      livePrice:     result.livePrice ?? null,
      recentCloses:  history ? history.slice(-60) : (item.quoteCache?.recentCloses || []),
      navPremium:    nav || (item.quoteCache?.navPremium || null),
      updatedAt:     new Date().toISOString()
    };
    return true;
  }

  // ── 批次刷新全部筆記行情 ─────────────────────────────────────
  async function refreshAllWatchlistQuotes() {
    ensureWatchlist();
    const btn = document.getElementById('btn-refresh-watchlist');
    if (btn) { btn.disabled = true; btn.textContent = '更新中…'; }
    try {
      const active = DB.watchlist.filter(item => item.status !== 'done');
      await Promise.allSettled(active.map(item => refreshWatchItemQuote(item)));
      await saveDB();
      renderWatchlist();
      showBackupStatus(`資料已更新 ${active.length} 筆`);
    } catch(e) {
      console.warn('行情更新失敗：', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '重新抓資料'; }
    }
  }

  // ── 渲染一張筆記卡片 ─────────────────────────────────────────
  function buildWatchRow(item) {
    const q = item.quoteCache || {};
    const side = normalizeWatchSide(item.side);
    const isSell = side === 'sell';
    const sideText = isSell ? '賣出' : '買進';
    const fmtP = (v) => (v != null && Number.isFinite(v)) ? fmt2.format(v) : '—';
    const fmtPctVal = (v) => {
      if (v == null || !Number.isFinite(v)) return '—';
      return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    };
    const pctSpan = (pct) => {
      if (pct == null || !Number.isFinite(pct)) return '<span class="wl-chg-cell flat">—</span>';
      const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
      return `<span class="wl-chg-cell ${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>`;
    };
    const movingAverage = (rows, days) => {
      if (!Array.isArray(rows) || rows.length < days) return null;
      const slice = rows.slice(-days);
      const sum = slice.reduce((acc, pt) => acc + parseN(pt.close), 0);
      return sum / days;
    };
    const maCell = (value, latestClose) => {
      if (value == null || !Number.isFinite(value)) return '<span class="wl-ma-cell">—</span>';
      const isBelow = latestClose != null && Number.isFinite(latestClose) && latestClose < value;
      return `<span class="wl-ma-cell ${isBelow ? 'below' : ''}">${fmt2.format(value)}</span>`;
    };

    // ── 類別 ──
    const cat = classifySymbol(item.symbol, item.category);

    // ── 近 5 日漲跌幅 ──
    const recentCloses = Array.isArray(q.recentCloses) ? q.recentCloses : [];
    let fiveDayPct = null;
    if (recentCloses.length >= 2) {
      const last5 = recentCloses.slice(-5);
      const start = last5[0].close;
      const end = last5[last5.length - 1].close;
      if (start !== 0) fiveDayPct = ((end - start) / start) * 100;
    }

    // ── 近一個月漲跌幅 ──
    let monthPct = null;
    if (recentCloses.length >= 2) {
      const monthWindow = recentCloses.slice(-20);
      const oldest = monthWindow[0];
      const newest = monthWindow[monthWindow.length - 1];
      if (oldest.close !== 0) monthPct = ((newest.close - oldest.close) / oldest.close) * 100;
    }
    const monthLine = movingAverage(recentCloses, 20);
    const tenDayLine = movingAverage(recentCloses, 10);
    const fiveDayLine = movingAverage(recentCloses, 5);
    const latestCloseRaw = recentCloses.length > 0 ? Number(recentCloses[recentCloses.length - 1].close) : NaN;
    const latestClose = Number.isFinite(latestCloseRaw) ? latestCloseRaw : null;

    // ── 玩股網連結 ──
    const sym = String(item.symbol || '').trim().toUpperCase();
    const wantgooType = sym.endsWith('B') ? 'bond' : isEtfSymbol(sym) ? 'etf' : 'stock';
    const wantgooUrl = `https://www.wantgoo.com/stock/${wantgooType}/${sym}`;

    // ── 近 5 日收盤（主列 inline） ──
    const last5 = recentCloses.slice(-5);
    let closesInlineHtml = '';
    if (last5.length > 0) {
      closesInlineHtml = '<div class="wl-row-closes">' + last5.map((pt, idx) => {
        const prev = idx > 0 ? last5[idx - 1].close : pt.close;
        const chg = pt.close - prev;
        const cls = idx === 0 ? 'fl' : (chg > 0 ? 'up' : chg < 0 ? 'dn' : 'fl');
        return (idx > 0 ? '<span class="sep">/</span>' : '') + `<span class="${cls}">${fmt2.format(pt.close)}</span>`;
      }).join('') + '</div>';
    }

    // ── 溢折價 ──
    let navHtml = '<span class="wl-nav-tag neutral">—</span>';
    const nav = q.navPremium;
    if (nav && nav.premiumPct != null && Number.isFinite(nav.premiumPct)) {
      const p = nav.premiumPct;
      const cls = p > 0 ? 'premium' : p < 0 ? 'discount' : 'neutral';
      const label = p > 0 ? '溢' : p < 0 ? '折' : '';
      navHtml = `<span class="wl-nav-tag ${cls}" title="NAV ${fmtP(nav.nav)}  市價 ${fmtP(nav.marketPrice)}  ${nav.date || ''}">${label} ${p >= 0 ? '+' : ''}${p.toFixed(2)}%</span>`;
    }

    // ── 狀態 badge ──
    const statusMap = {
      urgent:   ['今日關注', 'wl-sb-urgent'],
      watching: ['觀察中',   'wl-sb-watching'],
      done:     ['已執行',   'wl-sb-done'],
    };
    const [statusText, statusCls] = statusMap[item.status] || ['觀察中', 'wl-sb-watching'];

    // ── 備註截斷 ──
    const memoRaw = (item.memo || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const memoShort = memoRaw.length > 20 ? memoRaw.slice(0, 20) + '...' : memoRaw;

    // ── 即時報價區（展開面板） ──
    const chgClass = (q.prevChangePct != null)
      ? (q.prevChangePct > 0 ? 'wl-chg-up' : q.prevChangePct < 0 ? 'wl-chg-dn' : '')
      : '';
    const updatedHint = q.updatedAt
      ? `更新：${new Date(q.updatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`
      : '尚未抓取';

    // ── 計劃區塊（展開面板） ──
    const planParts = [];
    if (item.planPrice != null) {
      planParts.push(`<div class="wl-pi"><div class="wl-pi-lbl">計劃${sideText}價</div><div class="wl-pi-val">${isSell ? '>=' : '<='} ${fmt2.format(item.planPrice)}</div></div>`);
    }
    if (item.planQty != null)    planParts.push(`<div class="wl-pi"><div class="wl-pi-lbl">計劃${sideText}張數</div><div class="wl-pi-val">${item.planQty} 張</div></div>`);
    if (item.planPrice != null && item.planQty != null) {
      const total = item.planPrice * item.planQty * 1000;
      planParts.push(`<div class="wl-pi"><div class="wl-pi-lbl">預估總金額</div><div class="wl-pi-val">~${fmtInt.format(Math.round(total))}</div></div>`);
    }
    if (item.stopLoss != null)   planParts.push(`<div class="wl-pi"><div class="wl-pi-lbl">停損線</div><div class="wl-pi-val" style="color:#c53030">${fmt2.format(item.stopLoss)}</div></div>`);
    if (item.stopProfit != null) planParts.push(`<div class="wl-pi"><div class="wl-pi-lbl">停利線</div><div class="wl-pi-val" style="color:#276749">${fmt2.format(item.stopProfit)}</div></div>`);
    if (item.condition)          planParts.push(`<div class="wl-pi"><div class="wl-pi-lbl">進場條件</div><div class="wl-pi-val">${item.condition}</div></div>`);
    if (item.maxHoldDays != null) planParts.push(`<div class="wl-pi"><div class="wl-pi-lbl">最大持有</div><div class="wl-pi-val">${item.maxHoldDays} 天</div></div>`);

    // ── 近 5 日收盤明細（展開面板） ──
    let closesDetailHtml = '';
    if (last5.length > 0) {
      closesDetailHtml = `<div class="wl-detail-section"><div class="wl-detail-title">近 5 日收盤</div><div style="display:flex;gap:8px;flex-wrap:wrap">${
        last5.map((pt, idx) => {
          const prev = idx > 0 ? last5[idx - 1].close : pt.close;
          const chg = pt.close - prev;
          const cls = idx === 0 ? '' : (chg > 0 ? 'color:#166534' : chg < 0 ? 'color:#c53030' : '');
          const dateShort = String(pt.date || '').slice(5).replace('-', '/');
          return `<div style="text-align:center;min-width:48px"><div style="font-size:8px;color:var(--sub)">${dateShort}</div><div style="font-size:12px;font-weight:700;${cls}">${fmt2.format(pt.close)}</div></div>`;
        }).join('')
      }</div></div>`;
    }

    // ── 底部按鈕 ──
    const footerBtns = item.status !== 'done'
      ? `<button type="button" class="btn ok btn-sm" data-action="wl-execute" data-id="${item.id}">轉為${sideText}交易</button>
         <button type="button" class="btn btn-sm" data-action="wl-edit" data-id="${item.id}">編輯</button>
         <button type="button" class="btn danger btn-sm" data-action="wl-delete" data-id="${item.id}">刪除</button>`
      : `<span style="font-size:10px;color:#276749">已轉入異動紀錄</span>
         <button type="button" class="btn btn-sm" data-action="wl-delete" data-id="${item.id}">刪除筆記</button>`;

    const createdStr = item.createdAt
      ? new Date(item.createdAt).toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit' })
      : '';

    const wrapper = document.createElement('div');
    wrapper.dataset.id = item.id;

    // 主列：類別 | 代號 | 名稱 | 近5日收盤 | 5日漲跌 | 月漲跌 | 月線 | 10日線 | 5日線 | 溢折價 | 狀態 | 備註
    wrapper.innerHTML = `
      <div class="wl-row wl-${item.status || 'watching'}" data-wl-toggle="${item.id}">
        <div><span class="wl-cat-tag ${cat.cls}">${cat.label}</span></div>
        <div class="wl-row-sym">
          <span class="wl-row-sym-code">${item.symbol}<span class="wl-row-sym-side" style="color:${isSell ? '#c53030' : '#276749'}">[${sideText}]</span></span>
        </div>
        <a class="wl-row-name" href="${wantgooUrl}" target="_blank" rel="noopener" title="${(item.name || '').replace(/"/g,'&quot;')}">${item.name || ''}</a>
        <div>${closesInlineHtml || '<span style="font-size:10px;color:var(--sub)">—</span>'}</div>
        <div>${pctSpan(fiveDayPct)}</div>
        <div>${pctSpan(monthPct)}</div>
        <div>${maCell(monthLine, latestClose)}</div>
        <div>${maCell(tenDayLine, latestClose)}</div>
        <div>${maCell(fiveDayLine, latestClose)}</div>
        <div>${navHtml}</div>
        <div><span class="wl-status-badge ${statusCls}">${statusText}</span></div>
        <div class="wl-memo-trunc" title="${memoRaw}">${memoShort || '—'}</div>
      </div>
      <div class="wl-row-detail" data-wl-detail="${item.id}">
        ${item.status !== 'done' ? `
        <div class="wl-detail-section">
          <div class="wl-detail-title">即時報價</div>
          <div class="wl-prices">
            <div class="wl-pc"><div class="wl-pc-lbl">昨收</div><div class="wl-pc-val">${fmtP(q.prevClose)}</div></div>
            <div class="wl-pc ${chgClass}"><div class="wl-pc-lbl">昨漲跌</div><div class="wl-pc-val">${fmtPctVal(q.prevChangePct)}</div></div>
            <div class="wl-pc"><div class="wl-pc-lbl">今開</div><div class="wl-pc-val">${fmtP(q.todayOpen)}</div></div>
            <div class="wl-pc wl-live-cell"><div class="wl-pc-lbl">即時 <span class="wl-live-tag">Live</span></div><div class="wl-pc-val">${fmtP(q.livePrice)}</div></div>
          </div>
          <div class="wl-quote-hint">${updatedHint}</div>
        </div>` : ''}
        ${closesDetailHtml}
        ${planParts.length ? `<div class="wl-detail-section"><div class="wl-detail-title">交易計畫</div><div class="wl-plan">${planParts.join('')}</div></div>` : ''}
        ${item.memo ? `<div class="wl-detail-section"><div class="wl-detail-title">備忘</div><div class="wl-memo-box">${memoRaw}</div></div>` : ''}
        <div class="wl-footer">
          ${footerBtns}
          <span class="wl-date">${createdStr} 建立</span>
        </div>
      </div>
    `;
    return wrapper;
  }

  // ── 主渲染函式 ───────────────────────────────────────────────
  function renderWatchlist() {
    const container = document.getElementById('watchlist-body');
    if (!container) return;
    ensureWatchlist();

    const filter = document.getElementById('watchlist-filter')?.value || 'all';

    // 排序：today > watching > done，同狀態按建立時間降序
    const statusOrder = { urgent: 0, watching: 1, done: 2 };
    const items = DB.watchlist
      .filter(item => filter === 'all' || item.status === filter)
      .slice()
      .sort((a, b) => {
        const os = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
        if (os !== 0) return os;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML = '<div class="wl-empty">尚無投資筆記。點擊右上方「+ 新增筆記」開始記錄。</div>';
      return;
    }

    // 表頭
    const thead = document.createElement('div');
    thead.className = 'wl-thead';
    thead.innerHTML = '<div>類別</div><div>代號</div><div>名稱</div><div>近5日收盤</div><div>5日漲跌</div><div>月漲跌</div><div>月線</div><div>10日線</div><div>5日線</div><div>溢折價</div><div>狀態</div><div>備註</div>';
    const table = document.createElement('div');
    table.className = 'wl-table';
    table.appendChild(thead);

    for (const item of items) {
      table.appendChild(buildWatchRow(item));
    }
    container.appendChild(table);
  }

  // ── Dialog 開啟（新增 / 編輯）───────────────────────────────
  let _wlEditingId = null;

  function openWatchlistDialog(item = null) {
    const dlg = document.getElementById('dlg-watchlist');
    if (!dlg) return;

    _wlEditingId = item?.id || null;
    document.getElementById('dlg-watchlist-title').textContent = item ? '編輯投資筆記' : '新增投資筆記';

    document.getElementById('wl-symbol').value     = item?.symbol     || '';
    document.getElementById('wl-name').value       = item?.name       || '';
    document.getElementById('wl-category').value   = item?.category   || 'auto';
    document.getElementById('wl-status').value     = item?.status === 'done' ? 'watching' : (item?.status || 'watching');
    document.getElementById('wl-side').value       = normalizeWatchSide(item?.side);
    document.getElementById('wl-plan-price').value = item?.planPrice  != null ? item.planPrice  : '';
    document.getElementById('wl-plan-qty').value   = item?.planQty    != null ? item.planQty    : '';
    document.getElementById('wl-stop-loss').value  = item?.stopLoss   != null ? item.stopLoss   : '';
    document.getElementById('wl-stop-profit').value= item?.stopProfit != null ? item.stopProfit : '';
    document.getElementById('wl-condition').value  = item?.condition  || '';
    document.getElementById('wl-max-days').value   = item?.maxHoldDays!= null ? item.maxHoldDays : '';
    document.getElementById('wl-memo').value       = item?.memo       || '';

    // 近 5 日收盤（唯讀顯示）
    const closesWrap = document.getElementById('wl-closes-wrap');
    const closesDisp = document.getElementById('wl-closes-display');
    const recentCloses = Array.isArray(item?.quoteCache?.recentCloses) ? item.quoteCache.recentCloses : [];
    const last5 = recentCloses.slice(-5);
    if (last5.length > 0 && closesWrap && closesDisp) {
      closesDisp.innerHTML = last5.map((pt, idx) => {
        const prev = idx > 0 ? last5[idx - 1].close : pt.close;
        const chg = pt.close - prev;
        const color = idx === 0 ? 'var(--ink)' : (chg > 0 ? '#166534' : chg < 0 ? '#c53030' : 'var(--sub)');
        const dateShort = String(pt.date || '').slice(5).replace('-', '/');
        return `<div style="text-align:center;min-width:52px"><div style="font-size:9px;color:var(--sub)">${dateShort}</div><div style="font-size:13px;font-weight:700;color:${color}">${fmt2.format(pt.close)}</div></div>`;
      }).join('');
      closesWrap.style.display = '';
    } else if (closesWrap) {
      closesWrap.style.display = 'none';
    }

    updateWatchDialogLabels();
    updateWlTotalDisplay();

    dlg.returnValue = '';
    dlg.showModal();

    dlg.addEventListener('close', async () => {
      if (dlg.returnValue !== 'ok') return;

      const symbolRaw = document.getElementById('wl-symbol').value.trim().toUpperCase();
      const memo      = document.getElementById('wl-memo').value.trim();
      if (!symbolRaw) { alert('請輸入股票代號'); return; }
      if (!memo)      { alert('請填寫備忘'); return; }

      const priceVal    = parseN(document.getElementById('wl-plan-price').value);
      const qtyVal      = parseInt(document.getElementById('wl-plan-qty').value, 10);
      const slVal       = parseN(document.getElementById('wl-stop-loss').value);
      const spVal       = parseN(document.getElementById('wl-stop-profit').value);
      const daysVal     = parseInt(document.getElementById('wl-max-days').value, 10);

      const nameInput = document.getElementById('wl-name').value.trim();
      const catVal    = document.getElementById('wl-category').value;

      const payload = {
        symbol:      symbolRaw,
        name:        nameInput || getStockNameBySymbol(symbolRaw),
        category:    catVal !== 'auto' ? catVal : null,
        side:        normalizeWatchSide(document.getElementById('wl-side').value),
        status:      document.getElementById('wl-status').value,
        planPrice:   (priceVal > 0) ? priceVal : null,
        planQty:     (Number.isFinite(qtyVal) && qtyVal > 0) ? qtyVal : null,
        stopLoss:    (slVal > 0) ? slVal : null,
        stopProfit:  (spVal > 0) ? spVal : null,
        condition:   document.getElementById('wl-condition').value.trim(),
        maxHoldDays: (Number.isFinite(daysVal) && daysVal > 0) ? daysVal : null,
        memo,
      };

      ensureWatchlist();

      if (_wlEditingId) {
        const idx = DB.watchlist.findIndex(x => x.id === _wlEditingId);
        if (idx >= 0) {
          DB.watchlist[idx] = { ...DB.watchlist[idx], ...payload };
        }
      } else {
        DB.watchlist.push({
          id:           uid(),
          ...payload,
          createdAt:    new Date().toISOString(),
          executedTxnId: null,
          quoteCache:   null,
        });
      }

      await saveDB({ backup: true });
      renderWatchlist();
      _wlEditingId = null;
    }, { once: true });
  }

  // ── 預估總金額即時計算 ────────────────────────────────────────
  function updateWlTotalDisplay() {
    const p    = parseN(document.getElementById('wl-plan-price')?.value);
    const q    = parseInt(document.getElementById('wl-plan-qty')?.value || '', 10);
    const wrap = document.getElementById('wl-total-wrap');
    const disp = document.getElementById('wl-total-display');
    if (!wrap || !disp) return;
    if (p > 0 && Number.isFinite(q) && q > 0) {
      const total = p * q * 1000;
      disp.textContent = '~' + fmtInt.format(Math.round(total)) + ' 元';
      wrap.style.display = '';
    } else {
      wrap.style.display = 'none';
    }
  }

  // ── 轉為交易（預填 openTxnDialog）───────────────────────────
  function executeWatchItem(id) {
    ensureWatchlist();
    const item = DB.watchlist.find(x => x.id === id);
    if (!item) return;
    const side = normalizeWatchSide(item.side);

    // 找或建立對應 stock
    let stock = DB.stocks.find(s => s.symbol === item.symbol);
    if (!stock) {
      // 若標的不在持有列表，提示使用者先新增，或直接在異動記錄手動填入
      alert(`「${item.symbol}」尚未在持有標的中建立。\n請先至「持有標的」新增此標的，再轉為交易。`);
      return;
    }

    // 預填 openTxnDialog
    openTxnDialog({
      // 傳入一個「預填物件」，openTxnDialog 會據此填入欄位
      stockId:      stock.id,
      type:         side === 'sell' ? 'sell' : 'buy',
      price:        item.planPrice || '',
      qty:          item.planQty   || '',
      amount:       (item.planPrice && item.planQty) ? Math.round(item.planPrice * item.planQty * 1000) : '',
      time:         new Date().toISOString(),
      note:         '',
      journalNote:  item.memo || '',
      decisionScore: null,
      _fromWatchId: id,   // 自訂欄位，dialog close 時用來標記筆記為 done
    });
  }

  // ── 列表展開/收合 ──────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-wl-toggle]');
    if (!row) return;
    // 不攔截按鈕或連結點擊
    if (e.target.closest('button') || e.target.closest('a')) return;
    const id = row.dataset.wlToggle;
    const detail = document.querySelector(`[data-wl-detail="${id}"]`);
    const arrow = document.querySelector(`[data-wl-arrow="${id}"]`);
    if (detail) detail.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
  });

  // ── 事件委派 ─────────────────────────────────────────────────
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action^="wl-"]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = btn.dataset.id;

    if (action === 'wl-edit') {
      ensureWatchlist();
      const item = DB.watchlist.find(x => x.id === id);
      if (item) openWatchlistDialog(item);
    }

    if (action === 'wl-delete') {
      if (!confirm('確定刪除此筆投資筆記？')) return;
      ensureWatchlist();
      DB.watchlist = DB.watchlist.filter(x => x.id !== id);
      await saveDB({ backup: true });
      renderWatchlist();
    }

    if (action === 'wl-execute') {
      executeWatchItem(id);
    }
  });

  // ── 筆記轉交易後，標記為 done ────────────────────────────────
  // 在現有 openTxnDialog 的 dlg.addEventListener('close') 回呼中，
  // 儲存成功後加入以下邏輯（在 persistAndRefresh 前處理）：
  //
  //   const fromWatchId = txn?._fromWatchId || null;  // 若是從筆記轉來的
  //   if (!txn && fromWatchId) {
  //     // 新增交易成功，標記對應筆記為 done
  //     ensureWatchlist();
  //     const wi = DB.watchlist.find(x => x.id === fromWatchId);
  //     if (wi) {
  //       wi.status = 'done';
  //       wi.executedTxnId = t.id;  // t 是剛建立的 txn 物件
  //     }
  //   }
  //
  // 注意：這段邏輯需要插入在 openTxnDialog 的 close 事件處理函式中，
  //       緊接在 DB.txns.push(t) 之後，saveDB() 之前。

  // ── 綁定按鈕事件 ─────────────────────────────────────────────
  document.getElementById('btn-add-watchlist')?.addEventListener('click', () => {
    openWatchlistDialog();
  });

  document.getElementById('btn-refresh-watchlist')?.addEventListener('click', () => {
    refreshAllWatchlistQuotes();
  });

  document.getElementById('watchlist-filter')?.addEventListener('change', () => {
    renderWatchlist();
  });
  document.getElementById('btn-market-add')?.addEventListener('click', () => {
    openMarketLinkDialog();
  });
  document.getElementById('btn-market-copy-all')?.addEventListener('click', () => {
    copyAllMarketLinks();
  });
  document.getElementById('btn-market-open-all')?.addEventListener('click', () => {
    openAllMarketLinks();
  });
  document.getElementById('btn-period-return-refresh')?.addEventListener('click', () => {
    renderPeriodicReturnDashboard(calculatePortfolioSummary(), { forceQuote: true, forceHistory: true });
  });
  document.getElementById('view-period-return')?.addEventListener('click', (event) => {
    const rangeBtn = event.target.closest('[data-period-range]');
    if(rangeBtn){
      const nextRange = rangeBtn.dataset.periodRange || 'day';
      if(!PERIOD_RETURN_RANGE_CONFIG[nextRange]) return;
      if(periodReturnState.range !== nextRange){
        periodReturnState.range = nextRange;
        renderPeriodReturnDashboardView();
      }
      return;
    }
    const detailBtn = event.target.closest('button[data-action="period-return-detail"]');
    if(detailBtn){
      openPeriodReturnDetail(detailBtn.dataset.key || '');
    }
  });
  document.getElementById('view-market-hub')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action^="market-"]');
    if(!btn) return;
    const url = btn.dataset.url || '';
    const key = btn.dataset.key || '';
    if(btn.dataset.action === 'market-open'){
      openMarketLink(url);
      return;
    }
    if(btn.dataset.action === 'market-copy'){
      const copied = await copyTextToClipboard(url);
      showBackupStatus(copied ? '已複製連結' : '複製連結失敗', !copied);
      return;
    }
    if(btn.dataset.action === 'market-edit'){
      const item = ensureMarketLinks().find(link => link.key === key);
      if(item) openMarketLinkDialog(item);
      return;
    }
    if(btn.dataset.action === 'market-delete'){
      await deleteMarketLinkByKey(key);
    }
  });

  // Dialog 欄位即時計算
  document.getElementById('wl-side')?.addEventListener('change', updateWatchDialogLabels);
  document.getElementById('wl-plan-price')?.addEventListener('input', updateWlTotalDisplay);
  document.getElementById('wl-plan-qty')?.addEventListener('input', updateWlTotalDisplay);

  // ═══════════════════════════════════════════════════════════
  // 投資筆記模組 END
  // ═══════════════════════════════════════════════════════════
