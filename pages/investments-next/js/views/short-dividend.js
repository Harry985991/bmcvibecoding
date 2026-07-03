  // ========= 短期股息投資（除息回補管理）=========
  const SHORT_DIVIDEND_STATUS = {
    planned: { label: '計畫中', cls: 'muted' },
    holding: { label: '等待除息', cls: 'info' },
    'after-ex': { label: '等待回補', cls: 'wait' },
    ready: { label: '可賣出', cls: 'ready' },
    sold: { label: '已賣出', cls: 'closed' },
    stopped: { label: '停損結案', cls: 'risk' }
  };

  function ensureShortDividendStore(){
    if(!DB.meta || typeof DB.meta !== 'object') DB.meta = {};
    if(!Array.isArray(DB.meta.shortDividendTrades)) DB.meta.shortDividendTrades = [];
    return DB.meta.shortDividendTrades;
  }

  function escapeShortDividendHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function shortDividendDateValue(dateStr){
    const raw = String(dateStr || '').slice(0, 10);
    if(!raw) return null;
    const t = Date.parse(`${raw}T12:00:00`);
    return Number.isFinite(t) ? t : null;
  }

  function shortDividendDaysBetween(fromDate, toDate = localDateStr()){
    const from = shortDividendDateValue(fromDate);
    const to = shortDividendDateValue(toDate);
    if(!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return Math.max(0, Math.round((to - from) / 86400000));
  }

  function shortDividendHasNumber(value){
    return value !== null
      && value !== undefined
      && String(value).trim() !== ''
      && Number.isFinite(Number(value));
  }

  function getShortDividendStock(symbol){
    const sym = String(symbol || '').trim().toUpperCase();
    if(!sym) return null;
    return (DB.stocks || []).find(stock => String(stock.symbol || '').trim().toUpperCase() === sym) || null;
  }

  function normalizeShortDividendRecord(record = {}){
    const symbol = String(record.symbol || '').trim().toUpperCase();
    const stock = getShortDividendStock(symbol);
    const buyPrice = parseN(record.buyPrice);
    const dividendPerShare = parseN(record.dividendPerShare);
    return {
      id: record.id || uid(),
      symbol,
      name: String(record.name || stock?.name || '').trim(),
      status: record.status || 'planned',
      buyDate: String(record.buyDate || localDateStr()).slice(0, 10),
      buyPrice,
      qty: Math.round(parseN(record.qty)),
      exDate: String(record.exDate || localDateStr()).slice(0, 10),
      dividendPerShare,
      exPrice: shortDividendHasNumber(record.exPrice) ? parseN(record.exPrice) : Math.max(0, buyPrice - dividendPerShare),
      targetPrice: shortDividendHasNumber(record.targetPrice) ? parseN(record.targetPrice) : buyPrice,
      stopPrice: shortDividendHasNumber(record.stopPrice) ? parseN(record.stopPrice) : null,
      maxHoldDays: shortDividendHasNumber(record.maxHoldDays) ? Math.round(parseN(record.maxHoldDays)) : null,
      payDate: String(record.payDate || '').slice(0, 10),
      sellDate: String(record.sellDate || '').slice(0, 10),
      sellPrice: shortDividendHasNumber(record.sellPrice) ? parseN(record.sellPrice) : null,
      fees: shortDividendHasNumber(record.fees) ? Math.round(parseN(record.fees)) : null,
      note: String(record.note || '').trim(),
      createdAt: record.createdAt || nowISO(),
      updatedAt: nowISO()
    };
  }

  function estimateShortDividendCosts(row, sellPrice = null){
    if(shortDividendHasNumber(row.fees)) return Math.round(parseN(row.fees));
    const qty = parseN(row.qty);
    const buyAmt = parseN(row.buyPrice) * qty;
    const sellAmt = (shortDividendHasNumber(sellPrice) ? parseN(sellPrice) : parseN(row.targetPrice)) * qty;
    const buyFee = estimateFee(buyAmt);
    const sellFee = estimateFee(sellAmt);
    const sellTax = Math.round(Math.abs(sellAmt) * 0.003);
    return Math.round(buyFee + sellFee + sellTax);
  }

  function buildShortDividendMetric(row){
    const stock = getShortDividendStock(row.symbol);
    const currentPrice = parseN(stock?.price);
    const hasCurrent = !Number.isNaN(Number(stock?.price)) && Number.isFinite(currentPrice) && currentPrice > 0;
    const nowDate = localDateStr();
    const afterEx = row.exDate && row.exDate <= nowDate;
    const sold = row.status === 'sold' || row.status === 'stopped';
    const effectivePrice = sold && shortDividendHasNumber(row.sellPrice) ? parseN(row.sellPrice) : (hasCurrent ? currentPrice : null);
    const target = parseN(row.targetPrice);
    const exPrice = parseN(row.exPrice);
    const buyPrice = parseN(row.buyPrice);
    const qty = parseN(row.qty);
    const dividendTotal = parseN(row.dividendPerShare) * qty;
    const currentRecovery = shortDividendHasNumber(effectivePrice) && target !== exPrice
      ? Math.max(0, Math.min(1.25, (parseN(effectivePrice) - exPrice) / (target - exPrice)))
      : null;
    const distance = shortDividendHasNumber(effectivePrice) ? target - parseN(effectivePrice) : null;
    const holdDays = shortDividendDaysBetween(row.buyDate, sold && row.sellDate ? row.sellDate : nowDate);
    const exceededDays = shortDividendHasNumber(row.maxHoldDays) && Number.isFinite(holdDays) && holdDays > row.maxHoldDays;
    const stopHit = shortDividendHasNumber(row.stopPrice) && shortDividendHasNumber(effectivePrice) && parseN(effectivePrice) <= parseN(row.stopPrice);
    const ready = afterEx && shortDividendHasNumber(effectivePrice) && parseN(effectivePrice) >= target;
    const costs = estimateShortDividendCosts(row, effectivePrice);
    const pricePnl = shortDividendHasNumber(effectivePrice) ? (parseN(effectivePrice) - buyPrice) * qty : null;
    const netPnl = shortDividendHasNumber(pricePnl) ? pricePnl + dividendTotal - costs : null;
    const invested = buyPrice * qty + costs;
    const annualized = Number.isFinite(netPnl) && invested > 0 && Number.isFinite(holdDays) && holdDays > 0
      ? (netPnl / invested) * (365 / holdDays) * 100
      : null;
    let status = row.status || 'planned';
    if(!sold){
      if(ready) status = 'ready';
      else if(afterEx) status = 'after-ex';
      else if(status !== 'planned') status = 'holding';
    }
    return {
      stock,
      currentPrice: hasCurrent ? currentPrice : null,
      effectivePrice,
      status,
      afterEx,
      ready,
      distance,
      recovery: currentRecovery,
      holdDays,
      exceededDays,
      stopHit,
      dividendTotal,
      costs,
      netPnl,
      annualized,
      quoteTime: stock?.lastPriceAt || ''
    };
  }

  function formatShortDividendPrice(value){
    return shortDividendHasNumber(value) ? fmt2.format(parseN(value)) : '—';
  }

  function formatShortDividendAmount(value){
    if(!shortDividendHasNumber(value)) return '—';
    const n = Math.round(parseN(value));
    return `${n >= 0 ? '+' : '-'}${fmtInt.format(Math.abs(n))}`;
  }

  function formatShortDividendPct(value){
    if(!shortDividendHasNumber(value)) return '—';
    return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
  }

  function shortDividendStatusTag(status){
    const cfg = SHORT_DIVIDEND_STATUS[status] || SHORT_DIVIDEND_STATUS.planned;
    return `<span class="sd-status-tag ${cfg.cls}">${cfg.label}</span>`;
  }

  function buildShortDividendTrack(row, metric){
    const values = [
      { key: 'ex', label: '除息', value: parseN(row.exPrice) },
      { key: 'current', label: '目前', value: metric.effectivePrice },
      { key: 'buy', label: '買入', value: parseN(row.buyPrice) },
      { key: 'sell', label: '賣出', value: row.sellPrice }
    ].filter(item => shortDividendHasNumber(item.value));
    if(values.length < 2) return '<div class="sd-track-empty">價格資料不足</div>';
    const min = Math.min(...values.map(item => parseN(item.value)));
    const max = Math.max(...values.map(item => parseN(item.value)));
    const span = (max - min) || Math.max(1, max * 0.01);
    const pad = span * 0.08;
    const low = min - pad;
    const high = max + pad;
    const pctFor = value => Math.max(0, Math.min(100, ((parseN(value) - low) / (high - low)) * 100));
    const exPct = pctFor(row.exPrice);
    const targetPct = pctFor(row.targetPrice);
    const fillLeft = Math.min(exPct, targetPct);
    const fillWidth = Math.abs(targetPct - exPct);
    const markers = values.map(item => {
      const left = pctFor(item.value);
      return `<span class="sd-marker ${item.key}" style="left:${left.toFixed(2)}%" title="${item.label} ${formatShortDividendPrice(item.value)}"></span>`;
    }).join('');
    return `
      <div class="sd-track" aria-label="除息回補價格軌道">
        <div class="sd-track-line"></div>
        <div class="sd-track-recovery" style="left:${fillLeft.toFixed(2)}%;width:${fillWidth.toFixed(2)}%"></div>
        ${markers}
      </div>
      <div class="sd-track-legend">
        <span><i class="ex"></i>除息 ${formatShortDividendPrice(row.exPrice)}</span>
        <span><i class="current"></i>目前 ${formatShortDividendPrice(metric.effectivePrice)}</span>
        <span><i class="buy"></i>買入 ${formatShortDividendPrice(row.buyPrice)}</span>
        ${shortDividendHasNumber(row.sellPrice) ? `<span><i class="sell"></i>賣出 ${formatShortDividendPrice(row.sellPrice)}</span>` : ''}
      </div>`;
  }

  function getShortDividendRowsForView(){
    const filter = $('#short-dividend-status-filter')?.value || 'active';
    return ensureShortDividendStore()
      .map(row => ({ row: normalizeShortDividendRecord(row), metric: buildShortDividendMetric(normalizeShortDividendRecord(row)) }))
      .filter(item => {
        if(filter === 'all') return true;
        if(filter === 'ready') return item.metric.status === 'ready';
        if(filter === 'closed') return item.metric.status === 'sold' || item.metric.status === 'stopped';
        return item.metric.status !== 'sold' && item.metric.status !== 'stopped';
      })
      .sort((a, b) => {
        const rank = { ready: 0, 'after-ex': 1, holding: 2, planned: 3, stopped: 4, sold: 5 };
        const ar = rank[a.metric.status] ?? 9;
        const br = rank[b.metric.status] ?? 9;
        if(ar !== br) return ar - br;
        return String(a.row.exDate || '').localeCompare(String(b.row.exDate || ''));
      });
  }

  function renderShortDividendSummary(items){
    const el = $('#short-dividend-summary');
    if(!el) return;
    const all = ensureShortDividendStore().map(row => {
      const normalized = normalizeShortDividendRecord(row);
      return { row: normalized, metric: buildShortDividendMetric(normalized) };
    });
    const active = all.filter(item => item.metric.status !== 'sold' && item.metric.status !== 'stopped');
    const invested = active.reduce((sum, item) => sum + parseN(item.row.buyPrice) * parseN(item.row.qty), 0);
    const dividends = active.reduce((sum, item) => sum + item.metric.dividendTotal, 0);
    const ready = active.filter(item => item.metric.status === 'ready').length;
    const risk = active.filter(item => item.metric.exceededDays || item.metric.stopHit).length;
    el.innerHTML = `
      <div class="sd-summary-card"><span>進行中資金</span><strong>${fmtInt.format(Math.round(invested))}</strong></div>
      <div class="sd-summary-card"><span>預估股息</span><strong>${fmtInt.format(Math.round(dividends))}</strong></div>
      <div class="sd-summary-card ok"><span>可賣出</span><strong>${ready}</strong></div>
      <div class="sd-summary-card warn"><span>風險提醒</span><strong>${risk}</strong></div>`;
  }

  function renderShortDividendAlerts(items){
    const el = $('#short-dividend-alerts');
    if(!el) return;
    const alerts = items
      .filter(item => item.metric.exceededDays || item.metric.stopHit || item.metric.status === 'ready')
      .slice(0, 4)
      .map(item => {
        const reasons = [];
        if(item.metric.status === 'ready') reasons.push('已達目標賣出價');
        if(item.metric.stopHit) reasons.push('觸及停損價');
        if(item.metric.exceededDays) reasons.push(`持有超過 ${item.row.maxHoldDays} 天`);
        return `<div class="sd-alert ${item.metric.status === 'ready' ? 'ok' : 'warn'}">${escapeShortDividendHtml(item.row.symbol)}：${escapeShortDividendHtml(reasons.join('、'))}</div>`;
      });
    el.innerHTML = alerts.join('');
  }

  function renderShortDividend(){
    const tbody = $('#tbl-short-dividend tbody');
    if(!tbody) return;
    const items = getShortDividendRowsForView();
    renderShortDividendSummary(items);
    renderShortDividendAlerts(items);
    if(!items.length){
      tbody.innerHTML = '<tr><td colspan="8" class="empty">尚無短期股息投資紀錄</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(({ row, metric }) => {
      const statusHtml = shortDividendStatusTag(metric.status);
      const recoveryPct = Number.isFinite(metric.recovery) ? Math.round(metric.recovery * 100) : null;
      const progressStyle = recoveryPct != null ? `style="--sd-progress:${Math.max(0, Math.min(100, recoveryPct))}%"` : '';
      const distanceText = Number.isFinite(metric.distance)
        ? (metric.distance <= 0 ? '已達標' : `還差 ${formatShortDividendPrice(metric.distance)}`)
        : '缺目前價';
      const netTone = Number.isFinite(metric.netPnl) ? (metric.netPnl >= 0 ? 'pos' : 'neg') : '';
      const riskFlags = [
        metric.stopHit ? '<span class="sd-risk">停損</span>' : '',
        metric.exceededDays ? '<span class="sd-risk">逾期</span>' : ''
      ].filter(Boolean).join('');
      return `
        <tr>
          <td class="text-start">
            <div class="sd-symbol"><strong>${escapeShortDividendHtml(row.symbol || '—')}</strong><span>${escapeShortDividendHtml(row.name || '')}</span></div>
            <div class="sd-row-meta">${statusHtml}${riskFlags}</div>
          </td>
          <td class="num">
            <div class="cell-stack" style="align-items:flex-end">
              <span>${formatShortDividendPrice(row.buyPrice)}</span>
              <span class="mini muted">${escapeShortDividendHtml(row.buyDate)} / 除息 ${escapeShortDividendHtml(row.exDate)}</span>
            </div>
          </td>
          <td class="num">
            <div class="cell-stack" style="align-items:flex-end">
              <span>${formatShortDividendPrice(metric.effectivePrice)}</span>
              <span class="mini muted">目標 ${formatShortDividendPrice(row.targetPrice)}</span>
            </div>
          </td>
          <td>${buildShortDividendTrack(row, metric)}</td>
          <td class="num">
            <div class="sd-progress" ${progressStyle}><span></span></div>
            <div class="mini muted">${recoveryPct == null ? '—' : `${recoveryPct}%`}｜${escapeShortDividendHtml(distanceText)}</div>
          </td>
          <td class="num">
            <div class="cell-stack" style="align-items:flex-end">
              <span class="${netTone}">${formatShortDividendAmount(metric.netPnl)}</span>
              <span class="mini muted">股息 ${fmtInt.format(Math.round(metric.dividendTotal))}｜年化 ${formatShortDividendPct(metric.annualized)}</span>
            </div>
          </td>
          <td class="num">${Number.isFinite(metric.holdDays) ? `${metric.holdDays} 天` : '—'}</td>
          <td class="num">
            <div class="sd-actions">
              <button class="btn mini" type="button" data-action="edit-short-dividend" data-id="${escapeShortDividendHtml(row.id)}">編輯</button>
              <button class="btn mini" type="button" data-action="close-short-dividend" data-id="${escapeShortDividendHtml(row.id)}">賣出</button>
              <button class="btn mini danger" type="button" data-action="delete-short-dividend" data-id="${escapeShortDividendHtml(row.id)}">刪除</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }
  window.renderShortDividend = renderShortDividend;

  function setShortDividendDialogValues(row = null){
    const normalized = row ? normalizeShortDividendRecord(row) : normalizeShortDividendRecord({ status: 'holding' });
    $('#sd-id').value = row?.id || '';
    $('#sd-symbol').value = normalized.symbol || '';
    $('#sd-name').value = normalized.name || '';
    $('#sd-status').value = normalized.status || 'holding';
    $('#sd-buy-date').value = normalized.buyDate || localDateStr();
    $('#sd-buy-price').value = normalized.buyPrice || '';
    $('#sd-qty').value = normalized.qty || '';
    $('#sd-ex-date').value = normalized.exDate || localDateStr();
    $('#sd-dividend-per-share').value = normalized.dividendPerShare || '';
    $('#sd-ex-price').value = shortDividendHasNumber(row?.exPrice) ? normalized.exPrice : '';
    $('#sd-target-price').value = shortDividendHasNumber(row?.targetPrice) ? normalized.targetPrice : '';
    $('#sd-stop-price').value = shortDividendHasNumber(normalized.stopPrice) ? normalized.stopPrice : '';
    $('#sd-max-hold-days').value = shortDividendHasNumber(normalized.maxHoldDays) ? normalized.maxHoldDays : '';
    $('#sd-pay-date').value = normalized.payDate || '';
    $('#sd-sell-date').value = normalized.sellDate || '';
    $('#sd-sell-price').value = shortDividendHasNumber(normalized.sellPrice) ? normalized.sellPrice : '';
    $('#sd-fees').value = shortDividendHasNumber(normalized.fees) ? normalized.fees : '';
    $('#sd-note').value = normalized.note || '';
  }

  function openShortDividendDialog(row = null){
    const dlg = $('#dlg-short-dividend');
    if(!dlg) return;
    $('#dlg-short-dividend-title').textContent = row ? '編輯短期股息投資' : '新增短期股息投資';
    setShortDividendDialogValues(row);
    dlg.showModal();
  }

  function collectShortDividendDialogValues(){
    return normalizeShortDividendRecord({
      id: $('#sd-id').value || uid(),
      symbol: $('#sd-symbol').value,
      name: $('#sd-name').value,
      status: $('#sd-status').value,
      buyDate: $('#sd-buy-date').value,
      buyPrice: $('#sd-buy-price').value,
      qty: $('#sd-qty').value,
      exDate: $('#sd-ex-date').value,
      dividendPerShare: $('#sd-dividend-per-share').value,
      exPrice: $('#sd-ex-price').value,
      targetPrice: $('#sd-target-price').value,
      stopPrice: $('#sd-stop-price').value,
      maxHoldDays: $('#sd-max-hold-days').value,
      payDate: $('#sd-pay-date').value,
      sellDate: $('#sd-sell-date').value,
      sellPrice: $('#sd-sell-price').value,
      fees: $('#sd-fees').value,
      note: $('#sd-note').value,
      createdAt: ensureShortDividendStore().find(row => row.id === $('#sd-id').value)?.createdAt
    });
  }

  function bindShortDividendEvents(){
    $('#btn-add-short-dividend')?.addEventListener('click', () => openShortDividendDialog());
    $('#short-dividend-status-filter')?.addEventListener('change', renderShortDividend);
    $('#sd-symbol')?.addEventListener('change', () => {
      const stock = getShortDividendStock($('#sd-symbol').value);
      if(stock && !$('#sd-name').value) $('#sd-name').value = stock.name || '';
    });
    $('#sd-buy-price')?.addEventListener('input', () => {
      if(!$('#sd-target-price').value) $('#sd-target-price').placeholder = $('#sd-buy-price').value || '預設買進價';
    });
    $('#dlg-short-dividend')?.addEventListener('close', async () => {
      const dlg = $('#dlg-short-dividend');
      if(dlg.returnValue !== 'ok') return;
      const row = collectShortDividendDialogValues();
      if(!row.symbol || !row.buyPrice || !row.qty || !row.exDate || !row.dividendPerShare){
        showBackupStatus('短息紀錄缺少必要欄位', true);
        return;
      }
      const store = ensureShortDividendStore();
      const idx = store.findIndex(item => item.id === row.id);
      if(idx >= 0) store[idx] = row;
      else store.push(row);
      await saveDB();
      renderShortDividend();
      showBackupStatus('短期股息投資紀錄已儲存 ✓');
    });
    $('#tbl-short-dividend')?.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-action]');
      if(!btn) return;
      const id = btn.dataset.id;
      const store = ensureShortDividendStore();
      const row = store.find(item => item.id === id);
      if(!row) return;
      if(btn.dataset.action === 'edit-short-dividend'){
        openShortDividendDialog(row);
        return;
      }
      if(btn.dataset.action === 'close-short-dividend'){
        const normalized = normalizeShortDividendRecord(row);
        const metric = buildShortDividendMetric(normalized);
        normalized.status = 'sold';
        normalized.sellDate = localDateStr();
        normalized.sellPrice = shortDividendHasNumber(metric.currentPrice) ? metric.currentPrice : normalized.targetPrice;
        openShortDividendDialog(normalized);
        return;
      }
      if(btn.dataset.action === 'delete-short-dividend'){
        if(!confirm(`確定刪除 ${row.symbol} 的短期股息紀錄？`)) return;
        DB.meta.shortDividendTrades = store.filter(item => item.id !== id);
        await saveDB();
        renderShortDividend();
        showBackupStatus('短期股息投資紀錄已刪除');
      }
    });
  }

  bindShortDividendEvents();
