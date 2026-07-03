  // ========= 帳戶 =========
  function renderAccounts(){
    const box = $('#accounts-list');
    const cashBox = $('#invest-cash-log');
    const investSelect = $('#invest-log-account');
    const investBtn = $('#btn-add-invest-log');
    if(box){ box.innerHTML=''; }
    if(cashBox){ cashBox.innerHTML=''; }

    const hasAccounts = DB.accounts.length>0;

    if(investSelect){
      const prev = investSelect.value;
      if(!hasAccounts){
        investSelect.innerHTML = '<option value="">尚無帳戶</option>';
        investSelect.disabled = true;
      }else{
        investSelect.innerHTML = DB.accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
        investSelect.disabled = false;
        if(prev && DB.accounts.some(a=>a.id===prev)){ investSelect.value = prev; }
        else{ investSelect.value = DB.accounts[0].id; }
      }
    }
    if(investBtn){ investBtn.disabled = !hasAccounts; }

    const depositLogs = [];
    const initialEntry = ensureInitialCapitalEntry();
    if(initialEntry){
      depositLogs.push({
        account: '起始投入',
        accountId: null,
        time: initialEntry.time || '',
        note: initialEntry.note || '起始投入',
        amount: parseN(initialEntry.amount),
        historyIndex: null,
        source: 'initial'
      });
    }

    // 計算總投資現金
    let totalInvestmentCash = initialEntry ? parseN(initialEntry.amount) : 0;

    for(const a of DB.accounts){
      const available = parseN(a.actual) + parseN(a.settlement);
      const capitalTotal = (a.history||[]).reduce((sum, entry)=>{
        if(entry && (entry.type==='deposit' || entry.type==='withdraw')){
          return sum + parseN(entry.amount);
        }
        return sum;
      }, 0);
      totalInvestmentCash += capitalTotal;
      
      const card = document.createElement('div');
      card.style.cssText = 'flex:1; min-width:200px; padding:16px; background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow);';
      card.innerHTML = `
        <div style="margin-bottom:12px;">
          <div class="brand" style="font-size:20px; font-weight:700; margin-bottom:8px;">${a.name}</div>
          <div style="font-size:18px; font-weight:600; color:#b91c1c; margin-bottom:10px;">可用餘額：${fmtInt.format(Math.round(available))}</div>
          <div class="account-stat">實際：<strong>${fmtInt.format(Math.round(parseN(a.actual)))}</strong></div>
          <div class="account-stat">交割：<strong>${fmtInt.format(Math.round(parseN(a.settlement)))}</strong></div>
          <div class="account-stat">增減資：<strong>${fmtInt.format(Math.round(capitalTotal))}</strong></div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn mini" data-action="edit-account" data-id="${a.id}">編輯</button>
          <button class="btn mini" data-action="capital-change" data-id="${a.id}">增減資</button>
          <button class="btn mini danger" data-action="del-account" data-id="${a.id}">刪除</button>
        </div>`;
      box.appendChild(card);
      (a.history||[]).forEach((entry, idx)=>{
        if(entry && entry.type==='deposit'){
          depositLogs.push({
            account: a.name,
            accountId: a.id,
            time: entry.time || '',
            note: entry.note || '',
            amount: parseN(entry.amount),
            historyIndex: idx,
            source: 'history'
          });
        }
      });
    }

    // 新增總投資現金卡片
    const totalCard = document.createElement('div');
    totalCard.style.cssText = 'flex:1; min-width:200px; padding:16px; background:#e0f2fe; border:1px solid #bae6fd; border-radius:12px; box-shadow:var(--shadow);';
    totalCard.innerHTML = `
      <div style="margin-bottom:12px;">
        <div class="brand" style="font-size:20px; font-weight:700; margin-bottom:8px;">總投資現金</div>
        <div style="font-size:22px; font-weight:700; color:#0369a1; margin-bottom:10px;">${fmtInt.format(Math.round(totalInvestmentCash))}</div>
        <div class="account-stat" style="color:#6b7280;">起始投入 + 各帳戶增減資總和</div>
      </div>`;
    box.appendChild(totalCard);
    if(cashBox){
      if(depositLogs.length===0){
        cashBox.innerHTML = `<div class="empty">尚無投資現金紀錄</div>`;
      }else{
        depositLogs.sort((a,b)=> new Date(b.time||0) - new Date(a.time||0));
        const rows = depositLogs.map(log=>{
          const ts = log.time ? new Date(log.time).toLocaleDateString('zh-TW') : '—';
          const amt = fmtInt.format(Math.round(log.amount));
          const note = log.note || '';
          const isInitial = log.source === 'initial';
          return `<tr>
            <td>${ts}</td>
            <td>${log.account}</td>
            <td class="num">${amt}</td>
            <td>${note}</td>
            <td class="num">
              <button class="btn mini" data-action="edit-invest-log" data-source="${log.source||'history'}" ${isInitial ? '' : `data-account-id="${log.accountId}" data-history-index="${log.historyIndex}"`}>編輯</button>
              ${isInitial ? '' : `<button class="btn mini danger" data-action="del-invest-log" data-source="history" data-account-id="${log.accountId}" data-history-index="${log.historyIndex}">刪除</button>`}
            </td>
          </tr>`;
        }).join('');
        cashBox.innerHTML = `
          <table style="width:100%">
            <thead>
              <tr>
                <th>日期</th>
                <th>帳戶</th>
                <th class="num">投入金額</th>
                <th>備註</th>
                <th class="num">操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`;
      }
    }
  }

