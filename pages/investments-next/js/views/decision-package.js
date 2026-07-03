  // ========= Buffett 決策資料包 =========
  // 一鍵組裝：持倉現況 + 各持股當日(前一交易日) OHLCV + 現金治理 + 預約單計畫 + vnext 美股數字。
  // 產生時自動存入 meta.decisionPackages（每日一筆，同日覆寫），供「決策紀錄」回查。
  // 全程唯讀抓取，不寫入任何報價到 db；唯一寫入是 meta.decisionPackages。

  const DECISION_PACKAGE_LIMIT = 730;
  const DECISION_PROMPT_LINE = '以上為今日收盤與美股現況，請依策略 V2.1 給出明日預約單建議。';
  const VNEXT_BASE = 'http://localhost:5050';

  function ensureDecisionPackagesMeta(){
    if(!DB.meta) DB.meta = {};
    if(!DB.meta.decisionPackages || typeof DB.meta.decisionPackages !== 'object') DB.meta.decisionPackages = {};
    return DB.meta.decisionPackages;
  }

  // 直接讀 proxy /quote 原始 JSON：TWSE MIS 路徑含開高低收 / 量 / 前收
  async function fetchDailyOHLCV(symbol){
    const origSym = String(symbol || '').trim().toUpperCase();
    const LOCAL = (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');
    const symbolsToTry = origSym.endsWith('B')
      ? [origSym, `${origSym}.TW`, `${origSym}.TWO`]
      : (origSym.endsWith('.TW') || origSym.endsWith('.TWO') ? [origSym] : [`${origSym}.TW`]);
    for(const sym of symbolsToTry){
      try{
        const res = await fetch(`${LOCAL}/quote?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' });
        if(!res.ok) continue;
        const j = await res.json();
        const r = j?.quoteResponse?.result?.[0];
        if(!r) continue;
        const num = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
        const out = {
          symbol: origSym,
          tradeDate: r._tradeDate || '',
          open: num(r.regularMarketOpen),
          high: num(r.regularMarketDayHigh),
          low: num(r.regularMarketDayLow),
          close: num(r.regularMarketPrice),
          prevClose: num(r.regularMarketPreviousClose),
          volume: num(r.regularMarketVolume),
          source: r._source || ''
        };
        out.amplitudePct = (out.high != null && out.low != null && out.prevClose)
          ? (out.high - out.low) / out.prevClose * 100 : null;
        out.changePct = (out.close != null && out.prevClose)
          ? (out.close - out.prevClose) / out.prevClose * 100 : null;
        if(out.close != null) return out;
      }catch(e){ /* try next */ }
    }
    return { symbol: origSym, error: true };
  }

  async function fetchVnextNumbers(){
    const endpoints = ['/api/us-live-data', '/api/vnext-live-score'];
    const out = { ok: false, raw: {} };
    for(const ep of endpoints){
      try{
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${VNEXT_BASE}${ep}`, { cache: 'no-store', signal: controller.signal });
        clearTimeout(timer);
        if(res.ok){
          out.raw[ep] = await res.json();
          out.ok = true;
        }
      }catch(e){ /* :5050 未啟動，保持 ok=false 或部分資料 */ }
    }
    return out;
  }

  function buildVnextSection(vnext){
    const templateLines = [
      '- SOX 費半：（待補）',
      '- SOX 5MA 偏離：（待補）',
      '- TSM ADR：（待補）',
      '- NVDA（含量比）：（待補）',
      '- VIX 即時：（待補）',
      '- 布蘭特原油：（待補）',
      '- 美 10Y 殖利率：（待補）'
    ];
    if(!vnext.ok){
      return [
        '> :5050 trading-dashboard 未啟動，以下欄位請手動貼上 vnext「即時模型數字」：',
        ...templateLines
      ].join('\n');
    }
    const lines = ['（以下為 vnext API 原始數據，欄位名稱以 trading-dashboard 為準）'];
    for(const [ep, data] of Object.entries(vnext.raw)){
      let text = '';
      try{ text = JSON.stringify(data, null, 1); }catch(e){ text = String(data); }
      if(text.length > 1600) text = text.slice(0, 1600) + '\n…（截斷）';
      lines.push(`\n#### ${ep}`, '```json', text, '```');
    }
    return lines.join('\n');
  }

  async function buildDecisionPackageMarkdown(){
    const summary = calculatePortfolioSummary();
    const gov = computeCashGovernance(summary);
    const reservation = (typeof getReservationSummary === 'function') ? getReservationSummary() : { items: [] };
    const today = localDateStr();
    const now = new Date().toLocaleString('zh-TW', { hour12: false });

    const fmtN = (v, digits = 2) => (v != null && Number.isFinite(v)) ? Number(v).toFixed(digits) : '待補';
    const fmtA = (v) => Number.isFinite(v) ? fmtInt.format(Math.round(v)) : '待補';
    const signed = (v, digits = 2) => (v != null && Number.isFinite(v)) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` : '待補';

    // 1. 持倉現況
    const tierText = { core: '核心', satellite: '衛星', flex: '偵查' };
    const holdingLines = ['| 標的 | 分層 | 股數 | 均價 | 現價 | 持有損益% | 含息損益% | 佔比% |', '|---|---|---:|---:|---:|---:|---:|---:|'];
    const heldRows = summary.heldRows;
    const totalMv = summary.totalAssets || 1;
    for(const row of heldRows){
      const label = getStockLabel(row.stock.id) || {};
      const unrealPct = row.costBasis > 0 ? row.unrealized / row.costBasis * 100 : null;
      const totalPct = row.costBasis > 0 ? row.totalPnl / row.costBasis * 100 : null;
      holdingLines.push(`| ${row.stock.symbol} ${row.stock.name || ''} | ${tierText[normalizeTierValue(label.tier)] || '偵查'} | ${formatHoldingQty(row.qty)} | ${fmtN(row.avgCost)} | ${fmtN(row.price)} | ${signed(unrealPct, 1)} | ${signed(totalPct, 1)} | ${(row.marketValue / totalMv * 100).toFixed(1)} |`);
    }

    // 2. 前一交易日（最近收盤）OHLCV：經 proxy /quote（TWSE MIS）
    const symbols = heldRows.map(r => r.stock.symbol);
    const quotes = await Promise.all(symbols.map(s => fetchDailyOHLCV(s)));
    const ohlcLines = ['| 標的 | 交易日 | 開盤 | 最高 | 最低 | 收盤 | 漲跌% | 振幅% | 成交量(股) |', '|---|---|---:|---:|---:|---:|---:|---:|---:|'];
    let quotesOk = 0;
    for(const q of quotes){
      if(q.error){
        ohlcLines.push(`| ${q.symbol} | 待補 | 待補 | 待補 | 待補 | 待補 | 待補 | 待補 | 待補 |`);
        continue;
      }
      quotesOk += 1;
      ohlcLines.push(`| ${q.symbol} | ${q.tradeDate || '待補'} | ${fmtN(q.open)} | ${fmtN(q.high)} | ${fmtN(q.low)} | ${fmtN(q.close)} | ${signed(q.changePct)} | ${q.amplitudePct != null ? q.amplitudePct.toFixed(2) + '%' : '待補'} | ${q.volume != null ? fmtInt.format(q.volume) : '待補'} |`);
    }
    const quoteNote = quotesOk === 0
      ? '> 代理伺服器未啟動或無回應，上表請以玩股網數字手動補上。'
      : `> 來源：本地 proxy /quote（TWSE MIS / Yahoo），成功 ${quotesOk}/${symbols.length} 檔；玩股網僅作人工核對。`;

    // 3. 現金水位
    const cashLines = [
      `- 可用現金：${fmtA(gov.cashAmount)}（${fmtN(gov.cashPct, 1)}% 總資產）`,
      `- 現金安全線：${gov.floorPct != null ? gov.floorPct + '%' : '未設定'}`,
      `- 預約單全成交需現金：${fmtA(gov.reservationBuyTotal)}（${gov.reservationCount} 筆）`,
      `- 全成交後現金：${fmtA(gov.postFillCashAmount)}（${fmtN(gov.postFillCashPct, 1)}%）${gov.floorPct != null && gov.postFillCashPct < gov.floorPct ? ' ⚠ 低於安全線' : ''}`
    ];

    // 4. 預約單計畫
    const planLines = reservation.items?.length
      ? ['| 標的 | 方向 | 計畫價 | 張數 | 金額 | 停損 | 停利 | 進場條件 |', '|---|---|---:|---:|---:|---:|---:|---|',
         ...reservation.items.map(i => `| ${i.symbol} ${i.name} | ${i.side === 'sell' ? '賣出' : '買進'} | ${fmtN(i.planPrice)} | ${i.planQty} | ${fmtA(i.amount)} | ${i.stopLoss != null ? fmtN(i.stopLoss) : '—'} | ${i.stopProfit != null ? fmtN(i.stopProfit) : '—'} | ${i.condition || '—'} |`)]
      : ['（目前無進行中的預約計畫）'];

    // 5. vnext 美股關鍵數字
    const vnext = await fetchVnextNumbers();
    const vnextSection = buildVnextSection(vnext);

    const md = [
      `# Buffett 決策資料包（${today}）`,
      `> 產生時間：${now}｜總資產 ${fmtA(summary.totalAssets)}｜持倉市值 ${fmtA(summary.holdingsMarketValue)}`,
      '',
      '## 1. 持倉現況',
      ...holdingLines,
      '',
      '## 2. 前一交易日收盤（開高低收 / 振幅 / 量）',
      ...ohlcLines,
      quoteNote,
      '',
      '## 3. 現金水位',
      ...cashLines,
      '',
      '## 4. 預約單計畫（全成交假設）',
      ...planLines,
      '',
      '## 5. 美股關鍵數字（vnext 即時模型數字）',
      vnextSection,
      '',
      '---',
      DECISION_PROMPT_LINE
    ].join('\n');

    return {
      date: today,
      markdown: md,
      sources: {
        quotes: quotesOk > 0 ? `proxy-quote ${quotesOk}/${symbols.length}` : 'unavailable',
        vnext: vnext.ok ? 'vnext-api' : 'unavailable'
      },
      createdAt: new Date().toISOString()
    };
  }

  async function generateDecisionPackage(){
    const btns = [document.getElementById('btn-decision-package'), document.getElementById('btn-decision-package-2')].filter(Boolean);
    btns.forEach(b => { b.disabled = true; b.dataset.origText = b.textContent; b.textContent = '組裝中…'; });
    try{
      const pkg = await buildDecisionPackageMarkdown();
      const store = ensureDecisionPackagesMeta();
      store[pkg.date] = pkg;
      if(Object.keys(store).length > DECISION_PACKAGE_LIMIT){
        showBackupStatus(`決策紀錄已超過 ${DECISION_PACKAGE_LIMIT} 筆，建議在歷史分析頁匯出後修剪`, true);
      }
      await saveDB();
      openDecisionPackageDialog(pkg);
      renderDecisionLog();
      showBackupStatus('決策資料包已產生並存入決策紀錄 ✓');
    }catch(e){
      console.error('[decision-package] generate failed', e);
      alert('決策資料包產生失敗：' + (e?.message || e));
    }finally{
      btns.forEach(b => { b.disabled = false; b.textContent = b.dataset.origText || '產生決策資料包'; });
    }
  }

  function openDecisionPackageDialog(pkg){
    const dlg = document.getElementById('dlg-decision-package');
    if(!dlg) return;
    document.getElementById('dlg-decision-package-title').textContent = `Buffett 決策資料包（${pkg.date}）`;
    document.getElementById('decision-package-meta').textContent =
      `產生於 ${new Date(pkg.createdAt).toLocaleString('zh-TW', { hour12: false })}｜報價來源：${pkg.sources?.quotes || '—'}｜vnext：${pkg.sources?.vnext === 'vnext-api' ? '已自動帶入' : '未啟動（請手動補）'}`;
    document.getElementById('decision-package-text').value = pkg.markdown;
    dlg.showModal();
  }

  function copyDecisionPackageText(){
    const ta = document.getElementById('decision-package-text');
    if(!ta || !ta.value) return;
    const done = () => showBackupStatus('已複製決策資料包 ✓');
    if(navigator.clipboard?.writeText){
      navigator.clipboard.writeText(ta.value).then(done).catch(() => { ta.select(); document.execCommand('copy'); done(); });
    }else{
      ta.select(); document.execCommand('copy'); done();
    }
  }

  function downloadDecisionPackage(dateLabel){
    const ta = document.getElementById('decision-package-text');
    const text = ta?.value || '';
    if(!text) return;
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decision-package-${dateLabel || localDateStr()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ========= 決策紀錄列表（工具頁子頁）=========
  function renderDecisionLog(){
    const host = document.getElementById('decision-log-list');
    if(!host) return;
    const store = DB.meta?.decisionPackages || {};
    const dates = Object.keys(store).sort().reverse();
    if(dates.length === 0){
      host.innerHTML = '<div class="empty">尚無決策紀錄。在首頁或本頁點「產生決策資料包」後，每日紀錄會留存在這裡。</div>';
      return;
    }
    host.innerHTML = `<div class="mini muted" style="margin-bottom:8px">共 ${dates.length} 筆（每日一筆，同日重產會覆寫）</div>` +
      `<div class="decision-log-rows">` +
      dates.map(d => {
        const pkg = store[d];
        const created = pkg?.createdAt ? new Date(pkg.createdAt).toLocaleString('zh-TW', { hour12: false }) : '';
        return `<div class="decision-log-row">
          <div class="decision-log-date">${d}</div>
          <div class="decision-log-meta mini muted">產生於 ${created}｜vnext：${pkg?.sources?.vnext === 'vnext-api' ? '自動' : '手動'}</div>
          <div class="stack" style="gap:6px">
            <button type="button" class="btn mini" data-action="dp-view" data-date="${d}">檢視</button>
            <button type="button" class="btn mini ghost" data-action="dp-delete" data-date="${d}">刪除</button>
          </div>
        </div>`;
      }).join('') + '</div>';
  }

  (function bindDecisionLog(){
    const host = document.getElementById('decision-log-list');
    if(host){
      host.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if(!btn) return;
        const date = btn.dataset.date;
        const store = DB.meta?.decisionPackages || {};
        if(btn.dataset.action === 'dp-view' && store[date]){
          openDecisionPackageDialog(store[date]);
        }
        if(btn.dataset.action === 'dp-delete' && store[date]){
          if(!confirm(`確定刪除 ${date} 的決策紀錄？此動作無法復原。`)) return;
          delete store[date];
          await saveDB({ allowPerformanceDelete: true });
          renderDecisionLog();
        }
      });
    }
    document.getElementById('btn-decision-package')?.addEventListener('click', () => generateDecisionPackage());
    document.getElementById('btn-decision-package-2')?.addEventListener('click', () => generateDecisionPackage());
    document.getElementById('btn-decision-copy')?.addEventListener('click', copyDecisionPackageText);
    document.getElementById('btn-decision-download')?.addEventListener('click', () => {
      const title = document.getElementById('dlg-decision-package-title')?.textContent || '';
      const m = title.match(/\d{4}-\d{2}-\d{2}/);
      downloadDecisionPackage(m ? m[0] : '');
    });
  })();
