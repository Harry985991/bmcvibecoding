  // ========= Dialog：Stock =========
  $('#btn-add-stock').addEventListener('click', ()=> openStockDialog());
  function openStockDialog(stock){
    const dlg = $('#dlg-stock');
    $('#stock-symbol').value = stock?.symbol || '';
    $('#stock-name').value = stock?.name || '';
    $('#stock-market').value = stock?.market || 'TW';
    const acVal = stock?.assetClass || 'Equity';
    $('#stock-class').value = acVal === 'Bond' ? 'BondETF' : acVal;
    $('#stock-price').value = Number.isFinite(parseN(stock?.price))? parseN(stock?.price).toFixed(2): '';
    $('#stock-currency').value = stock?.currency || '';
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => {
      if(dlg.returnValue!=='ok') return;
      const symbol = $('#stock-symbol').value.trim();
      const name = $('#stock-name').value.trim();
      if(!symbol || !name) return;
      const payload = {
        id: stock?.id || uid(),
        symbol, name,
        market: $('#stock-market').value,
        assetClass: $('#stock-class').value,
        price: $('#stock-price').value? parseN($('#stock-price').value): undefined,
        currency: $('#stock-currency').value.trim(),
        lastPriceAt: nowISO()
      };
      if(stock){ Object.assign(stock, payload); }
      else{ DB.stocks.push(payload); }
      persistAndRefresh({
        chrome: true,
        overview: true,
        holdings: true,
        txns: true,
        dividend: true,
        returns: true,
        watchlist: true
      }, {backup:true});
    }, {once:true});
  }

  function openLabelDialog(stockId){
    const stock = DB.stocks.find(s => s.id === stockId);
    if(!stock) return;
    labelDialogStockId = stockId;
    const label = getStockLabel(stockId);
    const dlg = $('#dlg-stock-label');
    $('#label-stock-readonly').textContent = `${stock.symbol} ${stock.name || ''}`.trim();
    const tierVal = normalizeTierValue(label.tier);
    const stratVal = ['hold-for-dividend','tradeable'].includes(label.strategy) ? label.strategy : 'tradeable';
    dlg.querySelectorAll('input[name="label-tier"]').forEach(r => { r.checked = r.value === tierVal; });
    dlg.querySelectorAll('input[name="label-strategy"]').forEach(r => { r.checked = r.value === stratVal; });
    $('#label-stop-loss').value = label.stopLoss != null ? String(label.stopLoss * 100) : '';
    $('#label-stop-profit').value = label.stopProfit != null ? String(label.stopProfit * 100) : '';
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', async () => {
      if(dlg.returnValue !== 'ok'){
        labelDialogStockId = null;
        return;
      }
      const sid = labelDialogStockId;
      labelDialogStockId = null;
      if(!sid) return;
      const tier = normalizeTierValue(dlg.querySelector('input[name="label-tier"]:checked')?.value || 'flex');
      const strategy = dlg.querySelector('input[name="label-strategy"]:checked')?.value || 'tradeable';
      const sl = parseStopLossPercentInput($('#label-stop-loss').value);
      const tp = parseStopProfitPercentInput($('#label-stop-profit').value);
      saveStockLabel(sid, { tier, strategy, stopLoss: sl, stopProfit: tp });
      await persistAndRefresh({
        chrome: true,
        overview: true,
        holdings: true
      }, {backup:true});
    }, {once:true});
  }


  // ========= Dialog：Transaction =========
  function updateTxnDecisionFieldsVisibility(){
    const wrapS = $('#txn-score-wrap');
    const wrapJ = $('#txn-journal-wrap');
    const type = $('#txn-type').value;
    const show = type === 'buy' || type === 'sell';
    if(wrapS) wrapS.style.display = show ? '' : 'none';
    if(wrapJ) wrapJ.style.display = show ? '' : 'none';
  }

  function getTxnDialogStockSortTime(stockId){
    const activeTypes = new Set(['buy', 'sell', 'fee']);
    let latest = Number.NEGATIVE_INFINITY;
    for(const txn of DB.txns || []){
      if(txn?.stockId !== stockId || !activeTypes.has(txn?.type)) continue;
      const ts = new Date(txn.time).getTime();
      if(Number.isFinite(ts) && ts > latest) latest = ts;
    }
    return latest;
  }

  function getTxnDialogSortedStocks(){
    return (DB.stocks || []).slice().sort((a, b) => {
      const aQty = parseN(typeof calcPosition === 'function' ? calcPosition(a.id)?.qty : 0);
      const bQty = parseN(typeof calcPosition === 'function' ? calcPosition(b.id)?.qty : 0);
      const aHeld = Number.isFinite(aQty) && aQty > 0;
      const bHeld = Number.isFinite(bQty) && bQty > 0;
      if(aHeld !== bHeld) return aHeld ? -1 : 1;

      const aTime = getTxnDialogStockSortTime(a.id);
      const bTime = getTxnDialogStockSortTime(b.id);
      if(aTime !== bTime) return bTime - aTime;

      const aSymbol = String(a.symbol || '').trim();
      const bSymbol = String(b.symbol || '').trim();
      return aSymbol.localeCompare(bSymbol, 'zh-Hant', { numeric: true, sensitivity: 'base' });
    });
  }

  function populateTxnStockSelect(selectedStockId){
    const sel = $('#txn-stock');
    const sortedStocks = getTxnDialogSortedStocks();
    sel.replaceChildren(...sortedStocks.map((stock) => {
      const option = document.createElement('option');
      option.value = stock.id;
      option.textContent = `${stock.symbol} · ${stock.name || ''}`;
      return option;
    }));
    if(selectedStockId && sortedStocks.some(s => s.id === selectedStockId)){
      sel.value = selectedStockId;
    } else if(sortedStocks[0]){
      sel.value = sortedStocks[0].id;
    }
    return sortedStocks;
  }

  const openTxnDialog = (txn) =>{
    const dlg = $('#dlg-txn');
    document.querySelectorAll('.txn-score-preload-hint').forEach(el => el.remove());
    if(txnScoreDashboardHintTimer){
      clearTimeout(txnScoreDashboardHintTimer);
      txnScoreDashboardHintTimer = null;
    }

    if(DB.stocks.length===0){ alert('請先新增標的'); return; }
    const sortedStocks = populateTxnStockSelect(txn?.stockId);

    if(!$('#txn-stock').value && sortedStocks[0]) $('#txn-stock').value = sortedStocks[0].id;
    $('#txn-account').value = txn?.account || 'ctbc';
    $('#txn-type').value = txn?.type || 'buy';
    $('#txn-price').value = Number.isFinite(parseN(txn?.price))? parseN(txn?.price).toFixed(2): '';
    $('#txn-qty').value = Number.isFinite(parseN(txn?.qty))? parseN(txn?.qty).toFixed(2): '';
    $('#txn-amount').value = Number.isFinite(parseN(txn?.amount))? Math.round(parseN(txn?.amount)) : '';
    $('#txn-time').value = txn? new Date(txn.time).toISOString().slice(0,16) : new Date().toISOString().slice(0,16);
    $('#txn-note').value = txn?.note ?? '';

    if(txn){
      const es = txn.decisionScore;
      $('#txn-score').value = (es != null && es !== '' && Number.isFinite(Number(es)))
        ? String(Math.max(-5, Math.min(5, parseInt(es, 10))))
        : '';
      $('#txn-journal').value = (txn.journalNote ?? '').slice(0, 200);
    } else {
      $('#txn-journal').value = '';
      $('#txn-score').value = '';
      const pre = tryPreloadTodayScore();
      if(pre != null && Number.isFinite(pre)){
        const clamped = Math.max(-5, Math.min(5, Math.round(pre)));
        const inp = $('#txn-score');
        inp.value = String(clamped);
        const hint = document.createElement('span');
        hint.className = 'txn-score-preload-hint';
        hint.textContent = '（已從儀表板帶入）';
        hint.style.cssText = 'font-size:10px;color:var(--sub);margin-left:6px';
        inp.insertAdjacentElement('afterend', hint);
        txnScoreDashboardHintTimer = setTimeout(() => {
          hint.remove();
          txnScoreDashboardHintTimer = null;
        }, 5000);
      }
    }

    const recalc = ()=>{
      const type = $('#txn-type').value;
      const price = parseN($('#txn-price').value);
      const qty = parseN($('#txn-qty').value);
      if(type==='dividend') return;
      $('#txn-amount').value = Math.round(price*qty) || '';
    };
    const onTypeChange = ()=>{
      recalc();
      updateTxnDecisionFieldsVisibility();
    };
    $('#txn-price').oninput = recalc;
    $('#txn-qty').oninput = recalc;
    $('#txn-type').onchange = onTypeChange;
    updateTxnDecisionFieldsVisibility();

    dlg.returnValue=''; dlg.showModal();
    dlg.addEventListener('close', ()=>{
      if(dlg.returnValue!=='ok') return;
      const typ = $('#txn-type').value;
      let decisionScore = null;
      let journalNote = '';
      if(typ === 'buy' || typ === 'sell'){
        const scoreRaw = $('#txn-score').value;
        decisionScore = (scoreRaw !== '' && !Number.isNaN(parseInt(scoreRaw, 10)))
          ? Math.max(-5, Math.min(5, parseInt(scoreRaw, 10)))
          : null;
        journalNote = $('#txn-journal').value.trim().slice(0, 200);
      }
      const t = {
        id: txn?.id || uid(),
        stockId: $('#txn-stock').value,
        account: $('#txn-account').value,
        type: typ,
        price: $('#txn-price').value? parseN($('#txn-price').value): undefined,
        qty: $('#txn-qty').value? parseN($('#txn-qty').value): undefined,
        amount: $('#txn-amount').value? parseN($('#txn-amount').value): undefined,
        time: new Date($('#txn-time').value).toISOString(),
        note: $('#txn-note').value.trim(),
        decisionScore: typ === 'buy' || typ === 'sell' ? decisionScore : null,
        journalNote: typ === 'buy' || typ === 'sell' ? journalNote : '',
      };
      if(txn){ Object.assign(txn, t); }
      else{ DB.txns.push(t); }
      // 若此交易來自投資筆記的「轉為交易」
      const fromWatchId = txn?._fromWatchId ?? null;
      if(!txn && fromWatchId){
        ensureWatchlist();
        const wi = (DB.watchlist || []).find(x => x.id === fromWatchId);
        if(wi){
          wi.status = 'done';
          wi.executedTxnId = t.id;
        }
      }
      persistAndRefresh({
        chrome: true,
        overview: true,
        holdings: true,
        txns: true,
        dividend: true,
        returns: true,
        snapshots: true,
        watchlist: true
      }, {backup:true});
    }, {once:true});
  };
  $('#btn-add-txn').addEventListener('click', ()=> openTxnDialog());
  $('#btn-add-txn-2').addEventListener('click', ()=> openTxnDialog());

  $('#tbl-txns').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.dataset.id; const action = btn.dataset.action;
    const txn = DB.txns.find(x=>x.id===id);
    if(action==='edit-txn') openTxnDialog(txn);
    if(action==='del-txn'){
      if(confirm('確定刪除此筆異動？')){
        DB.txns = DB.txns.filter(x=>x.id!==id);
        persistAndRefresh({
          chrome: true,
          overview: true,
          holdings: true,
          txns: true,
          dividend: true,
          returns: true,
          snapshots: true,
          watchlist: true
        }, {backup:true});
      }
    }
  });


  // ========= 帳戶 Dialog =========
  function openAccountDialog(acct){
    const dlg = $('#dlg-account');
    $('#acct-name').value = acct?.name || '';
    $('#acct-actual').value = Number.isFinite(parseN(acct?.actual))? Math.round(parseN(acct?.actual)) : '';
    $('#acct-settle').value = Number.isFinite(parseN(acct?.settlement))? Math.round(parseN(acct?.settlement)) : '';
    $('#acct-note').value = acct?.note || '';

    dlg.returnValue=''; dlg.showModal();
    dlg.addEventListener('close', ()=>{
      if(dlg.returnValue!=='ok') return;
      const payload = {
        id: acct?.id || uid(),
        name: $('#acct-name').value.trim(),
        actual: Math.round(parseN($('#acct-actual').value)),
        settlement: Math.round(parseN($('#acct-settle').value)),
        note: $('#acct-note').value.trim(),
        history: acct?.history || []
      };
      if(acct){ Object.assign(acct, payload); }
      else{
        DB.accounts.push(payload);
      }
      persistAndRefresh({
        chrome: true,
        overview: true,
        accounts: true,
        returns: true,
        snapshots: true
      }, {backup:true});
    }, {once:true});
  }

  function openCapitalDialog(acct, historyIndex, options = {}){
    const isInitial = !!options.initial;
    if(!acct && !isInitial) return;
    const dlg = $('#dlg-capital');
    const typeInput = $('#cap-type');
    const amountInput = $('#cap-amount');
    const dateInput = $('#cap-date');
    const noteInput = $('#cap-note');
    const depositOnly = !!options.depositOnly || isInitial;
    const toLocalInput = (date) => {
      const dt = (date instanceof Date) ? date : new Date(date);
      if(isNaN(dt.valueOf())) return '';
      return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
    };

    const entries = isInitial ? [ensureInitialCapitalEntry()] : (acct.history || []);
    const idx = isInitial ? 0 : (Number.isInteger(historyIndex) ? historyIndex : null);
    const isEdit = isInitial || (idx !== null && entries[idx]);
    let originalAmount = 0;
    let originalType = null;

    if(isEdit){
      const entry = entries[idx];
      originalAmount = parseN(entry.amount);
      originalType = entry.type;
      const normalizedType = entry.type === 'withdraw' ? 'withdraw' : 'deposit';
      typeInput.value = depositOnly ? 'deposit' : normalizedType;
      amountInput.value = Math.abs(parseN(entry.amount)) || '';
      noteInput.value = entry.note || '';
      dateInput.value = entry.time ? toLocalInput(entry.time) : toLocalInput(new Date());
    }else{
      typeInput.value = 'deposit';
      amountInput.value = '';
      noteInput.value = '';
      dateInput.value = toLocalInput(new Date());
    }
    typeInput.disabled = depositOnly;

    dlg.returnValue = '';
    const onClose = ()=>{
      if(dlg.returnValue !== 'ok') return;
      const amount = Math.round(Math.abs(parseN(amountInput.value)));
      if(!amount){ alert('請輸入金額'); return; }
      const type = depositOnly ? 'deposit' : (typeInput.value === 'withdraw' ? 'withdraw' : 'deposit');
      const note = noteInput.value.trim();
      const dateVal = dateInput.value;
      let time = nowISO();
      if(dateVal){
        const dt = new Date(dateVal);
        if(!isNaN(dt.valueOf())){
          time = dt.toISOString();
        }
      }
      const signedAmount = type === 'withdraw' ? -amount : amount;

      if(isInitial){
        const entry = ensureInitialCapitalEntry();
        entry.amount = signedAmount;
        entry.note = note || '起始投入';
        entry.time = time;
      }else if(isEdit){
        if(originalType === 'deposit' || originalType === 'withdraw'){
          acct.actual = Math.round(parseN(acct.actual) - originalAmount);
        }
        if(type === 'deposit' || type === 'withdraw'){
          acct.actual = Math.round(parseN(acct.actual) + signedAmount);
        }
        Object.assign(entries[idx], { time, type, amount: signedAmount, note });
      }else{
        if(type === 'deposit' || type === 'withdraw'){
          acct.actual = Math.round(parseN(acct.actual) + signedAmount);
        }
        acct.history = acct.history || [];
        acct.history.push({ time, type, amount: signedAmount, note });
      }
      persistAndRefresh({
        chrome: true,
        overview: true,
        accounts: true,
        returns: true,
        snapshots: true
      }, {backup:true});
    };
    dlg.addEventListener('close', onClose, {once:true});
    dlg.showModal();
  }

  $('#accounts-list').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.dataset.id; const action = btn.dataset.action;
    const acct = DB.accounts.find(a=>a.id===id);
    if(action==='edit-account') openAccountDialog(acct);
    if(action==='capital-change') openCapitalDialog(acct);
    if(action==='edit-history'){
      const historyIndex = Number(btn.dataset.historyIndex);
      if(Number.isInteger(historyIndex)) openCapitalDialog(acct, historyIndex);
    }
    if(action==='del-history'){
      const historyIndex = Number(btn.dataset.historyIndex);
      if(Number.isInteger(historyIndex) && acct && acct.history && acct.history[historyIndex]){
        if(confirm('確定刪除此筆紀錄？')){
          const entry = acct.history[historyIndex];
          if(entry && (entry.type==='deposit' || entry.type==='withdraw')){
            acct.actual = Math.round(parseN(acct.actual) - parseN(entry.amount));
          }
          acct.history.splice(historyIndex, 1);
          persistAndRefresh({
            chrome: true,
            overview: true,
            accounts: true,
            returns: true,
            snapshots: true
          }, {backup:true});
        }
      }
    }
    if(action==='del-account'){
      if(confirm('確定刪除此帳戶？')){
        DB.accounts = DB.accounts.filter(a=>a.id!==id);
        persistAndRefresh({
          chrome: true,
          overview: true,
          accounts: true,
          returns: true,
          snapshots: true
        }, {backup:true});
      }
    }
  });

  const investAddBtn = $('#btn-add-invest-log');
  if(investAddBtn){
    investAddBtn.addEventListener('click', ()=>{
      if(DB.accounts.length===0){ alert('請先新增帳戶'); return; }
      const select = $('#invest-log-account');
      const targetId = select && select.value ? select.value : (DB.accounts[0]?.id);
      const acct = DB.accounts.find(a=>a.id===targetId);
      if(!acct){ alert('請先新增帳戶'); return; }
      openCapitalDialog(acct);
    });
  }

  const investLogBox = $('#invest-cash-log');
  if(investLogBox){
    investLogBox.addEventListener('click', (e)=>{
      const btn = e.target.closest('button'); if(!btn) return;
      const action = btn.dataset.action;
      if(action!=='edit-invest-log' && action!=='del-invest-log') return;
      const source = btn.dataset.source || 'history';
      if(source === 'initial'){
        if(action==='edit-invest-log'){
          openCapitalDialog(null, null, { initial: true });
        }
        return;
      }
      const accountId = btn.dataset.accountId;
      const historyIndex = Number(btn.dataset.historyIndex);
      const acct = DB.accounts.find(a=>a.id===accountId);
      if(!acct || !Number.isInteger(historyIndex)) return;
      if(action==='edit-invest-log'){
        openCapitalDialog(acct, historyIndex);
      }
      if(action==='del-invest-log'){
        if(confirm('確定刪除此筆投資紀錄？')){
          const entry = acct.history && acct.history[historyIndex];
          if(entry && entry.type==='deposit'){
            acct.actual = Math.round(parseN(acct.actual) - parseN(entry.amount));
            acct.history.splice(historyIndex, 1);
            persistAndRefresh({
              chrome: true,
              overview: true,
              accounts: true,
              returns: true,
              snapshots: true
            }, {backup:true});
          }
        }
      }
    });
  }

  // ========= 資產成果：新增/編輯 =========
  const btnAddSnapshot = $('#btn-add-snapshot');
  if(btnAddSnapshot) btnAddSnapshot.addEventListener('click', ()=> openSnapshotDialog());
  function openSnapshotDialog(snapshot){
    const dlg = $('#dlg-snapshot');
    
    const summary = calculatePortfolioSummary();
    const currentHoldings = summary.holdingsMarketValue;
    const currentCash = summary.cashAvailable;
    const currentTotal = summary.totalAssets;
    
    $('#snapshot-date').value = snapshot?.date || localDateStr();
    $('#snapshot-holdings').value = snapshot ? Math.round(parseN(snapshot.holdings)) : Math.round(currentHoldings);
    $('#snapshot-cash').value = snapshot ? Math.round(parseN(snapshot.cash)) : Math.round(currentCash);
    $('#snapshot-total').value = Math.round(currentTotal);
    $('#snapshot-note').value = snapshot?.note || '';
    
    // 即時計算總資產
    const updateTotal = () => {
      const holdings = parseN($('#snapshot-holdings').value) || 0;
      const cash = parseN($('#snapshot-cash').value) || 0;
      $('#snapshot-total').value = Math.round(holdings + cash);
    };
    
    $('#snapshot-holdings').addEventListener('input', updateTotal);
    $('#snapshot-cash').addEventListener('input', updateTotal);
    
    dlg.returnValue=''; dlg.showModal();
    dlg.addEventListener('close', ()=>{
      if(dlg.returnValue!=='ok') return;
      const date = $('#snapshot-date').value;
      const holdings = Math.round(parseN($('#snapshot-holdings').value));
      const cash = Math.round(parseN($('#snapshot-cash').value));
      const total = holdings + cash;
      const note = $('#snapshot-note').value.trim();
      const prev = getRenderableSnapshots().filter(s=>s.date<date).sort((a,b)=> a.date<b.date?1:-1)[0];
      const deltaAmt = prev? total - prev.total : 0;
      const deltaPct = prev? (deltaAmt / (prev.total||1)) : 0;
      const investedCapitalToDate = getInitialCapitalAmount() + sumCapitalAdjustments(date);
      const returnAmount = Math.round(total - investedCapitalToDate);
      const record = {date, holdings, cash, total, returnAmount, deltaAmt, deltaPct, note};
      const idx = DB.snapshots.findIndex(s=>s.date===date);
      if(idx>=0) DB.snapshots[idx]=record; else DB.snapshots.push(record);
      persistAndRefresh({
        chrome: true,
        overview: true,
        holdings: true,
        txns: true,
        dividend: true,
        returns: true,
        snapshots: true
      }, {backup:true});
    }, {once:true});
  }
  const snapshotTable = $('#tbl-snapshots');
  if(snapshotTable){
    snapshotTable.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action]'); if(!btn) return;
      e.preventDefault();
      const action = btn.dataset.action === 'del-snapshot' ? 'delete' : 'edit';
      handleSnapshotAction(action, btn.dataset.id);
    });
  }

  function sampleData(){
    const s1 = {id:uid(), symbol:'0050', name:'元大台灣50', market:'TW', assetClass:'Equity', price:150, currency:'TWD', lastPriceAt: nowISO()};
    const s2 = {id:uid(), symbol:'VTI', name:'Vanguard Total Stock', market:'Global', assetClass:'Equity', price:2600, currency:'TWD', lastPriceAt: nowISO()};
    const s3 = {id:uid(), symbol:'00687B', name:'國泰20年美債', market:'TW', assetClass:'Bond', price:33.5, currency:'TWD', lastPriceAt: nowISO()};
    const t0 = new Date();
    const tx = [
      {id:uid(), stockId:s1.id, type:'buy', price:140, qty:100, time:new Date(t0-86400000*20).toISOString(), note:'分批買入'},
      {id:uid(), stockId:s1.id, type:'buy', price:155, qty:50, time:new Date(t0-86400000*10).toISOString()},
      {id:uid(), stockId:s1.id, type:'dividend', amount:800, time:new Date(t0-86400000*5).toISOString(), note:'季配息'},
      {id:uid(), stockId:s2.id, type:'buy', price:2500, qty:2, time:new Date(t0-86400000*18).toISOString()},
      {id:uid(), stockId:s2.id, type:'buy', price:2550, qty:1, time:new Date(t0-86400000*7).toISOString()},
      {id:uid(), stockId:s3.id, type:'buy', price:32.8, qty:100, time:new Date(t0-86400000*14).toISOString()},
      {id:uid(), stockId:s3.id, type:'sell', price:33.2, qty:20, time:new Date(t0-86400000*3).toISOString(), note:'調節'}
    ];
    const a1 = {id:uid(), name:'券商一', actual: 200000, settlement: -15000, note:'主要交易', history:[{time:nowISO(), type:'deposit', amount:200000, note:'初始'}]};
    const a2 = {id:uid(), name:'券商二', actual: 80000, settlement: 0, note:'備用', history:[{time:nowISO(), type:'deposit', amount:80000}]};
    const snapshots = [];
    return {stocks:[s1,s2,s3], txns:tx, accounts:[a1,a2], snapshots};
  }


  // ========= 歷史記錄編輯 Dialog =========
  // ========= 歷史記錄編輯 Dialog =========
  function openHistoryEditDialog(account, historyItem){
    const dlg = document.createElement('div'); dlg.className='dialog';
    dlg.innerHTML = `
      <div class="content">
        <div class="header">
          <div class="title">編輯歷史記錄</div>
          <button class="close">&times;</button>
        </div>
        <div class="body">
          <div class="field"><label>時間</label><input id="hist-time" type="datetime-local" /></div>
          <div class="field"><label>類型</label>
            <select id="hist-type">
              <option value="deposit">存款</option>
              <option value="withdraw">提款</option>
              <option value="settlement">交割</option>
            </select>
          </div>
          <div class="field"><label>金額</label><input id="hist-amount" type="number" step="1" /></div>
          <div class="field"><label>備註</label><input id="hist-note" /></div>
        </div>
        <div class="footer">
          <button class="btn" id="hist-save">儲存</button>
          <button class="btn secondary" id="hist-cancel">取消</button>
        </div>
      </div>
    `;
    
    // 填充現有數據
    const timeInput = dlg.querySelector('#hist-time');
    const date = new Date(historyItem.time);
    timeInput.value = date.toISOString().slice(0, 16);
    dlg.querySelector('#hist-type').value = historyItem.type;
    dlg.querySelector('#hist-amount').value = Math.round(parseN(historyItem.amount));
    dlg.querySelector('#hist-note').value = historyItem.note || '';
    
    document.body.appendChild(dlg);
    
    // 事件處理
    dlg.querySelector('.close, #hist-cancel').onclick = ()=> dlg.remove();
    dlg.querySelector('#hist-save').onclick = ()=>{
      const time = dlg.querySelector('#hist-time').value;
      const type = dlg.querySelector('#hist-type').value;
      const amount = Math.round(parseN(dlg.querySelector('#hist-amount').value));
      const note = dlg.querySelector('#hist-note').value.trim();
      
      if(!time || !type || !Number.isFinite(amount)){
        alert('請填寫完整資訊');
        return;
      }
      
      // 更新歷史記錄
      Object.assign(historyItem, {
        time: new Date(time).toISOString(),
        type,
        amount,
        note
      });
      
      persistAndRefresh({
        chrome: true,
        overview: true,
        holdings: true,
        txns: true,
        accounts: true,
        dividend: true,
        returns: true,
        snapshots: true,
        watchlist: true
      }, {backup:true});
      dlg.remove();
    };
  };
