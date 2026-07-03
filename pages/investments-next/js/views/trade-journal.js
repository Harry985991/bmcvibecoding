(function(){
  // ========= 交易日誌：每日預約單與成交結果 =========
  // 資料放在 meta.tradeJournals，避免舊版存檔流程丟失未知頂層欄位。

  const TRADE_JOURNAL_STATUSES = {
    planned: { label: '預約中', cls: 'planned' },
    filled: { label: '成交', cls: 'filled' },
    cancelled: { label: '取消', cls: 'cancelled' },
    expired: { label: '未成交', cls: 'expired' }
  };
  const TRADE_JOURNAL_SOURCES = {
    manual: '手動',
    codex: 'Codex',
    claude: 'Claude Code'
  };
  let tradeJournalEditingId = null;
  let tradeJournalRenderSeq = 0;

  function tjEscapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function tjEscapeAttr(value){
    return tjEscapeHtml(value);
  }

  function ensureTradeJournalsMeta(){
    if(!DB.meta || typeof DB.meta !== 'object') DB.meta = {};
    if(!DB.meta.tradeJournals || typeof DB.meta.tradeJournals !== 'object' || Array.isArray(DB.meta.tradeJournals)){
      DB.meta.tradeJournals = {};
    }
    return DB.meta.tradeJournals;
  }

  function getTradeJournalDate(){
    const input = document.getElementById('trade-journal-date');
    if(input?.value) return input.value;
    return localDateStr();
  }

  function normalizeTradeJournalStatus(status){
    const key = String(status || '').trim().toLowerCase();
    if(key === 'success' || key === 'done' || key === 'executed') return 'filled';
    if(key === 'failed' || key === 'missed' || key === 'unfilled') return 'expired';
    if(key === 'cancel' || key === 'canceled') return 'cancelled';
    return TRADE_JOURNAL_STATUSES[key] ? key : 'planned';
  }

  function normalizeTradeJournalSide(side){
    const key = String(side || '').trim().toLowerCase();
    return key === 'sell' || key === '賣出' ? 'sell' : 'buy';
  }

  function normalizeTradeJournalSource(source){
    const key = String(source || '').trim().toLowerCase();
    if(key === 'claude_code' || key === 'claude-code') return 'claude';
    return TRADE_JOURNAL_SOURCES[key] ? key : 'manual';
  }

  function positiveNumber(value){
    const n = parseN(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function positiveInteger(value){
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function tradeJournalRowsForDate(date = getTradeJournalDate()){
    const store = ensureTradeJournalsMeta();
    if(!Array.isArray(store[date])) store[date] = [];
    return store[date];
  }

  function findTradeJournalOrder(id){
    const store = ensureTradeJournalsMeta();
    for(const [date, rows] of Object.entries(store)){
      if(!Array.isArray(rows)) continue;
      const row = rows.find(item => item.id === id);
      if(row) return { date, row };
    }
    return null;
  }

  function getStockByTradeJournalSymbol(symbol){
    const sym = String(symbol || '').trim().toUpperCase();
    return (DB.stocks || []).find(stock => String(stock.symbol || '').trim().toUpperCase() === sym) || null;
  }

  function normalizeTradeJournalOrder(raw = {}, defaults = {}){
    const now = new Date().toISOString();
    const date = String(raw.date || defaults.date || localDateStr()).slice(0, 10);
    const symbol = String(raw.symbol || raw.stockSymbol || '').trim().toUpperCase();
    const plannedPrice = positiveNumber(raw.plannedPrice ?? raw.planPrice ?? raw.limitPrice ?? raw.price);
    const plannedQty = positiveInteger(raw.plannedQty ?? raw.planQty ?? raw.qty ?? raw.quantity);
    const actualPrice = positiveNumber(raw.actualPrice ?? raw.filledPrice ?? raw.executionPrice);
    const actualQty = positiveInteger(raw.actualQty ?? raw.filledQty ?? raw.executionQty);
    const status = normalizeTradeJournalStatus(raw.status || defaults.status);
    const stock = getStockByTradeJournalSymbol(symbol);

    return {
      id: raw.id || raw.clientId || uid(),
      date,
      source: normalizeTradeJournalSource(raw.source || defaults.source),
      side: normalizeTradeJournalSide(raw.side || raw.type || defaults.side),
      status,
      symbol,
      name: String(raw.name || raw.stockName || stock?.name || '').trim(),
      plannedPrice,
      plannedQty,
      actualPrice,
      actualQty,
      filledTime: raw.filledTime || raw.actualTime || raw.executionTime || '',
      condition: String(raw.condition || raw.trigger || '').trim(),
      strategyNote: String(raw.strategyNote || raw.reason || defaults.strategyNote || '').trim().slice(0, 800),
      sourceText: String(raw.sourceText || defaults.sourceText || '').trim().slice(0, 3000),
      resultNote: String(raw.resultNote || raw.note || '').trim().slice(0, 500),
      account: String(raw.account || defaults.account || 'ctbc').trim(),
      decisionScore: raw.decisionScore != null && Number.isFinite(Number(raw.decisionScore))
        ? Math.max(-5, Math.min(5, Number.parseInt(raw.decisionScore, 10)))
        : null,
      linkedTxnId: raw.linkedTxnId || null,
      linkedAt: raw.linkedAt || null,
      createdAt: raw.createdAt || now,
      updatedAt: now
    };
  }

  function upsertTradeJournalOrder(order){
    const rows = tradeJournalRowsForDate(order.date);
    const idx = rows.findIndex(item => item.id === order.id);
    if(idx >= 0){
      rows[idx] = { ...rows[idx], ...order, updatedAt: new Date().toISOString() };
    }else{
      rows.push(order);
    }
    rows.sort((a, b) => {
      const aTime = a.filledTime || a.createdAt || '';
      const bTime = b.filledTime || b.createdAt || '';
      return String(bTime).localeCompare(String(aTime));
    });
    return idx >= 0 ? rows[idx] : order;
  }

  function importTradeJournalPayload(payload, options = {}){
    const list = Array.isArray(payload)
      ? payload
      : (payload?.orders || payload?.entries || payload?.tradeOrders || []);
    if(!Array.isArray(list) || list.length === 0){
      throw new Error('JSON 需要包含 orders / entries 陣列，或直接是陣列');
    }
    const defaults = {
      date: payload?.date || options.date || getTradeJournalDate(),
      source: payload?.source || options.source || 'codex',
      sourceText: payload?.sourceText || '',
      strategyNote: payload?.strategyNote || ''
    };
    const imported = [];
    const skipped = [];
    for(const raw of list){
      const order = normalizeTradeJournalOrder(raw, defaults);
      if(!order.symbol){
        skipped.push({ raw, reason: 'missing symbol' });
        continue;
      }
      imported.push(upsertTradeJournalOrder(order));
    }
    return { imported, skipped };
  }

  async function persistTradeJournalAndRefresh(options = {}){
    await saveDB({ backup: !!options.backup });
    renderTradeJournal();
    if(typeof renderTxns === 'function') renderTxns();
    if(typeof renderWatchlist === 'function') renderWatchlist();
  }

  async function syncTradeJournalOrderToTxn(order){
    if(!order || order.status !== 'filled') return { ok: false, reason: 'not-filled' };
    if(order.linkedTxnId) return { ok: true, skipped: true, txnId: order.linkedTxnId };

    const stock = getStockByTradeJournalSymbol(order.symbol);
    if(!stock){
      return { ok: false, reason: `找不到標的 ${order.symbol}，請先在持股頁建立此標的` };
    }

    const price = positiveNumber(order.actualPrice) || positiveNumber(order.plannedPrice);
    const qty = positiveInteger(order.actualQty) || positiveInteger(order.plannedQty);
    if(!price || !qty){
      return { ok: false, reason: '成交價與成交股數必須大於 0' };
    }

    const filledTime = order.filledTime || `${order.date || localDateStr()}T09:00`;
    const txn = {
      id: uid(),
      stockId: stock.id,
      account: order.account || 'ctbc',
      type: order.side === 'sell' ? 'sell' : 'buy',
      price,
      qty,
      amount: Math.round(price * qty),
      time: new Date(filledTime).toISOString(),
      note: [
        '交易日誌同步',
        order.resultNote ? `結果：${order.resultNote}` : '',
        order.source ? `來源：${TRADE_JOURNAL_SOURCES[order.source] || order.source}` : ''
      ].filter(Boolean).join('｜'),
      decisionScore: order.decisionScore,
      journalNote: (order.strategyNote || order.sourceText || '').slice(0, 200)
    };

    DB.txns.push(txn);
    order.linkedTxnId = txn.id;
    order.linkedAt = new Date().toISOString();
    order.updatedAt = order.linkedAt;
    return { ok: true, txnId: txn.id };
  }

  function getTradeJournalSummary(rows){
    return rows.reduce((acc, item) => {
      acc.total += 1;
      acc[item.status] = (acc[item.status] || 0) + 1;
      const planned = positiveNumber(item.plannedPrice) && positiveInteger(item.plannedQty)
        ? item.plannedPrice * item.plannedQty : 0;
      const actual = positiveNumber(item.actualPrice) && positiveInteger(item.actualQty)
        ? item.actualPrice * item.actualQty : 0;
      acc.plannedAmount += planned;
      acc.actualAmount += actual;
      return acc;
    }, { total: 0, planned: 0, filled: 0, cancelled: 0, expired: 0, plannedAmount: 0, actualAmount: 0 });
  }

  function tradeJournalStatusBadge(status){
    const cfg = TRADE_JOURNAL_STATUSES[status] || TRADE_JOURNAL_STATUSES.planned;
    return `<span class="tj-status tj-status-${cfg.cls}">${cfg.label}</span>`;
  }

  function renderTradeJournalSummary(rows){
    const host = document.getElementById('trade-journal-summary');
    if(!host) return;
    const s = getTradeJournalSummary(rows);
    host.innerHTML = `
      <div class="tj-summary-card"><span>總筆數</span><strong>${s.total}</strong></div>
      <div class="tj-summary-card"><span>成交</span><strong>${s.filled || 0}</strong></div>
      <div class="tj-summary-card"><span>未成交</span><strong>${s.expired || 0}</strong></div>
      <div class="tj-summary-card"><span>取消</span><strong>${s.cancelled || 0}</strong></div>
      <div class="tj-summary-card"><span>預約金額</span><strong>${fmtInt.format(Math.round(s.plannedAmount))}</strong></div>
      <div class="tj-summary-card"><span>成交金額</span><strong>${fmtInt.format(Math.round(s.actualAmount))}</strong></div>
    `;
  }

  function getAllTradeJournalRows(){
    const store = ensureTradeJournalsMeta();
    const all = [];
    for(const [date, rows] of Object.entries(store)){
      if(!Array.isArray(rows)) continue;
      for(const row of rows){
        all.push({ ...row, date: row.date || date });
      }
    }
    all.sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if(byDate !== 0) return byDate;
      const at = a.filledTime || a.createdAt || '';
      const bt = b.filledTime || b.createdAt || '';
      return String(bt).localeCompare(String(at));
    });
    return all;
  }

  function getTradeJournalApiBase(){
    const base = (typeof getLocalApiBase === 'function') ? getLocalApiBase() : (window.API_BASE || 'http://localhost:3000');
    return String(base || 'http://localhost:3000').replace(/\/$/, '');
  }

  function replaceLocalDBFromServer(data){
    if(!data || typeof data !== 'object') return;
    for(const key of Object.keys(DB)) delete DB[key];
    Object.assign(DB, data);
    if(typeof invalidateTxnIndex === 'function') invalidateTxnIndex();
    if(typeof invalidateSummary === 'function') invalidateSummary();
  }

  async function refreshDBFromServer(){
    const res = await fetch(`${getTradeJournalApiBase()}/api/load-db`, { cache: 'no-store' });
    if(!res.ok) throw new Error(`load-db failed: ${res.status}`);
    const data = await res.json();
    replaceLocalDBFromServer(data);
    return data;
  }

  function replaceTradeJournalsMetaFromServer(store){
    if(!DB.meta || typeof DB.meta !== 'object') DB.meta = {};
    DB.meta.tradeJournals = (store && typeof store === 'object' && !Array.isArray(store)) ? store : {};
  }

  async function fetchTradeJournalRowsFromServer(date){
    const url = date
      ? `${getTradeJournalApiBase()}/api/trade-journals?date=${encodeURIComponent(date)}`
      : `${getTradeJournalApiBase()}/api/trade-journals`;
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok) throw new Error(`trade-journals failed: ${res.status}`);
    const payload = await res.json();
    if(date){
      const store = ensureTradeJournalsMeta();
      store[date] = Array.isArray(payload.orders) ? payload.orders : [];
      return store[date].slice();
    }
    replaceTradeJournalsMetaFromServer(payload.tradeJournals);
    return getAllTradeJournalRows();
  }

  async function upsertTradeJournalOrderToServer(order){
    const res = await fetch(`${getTradeJournalApiBase()}/api/trade-journals/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: order.date, source: order.source || 'manual', orders: [order] })
    });
    const payload = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(payload.error || payload.message || `import failed: ${res.status}`);
    await refreshDBFromServer();
    return payload;
  }

  async function patchTradeJournalOrderOnServer(id, patch){
    const res = await fetch(`${getTradeJournalApiBase()}/api/trade-journals/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    const payload = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(payload.error || payload.message || `patch failed: ${res.status}`);
    await refreshDBFromServer();
    return payload;
  }

  async function deleteTradeJournalOrderOnServer(id){
    const res = await fetch(`${getTradeJournalApiBase()}/api/trade-journals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const payload = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(payload.error || payload.message || `delete failed: ${res.status}`);
    await refreshDBFromServer();
    return payload;
  }

  async function renderTradeJournal(){
    const dateInput = document.getElementById('trade-journal-date');
    const statusFilter = document.getElementById('trade-journal-status-filter');
    const host = document.getElementById('trade-journal-list');
    if(!host) return;

    const date = dateInput?.value || '';
    const showAll = !date;
    const seq = ++tradeJournalRenderSeq;
    host.innerHTML = '<div class="empty">讀取交易日誌中...</div>';
    let rows;
    try{
      rows = await fetchTradeJournalRowsFromServer(date);
      if(seq !== tradeJournalRenderSeq) return;
    }catch(error){
      console.warn('[trade-journal] server read failed, using local cache:', error);
      rows = showAll ? getAllTradeJournalRows() : tradeJournalRowsForDate(date).slice();
    }
    renderTradeJournalSummary(rows);
    const filter = statusFilter?.value || 'all';
    const filtered = filter === 'all' ? rows : rows.filter(item => item.status === filter);

    if(filtered.length === 0){
      host.innerHTML = showAll
        ? '<div class="empty">尚無任何交易日誌。可手動新增，或由 Codex / Claude Code 透過 JSON / API 匯入。</div>'
        : '<div class="empty">這一天尚無預約單。可手動新增，或由 Codex / Claude Code 透過 JSON / API 匯入。</div>';
      return;
    }

    host.innerHTML = `
      <div class="table-wrap tj-table-wrap">
        <table class="tj-table">
          <thead>
            <tr>
              ${showAll ? '<th>日期</th>' : ''}
              <th>狀態</th>
              <th>標的</th>
              <th>方向</th>
              <th class="num">預約價 / 股數</th>
              <th class="num">成交價 / 股數</th>
              <th>策略理由</th>
              <th>結果</th>
              <th class="num">操作</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(item => {
              const sideLabel = item.side === 'sell' ? '賣出' : '買進';
              const planned = item.plannedPrice && item.plannedQty
                ? `${fmt2.format(item.plannedPrice)} / ${fmtInt.format(item.plannedQty)}`
                : '—';
              const actual = item.actualPrice && item.actualQty
                ? `${fmt2.format(item.actualPrice)} / ${fmtInt.format(item.actualQty)}`
                : '—';
              const strategy = item.strategyNote || item.condition || item.sourceText || '';
              const result = item.linkedTxnId ? `已同步：${item.linkedTxnId}` : (item.resultNote || '—');
              return `<tr>
                ${showAll ? `<td class="mini muted">${tjEscapeHtml(item.date || '—')}</td>` : ''}
                <td>${tradeJournalStatusBadge(item.status)}</td>
                <td><div class="txn-symbol-inline"><span class="sym">${tjEscapeHtml(item.symbol || '—')}</span><span class="mini muted">${tjEscapeHtml(item.name || '')}</span></div></td>
                <td><span class="type-badge ${item.side === 'sell' ? 'type-sell' : 'type-buy'}">${sideLabel}</span></td>
                <td class="num">${planned}</td>
                <td class="num">${actual}</td>
                <td class="tj-note" title="${tjEscapeAttr(strategy)}">${tjEscapeHtml(strategy.slice(0, 60) || '—')}${strategy.length > 60 ? '…' : ''}</td>
                <td class="tj-note" title="${tjEscapeAttr(result)}">${tjEscapeHtml(String(result).slice(0, 46))}${String(result).length > 46 ? '…' : ''}</td>
                <td class="num">
                  <div class="txn-op-actions">
                    ${item.status === 'planned' ? `<button class="btn mini ok" data-action="tj-fill" data-id="${item.id}">成交</button>` : ''}
                    ${item.status === 'filled' && !item.linkedTxnId ? `<button class="btn mini ok" data-action="tj-sync" data-id="${item.id}">寫入交易</button>` : ''}
                    ${item.linkedTxnId ? `<button class="btn mini" data-action="tj-goto-txn" data-id="${item.id}">看交易</button>` : ''}
                    <button class="btn mini" data-action="tj-edit" data-id="${item.id}">編輯</button>
                    ${item.status === 'planned' ? `<button class="btn mini" data-action="tj-expire" data-id="${item.id}">未成交</button><button class="btn mini danger" data-action="tj-cancel" data-id="${item.id}">取消</button>` : ''}
                    <button class="btn mini danger" data-action="tj-delete" data-id="${item.id}">刪除</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function openTradeJournalDialog(order){
    const dlg = document.getElementById('dlg-trade-journal');
    if(!dlg) return;
    tradeJournalEditingId = order?.id || null;
    document.getElementById('dlg-trade-journal-title').textContent = order ? '編輯預約單' : '新增預約單';
    document.getElementById('tj-date').value = order?.date || getTradeJournalDate();
    document.getElementById('tj-source').value = order?.source || 'manual';
    document.getElementById('tj-side').value = order?.side || 'buy';
    document.getElementById('tj-status').value = order?.status || 'planned';
    document.getElementById('tj-symbol').value = order?.symbol || '';
    document.getElementById('tj-name').value = order?.name || '';
    document.getElementById('tj-planned-price').value = order?.plannedPrice || '';
    document.getElementById('tj-planned-qty').value = order?.plannedQty || '';
    document.getElementById('tj-actual-price').value = order?.actualPrice || '';
    document.getElementById('tj-actual-qty').value = order?.actualQty || '';
    document.getElementById('tj-filled-time').value = order?.filledTime ? new Date(order.filledTime).toISOString().slice(0, 16) : '';
    document.getElementById('tj-condition').value = order?.condition || '';
    document.getElementById('tj-strategy-note').value = order?.strategyNote || '';
    document.getElementById('tj-source-text').value = order?.sourceText || '';
    document.getElementById('tj-result-note').value = order?.resultNote || '';
    dlg.returnValue = '';
    dlg.showModal();
  }

  async function saveTradeJournalDialog(){
    const existing = tradeJournalEditingId ? findTradeJournalOrder(tradeJournalEditingId)?.row : null;
    const raw = {
      id: existing?.id || undefined,
      linkedTxnId: existing?.linkedTxnId || null,
      linkedAt: existing?.linkedAt || null,
      createdAt: existing?.createdAt || undefined,
      date: document.getElementById('tj-date').value,
      source: document.getElementById('tj-source').value,
      side: document.getElementById('tj-side').value,
      status: document.getElementById('tj-status').value,
      symbol: document.getElementById('tj-symbol').value,
      name: document.getElementById('tj-name').value,
      plannedPrice: document.getElementById('tj-planned-price').value,
      plannedQty: document.getElementById('tj-planned-qty').value,
      actualPrice: document.getElementById('tj-actual-price').value,
      actualQty: document.getElementById('tj-actual-qty').value,
      filledTime: document.getElementById('tj-filled-time').value,
      condition: document.getElementById('tj-condition').value,
      strategyNote: document.getElementById('tj-strategy-note').value,
      sourceText: document.getElementById('tj-source-text').value,
      resultNote: document.getElementById('tj-result-note').value
    };
    const order = normalizeTradeJournalOrder(raw, { source: 'manual' });
    if(!order.symbol){ alert('請輸入股票代號'); return; }
    if(order.status === 'filled'){
      order.actualPrice = order.actualPrice || order.plannedPrice;
      order.actualQty = order.actualQty || order.plannedQty;
      order.filledTime = order.filledTime || new Date().toISOString();
    }
    const dateInput = document.getElementById('trade-journal-date');
    if(dateInput) dateInput.value = order.date;
    try{
      const result = await upsertTradeJournalOrderToServer(order);
      const failedSync = (result.syncResults || []).find(item => item && item.ok === false && !item.skipped);
      if(failedSync) alert(`預約單已保存，但尚未寫入交易：${failedSync.reason || '同步失敗'}`);
      await renderTradeJournal();
      if(typeof renderTxns === 'function') renderTxns();
      if(typeof renderWatchlist === 'function') renderWatchlist();
      if(typeof showBackupStatus === 'function') showBackupStatus('已保存交易日誌 ✓');
    }catch(error){
      alert('保存失敗：' + (error?.message || error));
    }
  }

  async function updateTradeJournalStatus(id, status){
    const found = findTradeJournalOrder(id);
    if(!found) return;
    const nextStatus = normalizeTradeJournalStatus(status);
    const patch = {
      ...found.row,
      status: nextStatus,
      updatedAt: new Date().toISOString()
    };
    if(nextStatus === 'filled'){
      patch.actualPrice = patch.actualPrice || patch.plannedPrice;
      patch.actualQty = patch.actualQty || patch.plannedQty;
      patch.filledTime = patch.filledTime || new Date().toISOString();
    }
    try{
      const result = await patchTradeJournalOrderOnServer(id, patch);
      const failedSync = (result.syncResults || []).find(item => item && item.ok === false && !item.skipped);
      if(failedSync) alert(`已標記成交，但尚未寫入交易：${failedSync.reason || '同步失敗'}`);
      await renderTradeJournal();
      if(typeof renderTxns === 'function') renderTxns();
      if(typeof renderWatchlist === 'function') renderWatchlist();
    }catch(error){
      alert('更新失敗：' + (error?.message || error));
    }
  }

  async function deleteTradeJournalOrder(id){
    const found = findTradeJournalOrder(id);
    if(!found) return;
    const order = found.row;
    const sideLabel = order.side === 'sell' ? '賣出' : '買進';
    const label = `${order.date || found.date}｜${sideLabel} ${order.symbol || ''} ${order.plannedQty || ''}股`;
    const msg = order.linkedTxnId
      ? `這筆已連結交易紀錄（${order.linkedTxnId}）。\n刪除日誌「不會」刪除實際交易，只移除此日誌記錄。\n\n確定刪除？\n${label}`
      : `確定刪除這筆交易日誌？此動作無法復原。\n\n${label}`;
    if(!window.confirm(msg)) return;

    try{
      await deleteTradeJournalOrderOnServer(id);
      await renderTradeJournal();
      if(typeof showBackupStatus === 'function') showBackupStatus('已刪除 1 筆交易日誌 ✓');
    }catch(error){
      alert('刪除失敗：' + (error?.message || error));
    }
  }

  async function handleTradeJournalImportFile(file){
    if(!file) return;
    try{
      const text = await file.text();
      const payload = JSON.parse(text);
      const importPayload = Array.isArray(payload)
        ? { orders: payload, source: 'codex' }
        : { ...payload, source: payload?.source || 'codex' };
      const res = await fetch(`${getTradeJournalApiBase()}/api/trade-journals/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importPayload)
      });
      const result = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(result.error || result.message || `匯入失敗：${res.status}`);
      await refreshDBFromServer();
      await renderTradeJournal();
      const linked = (result.syncResults || []).filter(item => item && item.ok).length;
      const blocked = (result.syncResults || []).filter(item => item && item.ok === false && !item.skipped).length;
      showBackupStatus(`已匯入 ${result.imported || 0} 筆預約單${linked ? `，同步 ${linked} 筆交易` : ''}${result.skipped ? `，略過 ${result.skipped} 筆` : ''}${blocked ? `，${blocked} 筆待建立標的後再同步` : ''} ✓`);
    }catch(error){
      alert('匯入失敗：' + (error?.message || error));
    }finally{
      const input = document.getElementById('trade-journal-import-file');
      if(input) input.value = '';
    }
  }

  (function bindTradeJournal(){
    const dateInput = document.getElementById('trade-journal-date');
    if(dateInput){
      // 預設留空＝顯示全部日期
      dateInput.addEventListener('change', renderTradeJournal);
    }
    document.getElementById('btn-trade-journal-all-dates')?.addEventListener('click', () => {
      const di = document.getElementById('trade-journal-date');
      if(di) di.value = '';
      renderTradeJournal();
    });
    document.getElementById('trade-journal-status-filter')?.addEventListener('change', renderTradeJournal);
    document.getElementById('btn-add-trade-journal')?.addEventListener('click', () => openTradeJournalDialog());
    document.getElementById('btn-trade-journal-import')?.addEventListener('click', () => {
      document.getElementById('trade-journal-import-file')?.click();
    });
    document.getElementById('trade-journal-import-file')?.addEventListener('change', e => {
      handleTradeJournalImportFile(e.target.files?.[0]);
    });
    document.getElementById('dlg-trade-journal')?.addEventListener('close', () => {
      const dlg = document.getElementById('dlg-trade-journal');
      if(dlg.returnValue === 'ok') saveTradeJournalDialog();
    });
    document.querySelectorAll('#dlg-trade-journal button[value="cancel"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const dlg = document.getElementById('dlg-trade-journal');
        if(dlg?.open) dlg.close('cancel');
      });
    });
    document.getElementById('trade-journal-list')?.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-action]');
      if(!btn) return;
      const id = btn.dataset.id;
      const found = findTradeJournalOrder(id);
      if(!found) return;
      const action = btn.dataset.action;
      if(action === 'tj-edit') openTradeJournalDialog(found.row);
      if(action === 'tj-delete') return void await deleteTradeJournalOrder(id);
      if(action === 'tj-fill') await updateTradeJournalStatus(id, 'filled');
      if(action === 'tj-expire') await updateTradeJournalStatus(id, 'expired');
      if(action === 'tj-cancel') await updateTradeJournalStatus(id, 'cancelled');
      if(action === 'tj-sync'){
        const result = await syncTradeJournalOrderToTxn(found.row);
        if(!result.ok) alert(`尚未寫入交易：${result.reason}`);
        await persistTradeJournalAndRefresh({ backup: true });
      }
      if(action === 'tj-goto-txn'){
        if(typeof gotoView === 'function') gotoView('#view-txns');
      }
    });
  })();

  // 自動匯入：開頁時讀收件匣（consume-on-read），純附加，永不覆蓋其他資料
  async function autoImportTradeJournalInbox(){
    try{
      const base = (typeof getLocalApiBase === 'function') ? getLocalApiBase() : (window.API_BASE || 'http://localhost:3000');
      const res = await fetch(`${base.replace(/\/$/, '')}/api/trade-journal-inbox`, { cache: 'no-store' });
      if(!res.ok) return;
      const payload = await res.json();
      const orders = Array.isArray(payload) ? payload : (payload?.orders || []);
      if(!Array.isArray(orders) || orders.length === 0) return;
      const importRes = await fetch(`${base.replace(/\/$/, '')}/api/trade-journals/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders,
          source: payload?.source || 'claude',
          date: payload?.date || undefined
        })
      });
      const result = await importRes.json().catch(() => ({}));
      if(!importRes.ok) throw new Error(result.error || result.message || `自動匯入失敗：${importRes.status}`);
      await refreshDBFromServer();
      if(result.imported){
        if(typeof renderTradeJournal === 'function') await renderTradeJournal();
        if(typeof showBackupStatus === 'function') showBackupStatus(`已自動匯入 ${result.imported} 筆交易日誌 ✓`);
      }
    }catch(e){
      console.warn('[trade-journal] 自動匯入失敗（收件匣）:', e);
    }
  }

  window.renderTradeJournal = renderTradeJournal;
  window.importTradeJournalPayload = importTradeJournalPayload;
  window.autoImportTradeJournalInbox = autoImportTradeJournalInbox;
})();
