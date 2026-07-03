  // ========= 今日行動面板（彙總各模組警示，不重算口徑）=========
  // 警示來源：holdings（停損停利/技術位置）、分層偏差、現金安全線、預約單彙總。

  function computeCashGovernance(summary = calculatePortfolioSummary()){
    const reservation = (typeof getReservationSummary === 'function') ? getReservationSummary() : { count: 0, buyTotal: 0, items: [] };
    const totalAssets = summary.totalAssets || 0;
    const cashAmount = summary.cashAvailable || 0;
    const cashPct = totalAssets > 0 ? cashAmount / totalAssets * 100 : 0;
    const floorPct = getCashFloorPct();
    const postFillCashAmount = cashAmount - (reservation.buyTotal || 0);
    const postFillCashPct = totalAssets > 0 ? postFillCashAmount / totalAssets * 100 : 0;
    return {
      totalAssets,
      cashAmount,
      cashPct,
      floorPct,
      reservationCount: reservation.count || 0,
      reservationBuyTotal: reservation.buyTotal || 0,
      reservationItems: reservation.items || [],
      postFillCashAmount,
      postFillCashPct
    };
  }

  function collectActionAlerts(summary = calculatePortfolioSummary()){
    const alerts = [];

    // 1. 持股警示（停損 / 停利 / 技術位置）
    try{
      const holdingAlerts = (typeof getHoldingsAlerts === 'function') ? getHoldingsAlerts(summary) : [];
      alerts.push(...holdingAlerts);
    }catch(e){ console.warn('[action-panel] holdings alerts failed', e); }

    // 2. 分層配置偏差
    try{
      const targets = getTierTargets();
      if(targets){
        const alloc = getTierAllocation(summary);
        const pairs = [
          ['core', '核心', alloc.corePct], ['satellite', '衛星', alloc.satellitePct],
          ['flex', '偵查', alloc.flexPct], ['cash', '現金', alloc.cashPct]
        ];
        for(const [key, label, actual] of pairs){
          const diff = actual - targets[key];
          if(Math.abs(diff) > targets.tolerance){
            alerts.push({
              level: 'orange',
              text: `${label}層偏離目標 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%（實際 ${actual.toFixed(1)}% / 目標 ${targets[key]}%，容忍 ±${targets.tolerance}%）`,
              target: '#view-snapshots'
            });
          }
        }
      }
    }catch(e){ console.warn('[action-panel] tier drift failed', e); }

    // 3. 現金安全線
    try{
      const gov = computeCashGovernance(summary);
      if(gov.floorPct != null){
        if(gov.cashPct < gov.floorPct){
          alerts.push({
            level: 'red',
            text: `現金比例 ${gov.cashPct.toFixed(1)}% 已低於安全線 ${gov.floorPct}%，請優先補回現金水位`,
            target: '#view-snapshots'
          });
        }else if(gov.reservationBuyTotal > 0 && gov.postFillCashPct < gov.floorPct){
          alerts.push({
            level: 'red',
            text: `預約單全成交後現金比例將降至 ${gov.postFillCashPct.toFixed(1)}%，跌破安全線 ${gov.floorPct}%（需現金 ${fmtInt.format(Math.round(gov.reservationBuyTotal))}）`,
            target: '#view-watchlist'
          });
        }
      }
      if(gov.reservationCount > 0 && !(gov.floorPct != null && gov.postFillCashPct < gov.floorPct)){
        alerts.push({
          level: 'info',
          text: `預約計畫 ${gov.reservationCount} 筆，全成交需現金 ${fmtInt.format(Math.round(gov.reservationBuyTotal))}（全成交假設）`,
          target: '#view-watchlist'
        });
      }
    }catch(e){ console.warn('[action-panel] cash governance failed', e); }

    return alerts;
  }

  // 個股警示分組定義：性質相同的股票收在同一組，預設收合、點開看明細
  const ACTION_STOCK_GROUPS = [
    { kind: 'stop-loss',        level: 'red',    title: '觸及停損線',          action: '依紀律執行出場檢視' },
    { kind: 'below-month-satellite', level: 'red', title: '跌破月線（衛星層）', action: '檢查 Rule A / 弱席位收割' },
    { kind: 'below-month-flex', level: 'red',    title: '跌破月線（偵查層）',    action: '-5% 黃燈 / -7% 硬停損 / 10 日觀察' },
    { kind: 'rule-a',           level: 'orange', title: 'Rule A 動能衰退收割', action: '連兩日破 MA5 賣 1/3；破 MA10 再賣 1/3' },
    { kind: 'take-profit',      level: 'orange', title: '達停利目標',          action: '評估分批收成' },
    { kind: 'below-month-core', level: 'orange', title: '跌破月線（核心層）',    action: '只列 Battle Plan 回測候選' },
    { kind: 'below-10d',        level: 'orange', title: '跌破 10 日線',        action: '暫停追價、觀察是否止跌' },
  ];

  function renderActionPanel(summary = calculatePortfolioSummary()){
    const host = document.getElementById('action-panel');
    if(!host) return;

    // 保留重繪前已展開的分組（避免報價刷新把使用者點開的組收回去）
    const openKinds = new Set(
      [...host.querySelectorAll('details.action-group[open]')].map(d => d.dataset.kind)
    );

    const alerts = collectActionAlerts(summary);
    const order = { red: 0, orange: 1, info: 2 };

    const grouped = [];
    const rest = [];
    for(const g of ACTION_STOCK_GROUPS){
      const items = alerts.filter(a => a.kind === g.kind);
      if(items.length) grouped.push({ ...g, items });
    }
    for(const a of alerts){
      if(!a.kind) rest.push(a);
    }
    rest.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));

    const headerHtml = `
      <div class="action-panel-head">
        <div class="action-panel-title">今日行動</div>
      </div>`;

    const groupHtml = grouped.map(g => `
      <details class="action-group action-${g.level}" data-kind="${g.kind}"${openKinds.has(g.kind) ? ' open' : ''}>
        <summary>
          <span class="action-dot"></span>
          <span class="action-group-title">${g.title}</span>
          <span class="action-group-action">${g.action}</span>
          <span class="action-count">${g.items.length} 檔</span>
          <span class="action-caret">▸</span>
        </summary>
        <div class="action-group-body">
          ${g.items.map(a => `
            <div class="action-group-row" data-goto="${a.target || ''}" role="button" tabindex="0">
              <span class="action-row-sym">${a.sym}</span>
              <span class="action-row-name">${a.name}</span>
              <span class="action-row-detail">${a.detail || ''}</span>
              <span class="action-go">→</span>
            </div>`).join('')}
        </div>
      </details>`).join('');

    const restHtml = rest.length
      ? `<ul class="action-list">${rest.map(a => `
          <li class="action-item action-${a.level}" data-goto="${a.target || ''}" role="button" tabindex="0">
            <span class="action-dot"></span>
            <span class="action-text">${a.text}</span>
            <span class="action-go">→</span>
          </li>`).join('')}</ul>`
      : '';

    const bodyHtml = (grouped.length || rest.length)
      ? groupHtml + restHtml
      : `<div class="action-empty">今日無待辦警示，按既定計畫執行。</div>`;

    host.innerHTML = headerHtml + bodyHtml;

    host.querySelectorAll('[data-goto]').forEach(item => {
      const go = () => { const t = item.dataset.goto; if(t) gotoView(t); };
      item.addEventListener('click', go);
      item.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } });
    });
  }

  // ========= 分層目標 dialog =========
  function openTierTargetDialog(){
    const dlg = document.getElementById('dlg-tier-target');
    if(!dlg) return;
    const t = getTierTargets() || TIER_TARGET_PRESET;
    const floor = getCashFloorPct() ?? CASH_FLOOR_PRESET_PCT;
    document.getElementById('tier-target-core').value = t.core;
    document.getElementById('tier-target-satellite').value = t.satellite;
    document.getElementById('tier-target-flex').value = t.flex;
    document.getElementById('tier-target-cash').value = t.cash;
    document.getElementById('tier-target-tolerance').value = t.tolerance;
    document.getElementById('tier-target-cash-floor').value = floor;
    dlg.showModal();
  }

  (function bindTierTargetDialog(){
    const dlg = document.getElementById('dlg-tier-target');
    if(!dlg) return;
    dlg.addEventListener('close', async () => {
      if(dlg.returnValue !== 'ok') return;
      const core = parseN(document.getElementById('tier-target-core').value);
      const satellite = parseN(document.getElementById('tier-target-satellite').value);
      const flex = parseN(document.getElementById('tier-target-flex').value);
      const cash = parseN(document.getElementById('tier-target-cash').value);
      const tolerance = parseN(document.getElementById('tier-target-tolerance').value);
      const floor = parseN(document.getElementById('tier-target-cash-floor').value);
      const total = core + satellite + flex + cash;
      if(Math.abs(total - 100) > 0.01){
        alert(`四項比例加總需為 100%（目前 ${total}%）`);
        setTimeout(openTierTargetDialog, 0);
        return;
      }
      await saveTierTargets({ core, satellite, flex, cash, tolerance }, floor);
      const summary = calculatePortfolioSummary();
      if(typeof renderOverview === 'function') renderOverview(summary);
      showBackupStatus('分層目標已儲存 ✓');
    });
    const btn = document.getElementById('btn-edit-tier-target');
    if(btn) btn.addEventListener('click', openTierTargetDialog);
  })();
