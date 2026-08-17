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

  // ========= 投資導航（目標、進度、階段、每日行動與檢討）=========
  function navigatorEscapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function navigatorTaipeiDate(iso){
    const date = new Date(iso);
    if(Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function navigatorLatestDate(values){
    return (values || []).filter(Boolean).map(String).sort().at(-1) || '';
  }

  function navigatorFormatPrice(value){
    const price = Number(value);
    return Number.isFinite(price)
      ? price.toLocaleString('zh-TW', { maximumFractionDigits: 2 })
      : '—';
  }

  function getNavigatorDataHealth(summary){
    let healthClass = 'ok';
    let healthText = '資料健康';
    try{
      if(typeof buildDataHealthViewModel === 'function'){
        const vm = buildDataHealthViewModel(summary);
        healthClass = vm.statusClass || 'ok';
        healthText = vm.statusText === '健康' ? '資料健康' : vm.statusText;
      }
    }catch(e){ console.warn('[action-panel] navigator data health failed', e); }

    const latestQuoteIso = (summary.quoteTimes || [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .at(-1) || '';
    const quoteDate = navigatorTaipeiDate(latestQuoteIso);
    const snapshotDate = navigatorLatestDate((DB.snapshots || []).map(row => row?.date));
    const archiveDate = navigatorLatestDate(Object.keys(DB.meta?.dailyArchive || {}));
    const hasAllDates = !!(quoteDate && snapshotDate && archiveDate);
    const datesAligned = hasAllDates && quoteDate === snapshotDate && snapshotDate === archiveDate;

    let status = 'OK';
    let statusLabel = 'OK';
    let note = `報價、快照與封存對齊 ${quoteDate || '—'}`;
    if(healthClass === 'error'){
      status = 'BLOCKED';
      statusLabel = 'BLOCKED';
      note = `${healthText}，先處理資料問題再判讀`;
    }else if(healthClass === 'warn' || !datesAligned){
      status = 'WAIT';
      statusLabel = 'WAIT';
      note = hasAllDates
        ? `日期未對齊：報價 ${quoteDate}／快照 ${snapshotDate}／封存 ${archiveDate}`
        : '報價、快照或封存日期不足';
    }

    return { status, statusLabel, note, quoteDate, snapshotDate, archiveDate };
  }

  function getNavigatorJournalPlan(){
    const store = DB.meta?.tradeJournals;
    const today = localDateStr();
    if(!store || typeof store !== 'object' || Array.isArray(store)){
      return { date: today, rows: [], isFuture: false };
    }
    const todayRows = Array.isArray(store[today]) ? store[today] : [];
    const todayHasPending = todayRows.some(row => row?.status === 'planned');
    if(todayHasPending) return { date: today, rows: todayRows, isFuture: false };

    const futureDate = Object.keys(store)
      .filter(date => date > today && Array.isArray(store[date]) && store[date].some(row => row?.status === 'planned'))
      .sort()[0];
    if(futureDate) return { date: futureDate, rows: store[futureDate], isFuture: true };
    if(todayRows.length) return { date: today, rows: todayRows, isFuture: false };
    return { date: today, rows: [], isFuture: false };
  }

  function getNavigatorPhase(alloc, targets, health){
    if(health.status !== 'OK'){
      return {
        code: 'data-wait',
        label: '資料待確認',
        summary: '資料未對齊前暫停產生新動作',
        nextAction: '先完成資料更新與對帳；資料恢復 OK 前維持 WAIT。'
      };
    }
    if(alloc.cashPct + 0.05 < targets.cash){
      return {
        code: 'cash-rebuild',
        label: '階段一：建立現金',
        summary: `現金 ${alloc.cashPct.toFixed(1)}%／${targets.cash}%`,
        nextAction: `所有減碼款先留在現金池；現金達 ${targets.cash}% 前，不新增其他核心或衛星買單。`
      };
    }
    if(alloc.satellitePct > targets.satellite + 0.05 || alloc.flexPct > targets.flex + 0.05){
      return {
        code: 'reduce-noncore',
        label: '階段二：降低非核心',
        summary: '現金已達安全線，處理衛星與偵查超額',
        nextAction: '依信念與不可取代性分批處理超額部位，不因跌深直接補回。'
      };
    }
    if(alloc.corePct + 0.05 < targets.core){
      return {
        code: 'build-core',
        label: '階段三：補足核心',
        summary: `核心 ${alloc.corePct.toFixed(1)}%／${targets.core}%`,
        nextAction: `只動用超過 ${targets.cash}% 現金安全線的資金，分批補足核心。`
      };
    }
    return {
      code: 'maintain',
      label: '配置到位：維持',
      summary: '四區配置已接近目標',
      nextAction: '維持配置；沒有符合條件的交易就 WAIT。'
    };
  }

  function renderNavigatorAllocationRows(alloc, targets){
    const rows = [
      { key: 'core', label: '核心', actualPct: alloc.corePct, actualMv: alloc.coreMv },
      { key: 'satellite', label: '衛星', actualPct: alloc.satellitePct, actualMv: alloc.satelliteMv },
      { key: 'flex', label: '偵查／策略外', actualPct: alloc.flexPct, actualMv: alloc.flexMv },
      { key: 'cash', label: '現金', actualPct: alloc.cashPct, actualMv: alloc.cashMv }
    ];
    return rows.map(row => {
      const targetPct = parseN(targets[row.key]);
      const gapAmount = (alloc.total * targetPct / 100) - row.actualMv;
      const gapText = Math.abs(gapAmount) < 1
        ? '已到位'
        : `${gapAmount > 0 ? '待增加' : '待降低'} ${fmtInt.format(Math.round(Math.abs(gapAmount)))} 元`;
      const tone = Math.abs(row.actualPct - targetPct) <= 0.1 ? 'ok' : (gapAmount > 0 ? 'under' : 'over');
      const width = Math.min(100, targetPct > 0 ? row.actualPct / targetPct * 100 : 100);
      return `<div class="navigator-alloc-row ${tone}">
        <div class="navigator-alloc-head">
          <span class="navigator-alloc-label">${row.label}</span>
          <span class="navigator-alloc-values"><strong>${row.actualPct.toFixed(1)}%</strong><span>／目標 ${targetPct}%</span></span>
        </div>
        <div class="navigator-progress"><span style="width:${width.toFixed(1)}%"></span></div>
        <div class="navigator-gap">${gapText}</div>
      </div>`;
    }).join('');
  }

  function renderNavigatorOrders(plan){
    const statusMap = {
      planned: ['預約中', 'planned'], filled: ['成交', 'filled'],
      cancelled: ['取消', 'cancelled'], expired: ['未成交', 'expired']
    };
    if(!plan.rows.length){
      return '<div class="navigator-empty">目前沒有今日或下一交易日預約單；沒有條件就 WAIT。</div>';
    }
    return `<div class="navigator-orders" data-goto="#view-trade-journal" role="button" tabindex="0">
      ${plan.rows.map(row => {
        const status = statusMap[row.status] || statusMap.planned;
        const sideLabel = row.side === 'sell' ? '賣出' : '買進';
        const isFilled = row.status === 'filled';
        const hasValue = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
        const displayQty = isFilled && hasValue(row.actualQty) ? row.actualQty : row.plannedQty;
        const displayPrice = isFilled && hasValue(row.actualPrice) ? row.actualPrice : row.plannedPrice;
        const qty = hasValue(displayQty) ? `${fmtInt.format(Number(displayQty))} 股` : '—';
        const price = hasValue(displayPrice) ? `${navigatorFormatPrice(displayPrice)} 元` : '—';
        const priceKind = isFilled ? '成交' : '計畫';
        return `<div class="navigator-order-row">
          <span class="navigator-order-side ${row.side === 'sell' ? 'sell' : 'buy'}">${sideLabel}</span>
          <strong>${navigatorEscapeHtml(row.symbol || '—')}</strong>
          <span>${navigatorEscapeHtml(row.name || '')}</span>
          <span>${qty}＠${price}（${priceKind}）</span>
          <span class="navigator-order-condition">${navigatorEscapeHtml(row.condition || '')}</span>
          <span class="navigator-order-status ${status[1]}">${status[0]}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  function buildNavigatorModel(summary){
    const targets = getTierTargets() || TIER_TARGET_PRESET;
    const alloc = getTierAllocation(summary);
    const health = getNavigatorDataHealth(summary);
    const plan = getNavigatorJournalPlan();
    const phase = getNavigatorPhase(alloc, targets, health);
    const plannedRows = plan.rows.filter(row => row?.status === 'planned');
    const guardrails = [];
    if(health.status !== 'OK') guardrails.push('資料恢復 OK 前不新增決策，維持 WAIT');
    if(alloc.cashPct + 0.05 < targets.cash) guardrails.push('減碼款先留現金，不新增其他買單');
    if(alloc.flexPct > targets.flex + 0.05) guardrails.push('偵查／策略外超標，不再新增非核心部位');
    if(plannedRows.some(row => String(row.symbol) === '6510')) guardrails.push('既有 6510 條件單依原條件，不追價、不追加');
    if(!guardrails.length) guardrails.push('遵守既定配置；沒有符合條件的交易就 WAIT');
    return { targets, alloc, health, plan, phase, plannedRows, guardrails };
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

    const navigator = buildNavigatorModel(summary);
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
        <div>
          <div class="action-panel-title">投資導航</div>
          <div class="navigator-data-note">資料日 ${navigator.health.quoteDate || '—'}｜快照 ${navigator.health.snapshotDate || '—'}｜封存 ${navigator.health.archiveDate || '—'}</div>
        </div>
        <span class="navigator-health navigator-health-${navigator.health.status.toLowerCase()}">${navigator.health.statusLabel}</span>
      </div>`;

    const phaseHtml = `<div class="navigator-phase navigator-phase-${navigator.phase.code}">
      <div>
        <div class="navigator-phase-label">${navigator.phase.label}</div>
        <div class="navigator-phase-summary">${navigator.phase.summary}</div>
      </div>
      <div class="navigator-phase-next"><span>下一步</span>${navigatorEscapeHtml(navigator.phase.nextAction)}</div>
    </div>`;

    const allocationHtml = `<div class="navigator-section">
      <div class="navigator-section-title">配置進度</div>
      <div class="navigator-allocation-grid">${renderNavigatorAllocationRows(navigator.alloc, navigator.targets)}</div>
    </div>`;

    const planLabel = navigator.plan.isFuture ? `下一交易日 ${navigator.plan.date}` : `今日行動 ${navigator.plan.date}`;
    const ordersHtml = `<div class="navigator-section">
      <div class="navigator-section-head">
        <div class="navigator-section-title">${planLabel}</div>
        <button class="navigator-link" type="button" data-goto="#view-trade-journal">開啟交易日誌 →</button>
      </div>
      ${renderNavigatorOrders(navigator.plan)}
    </div>`;

    const reviewText = navigator.plannedRows.length
      ? `收盤後回填 ${navigator.plannedRows.length} 筆成交結果，確認現金比例與配置差距；未成交不追價。`
      : '目前沒有待回填的預約單；收盤後只需確認配置與資料日期。';
    const disciplineHtml = `<div class="navigator-two-col">
      <div class="navigator-discipline">
        <div class="navigator-section-title">今天不要做</div>
        <ul>${navigator.guardrails.map(item => `<li>${navigatorEscapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="navigator-review">
        <div class="navigator-section-title">收盤檢討</div>
        <p>${navigatorEscapeHtml(reviewText)}</p>
      </div>
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

    const alertsHtml = `<div class="navigator-alerts">
      <div class="navigator-section-title">今日警示</div>
      ${bodyHtml}
    </div>`;

    host.innerHTML = headerHtml + phaseHtml + allocationHtml + ordersHtml + disciplineHtml + alertsHtml;

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
