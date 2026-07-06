  // ========= 總覽（#view-snapshots）=========
  function qtyBeforeDividendTxn(stockId, targetTxn){
    const row = findSummaryRowByStockId(stockId, calculatePortfolioSummary());
    return getHoldingQtyBeforeTxnForRow(row, targetTxn);
  }

  // SVG donut with leader-line labels
  function buildSvgDonut(slices, opts = {}){
    const size = opts.size || 180;
    const cx = size / 2, cy = size / 2;
    const R = opts.radius || 70, hole = opts.hole || 44;
    const border = R + 8; // white outer ring
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('class', 'overview-donut-svg');
    svg.style.width = '100%';
    svg.style.maxWidth = size + 'px';
    // outer white ring with shadow
    const outerRing = document.createElementNS(ns, 'circle');
    outerRing.setAttribute('cx', cx); outerRing.setAttribute('cy', cy); outerRing.setAttribute('r', border);
    outerRing.setAttribute('fill', '#fff');
    svg.appendChild(outerRing);
    if(slices.length === 0){
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', R);
      c.setAttribute('fill', '#e2e8f0'); svg.appendChild(c);
      const ch = document.createElementNS(ns, 'circle');
      ch.setAttribute('cx', cx); ch.setAttribute('cy', cy); ch.setAttribute('r', hole);
      ch.setAttribute('fill', '#fff'); svg.appendChild(ch);
      return svg;
    }
    // draw arcs
    let startAngle = -90;
    for(const s of slices){
      const deg = s.pct * 360;
      const endAngle = startAngle + deg;
      const a1 = startAngle * Math.PI / 180, a2 = endAngle * Math.PI / 180;
      const large = deg > 180 ? 1 : 0;
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      if(deg >= 360 - 0.01){
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', R);
        c.setAttribute('fill', s.color); svg.appendChild(c);
      } else {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`);
        path.setAttribute('fill', s.color); svg.appendChild(path);
      }
      startAngle = endAngle;
    }
    // center hole
    const holeC = document.createElementNS(ns, 'circle');
    holeC.setAttribute('cx', cx); holeC.setAttribute('cy', cy); holeC.setAttribute('r', hole);
    holeC.setAttribute('fill', '#fff');
    svg.appendChild(holeC);
    return svg;
  }

  function buildDonutLegend(slices){
    return slices.slice().sort((a, b) => b.pct - a.pct).map(s => {
      const pct = (s.pct * 100).toFixed(1);
      return `<div class="overview-donut-legend-item">
        <span class="overview-donut-legend-dot" style="background:${s.color}"></span>
        <span class="overview-donut-legend-label">${s.label}</span>
        <span class="overview-donut-legend-pct">${pct}%</span>
      </div>`;
    }).join('');
  }

  function renderOverview(summary = calculatePortfolioSummary()){
    const barsEl = $('#overview-alloc-bars');
    const donutWrapEl = $('#overview-donut-wrap');
    const donutLeg = $('#overview-donut-legend');
    const tierBulletEl = $('#overview-tier-bullet');
    const alertEl = $('#overview-alert');
    if(!donutWrapEl || !donutLeg || !alertEl) return;

    const holdingsMv = summary.holdingsMarketValue;
    const cashAvail = summary.cashAvailable;
    const totalMv = Math.round(summary.totalAssets);

    const investedCapital = getInitialCapitalAmount() + sumCapitalAdjustments();
    const netGainAmt = totalMv - investedCapital;
    const netGainStr = (netGainAmt >= 0 ? '+' : '') + fmtInt.format(Math.round(netGainAmt));
    const netGainClass = netGainAmt >= 0 ? 'pos' : 'neg';
    const returnPct = investedCapital !== 0 ? ((totalMv - investedCapital) / investedCapital) * 100 : 0;
    const retStr = (returnPct >= 0 ? '+' : '') + returnPct.toFixed(2) + '%';
    const retClass = returnPct >= 0 ? 'pos' : 'neg';

    const monthDividend = calculateCurrentMonthDividend(summary);
    const monthDivDisplay = monthDividend.amount > 0
      ? `${monthDividend.isActual ? '' : '~'}${fmtInt.format(Math.round(monthDividend.amount))}`
      : '—';
    const monthDivClass = monthDividend.amount > 0 ? 'blue' : '';

    // 風險指標：以快照序列 + 今日總資產計算回撤（沿用 computeDrawdownSeries 口徑）
    const ddMetrics = computeDrawdownKpi(totalMv);
    const ddColorClass = (pct) => {
      if(!Number.isFinite(pct)) return '';
      if(pct <= -10) return 'neg';
      if(pct <= -5) return 'warn-text';
      return '';
    };
    const maxDdDisplay = Number.isFinite(ddMetrics.maxDrawdownPct)
      ? `${ddMetrics.maxDrawdownPct.toFixed(2)}%`
      : '—';
    const curDdDisplay = Number.isFinite(ddMetrics.currentDrawdownPct)
      ? (ddMetrics.currentDrawdownPct > -0.005 ? '位於峰值' : `${ddMetrics.currentDrawdownPct.toFixed(2)}%`)
      : '—';


    if(barsEl){
      const COL_TW_EQ = '#378ADD';
      const COL_GLB_EQ = '#534AB7';
      const COL_BOND = '#EF9F27';

      const stockRows = summary.heldRows
        .map(row => ({ stock: row.stock, mv: Math.round(parseN(row.marketValue)) }))
        .filter(x => x.mv > 0)
        .sort((a, b) => b.mv - a.mv);

      const top = stockRows.slice(0, 6);
      const rest = stockRows.slice(6);
      const otherMv = rest.reduce((a, x) => a + x.mv, 0);

      const barItems = top.map(x => ({ name: `${x.stock.symbol} ${x.stock.name || ''}`.trim(), mv: x.mv, stock: x.stock }));
      if(otherMv > 0){
        barItems.push({ name: '其他', mv: otherMv, stock: null });
      }

      const totalBarMv = barItems.reduce((a, x) => a + x.mv, 0) || 1;

      function barColor(stock){
        if(!stock) return COL_TW_EQ;
        if(stock.assetClass === 'Bond' || stock.assetClass === 'BondETF') return COL_BOND;
        if(stock.market === 'Global' && stock.assetClass === 'Equity') return COL_GLB_EQ;
        return COL_TW_EQ;
      }

      barsEl.innerHTML = barItems.length ? barItems.map(x => {
        const pct = Math.round((x.mv / totalBarMv) * 100);
        const w = Math.round((x.mv / totalBarMv) * 10000) / 100;
        const col = barColor(x.stock);
        const safeTitle = x.name.replace(/"/g, '');
        return `<div class="overview-bar-row">
          <div class="overview-bar-name" title="${safeTitle}">${x.name}</div>
          <div class="overview-bar-track"><div class="overview-bar-fill" style="width:${w.toFixed(2)}%; background:${col}"></div></div>
          <div class="overview-bar-pct">${pct}%</div>
        </div>`;
      }).join('') : `<div class="empty">尚無持倉市值</div>`;
    }

    // 大類比例：按 5 種資產類別（含現金，SVG donut，從大到小）
    const ovClassDef = [
      { key: 'Equity',     label: '個股',     color: '#ef4444' },
      { key: 'PassiveETF', label: '被動式ETF', color: '#3b82f6' },
      { key: 'ActiveETF',  label: '主動式ETF', color: '#8b5cf6' },
      { key: 'BondETF',    label: '債券ETF',   color: '#f59e0b' },
      { key: 'Cash',       label: '現金',      color: '#64748b' },
    ];
    const ovByClass = {};
    ovClassDef.forEach(c => ovByClass[c.key] = 0);
    ovByClass['Cash'] = cashAvail > 0 ? cashAvail : 0;
    for(const row of summary.heldRows){
      const s = row.stock;
      const mv = parseN(row.marketValue);
      if(mv <= 0) continue;
      let ac = s.assetClass || 'Equity';
      if(ac === 'Bond') ac = 'BondETF';
      if(!(ac in ovByClass)) ac = 'Equity';
      ovByClass[ac] += mv;
    }
    const ovTotal = Object.values(ovByClass).reduce((a, v) => a + v, 0);
    const ovSlices = ovClassDef
      .map(c => ({ ...c, value: ovByClass[c.key], pct: ovTotal > 0 ? ovByClass[c.key] / ovTotal : 0 }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value);

    donutWrapEl.innerHTML = '<div class="overview-donut-center-label">大類比例</div>';
    donutWrapEl.insertBefore(buildSvgDonut(ovSlices), donutWrapEl.firstChild);
    donutLeg.innerHTML = buildDonutLegend(ovSlices);

    // 分層比例：核心 / 衛星 / 偵察 / 現金（SVG donut，從大到小）
    const catWrapEl = $('#overview-cat-wrap');
    const catLegEl = $('#overview-cat-legend');
    if(catWrapEl && catLegEl && typeof getTierAllocation === 'function'){
      const ta = getTierAllocation(summary);
      const tierSlicesDef = [
        { label: '核心', value: ta.coreMv,      color: '#0F766E' },
        { label: '衛星', value: ta.satelliteMv, color: '#2563EB' },
        { label: '偵察', value: ta.flexMv,      color: '#D97706' },
        { label: '現金', value: ta.cashMv,      color: '#64748b' },
      ];
      const tierTotal = ta.total || 1;
      const catSlices = tierSlicesDef
        .map(s => ({ ...s, pct: s.value > 0 ? s.value / tierTotal : 0 }))
        .filter(s => s.value > 0)
        .sort((a, b) => b.value - a.value);
      catWrapEl.innerHTML = '<div class="overview-donut-center-label">分層比例</div>';
      catWrapEl.insertBefore(buildSvgDonut(catSlices), catWrapEl.firstChild);
      catLegEl.innerHTML = buildDonutLegend(catSlices);
    }

    // 投資區域：台灣 / 海外（SVG donut，從大到小，不含現金）
    const regionWrapEl = $('#overview-region-wrap');
    const regionLegEl = $('#overview-region-legend');
    if(regionWrapEl && regionLegEl){
      const regionDef = [
        { key: 'TW',     label: '台灣', color: '#10b981' },
        { key: 'Global', label: '海外', color: '#f97316' },
      ];
      const regionMap = { TW: 0, Global: 0 };
      for(const row of summary.heldRows){
        const s = row.stock;
        const mv = parseN(row.marketValue);
        if(mv <= 0) continue;
        const mkt = s.market === 'Global' ? 'Global' : 'TW';
        regionMap[mkt] += mv;
      }
      const regionTotal = regionMap.TW + regionMap.Global;
      const regionSlices = regionDef
        .map(r => ({ ...r, value: regionMap[r.key], pct: regionTotal > 0 ? regionMap[r.key] / regionTotal : 0 }))
        .filter(r => r.value > 0)
        .sort((a, b) => b.value - a.value);
      regionWrapEl.innerHTML = '<div class="overview-donut-center-label">投資區域</div>';
      regionWrapEl.insertBefore(buildSvgDonut(regionSlices), regionWrapEl.firstChild);
      regionLegEl.innerHTML = buildDonutLegend(regionSlices);
    }

    // 分層配置 vs 目標（子彈圖；分母 = 總資產含現金）
    if(tierBulletEl && typeof renderTierBullet === 'function'){
      try{
        const tierAlloc = getTierAllocation(summary);
        const targets = getTierTargets();
        renderTierBullet(tierBulletEl, [
          { key: 'core',      label: '核心', actualPct: tierAlloc.corePct,      targetPct: targets?.core ?? null,      color: '#0F766E' },
          { key: 'satellite', label: '衛星', actualPct: tierAlloc.satellitePct, targetPct: targets?.satellite ?? null, color: '#2563EB' },
          { key: 'flex',      label: '偵查', actualPct: tierAlloc.flexPct,      targetPct: targets?.flex ?? null,      color: '#D97706' },
          { key: 'cash',      label: '現金', actualPct: tierAlloc.cashPct,      targetPct: targets?.cash ?? null,      color: '#64748b' },
        ], targets?.tolerance);
      }catch(e){ console.warn('[overview] tier bullet failed', e); }
    }

    // 現金治理水位計
    const cashGaugeEl = $('#overview-cash-gauge');
    if(cashGaugeEl && typeof renderCashGauge === 'function' && typeof computeCashGovernance === 'function'){
      try{ renderCashGauge(cashGaugeEl, computeCashGovernance(summary)); }
      catch(e){ console.warn('[overview] cash gauge failed', e); }
    }


    let redMsg = null;
    let orangeMsg = null;

    if(!summary.validation.holdingsMatchesDetails){
      redMsg = `持倉市值與明細加總不一致，差額 ${fmtInt.format(Math.round(summary.holdingsVsDetailsDiff))}。`;
    }else if(!summary.validation.totalAssetsMatchesEquation){
      redMsg = `總資產公式不一致，差額 ${fmtInt.format(Math.round(summary.totalAssetsDiff))}。`;
    }else if(summary.hasSyncWarning){
      orangeMsg = summary.syncWarningMessage;
    }

    for(const row of summary.heldRows){
      if(redMsg || orangeMsg) break;
      const s = row.stock;
      const avg = parseN(row.avgCost);
      const price = parseN(row.price);
      const ret = avg > 0 ? (price - avg) / avg : NaN;
      const lb = getStockLabel(s.id) || {};
      const sl = lb.stopLoss;

      if(sl != null && sl !== '' && Number.isFinite(parseN(sl)) && Number.isFinite(ret)){
        if(ret <= parseN(sl)){
          redMsg = `已有標的觸及停損設定（${s.symbol} 報酬率約 ${(ret * 100).toFixed(2)}%），請檢視。`;
          break;
        }
      }
    }

    if(!redMsg){
      for(const row of summary.heldRows){
        const s = row.stock;
        const avg = parseN(row.avgCost);
        const price = parseN(row.price);
        const ret = avg > 0 ? (price - avg) / avg : NaN;
        const lb = getStockLabel(s.id) || {};
        const sl = lb.stopLoss;
        const strategy = lb.strategy;
        if(strategy === 'tradeable' && (sl == null || sl === '') && Number.isFinite(ret) && ret < -0.05){
          orangeMsg = `建議為 ${s.symbol} 設定停損線（目前已低於成本約 ${(Math.abs(ret) * 100).toFixed(2)}%）。`;
          break;
        }
      }
    }

    function goHoldings(){
      $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.target === '#view-holdings'));
      $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-holdings'));
      renderHoldings();
      renderLongTermMetricsIfOpen();
    }

    alertEl.classList.remove('overview-alert-red', 'overview-alert-orange', 'overview-alert-green');
    if(redMsg){
      alertEl.classList.add('overview-alert', 'overview-alert-red');
      alertEl.textContent = redMsg;
    }else if(orangeMsg){
      alertEl.classList.add('overview-alert', 'overview-alert-orange');
      alertEl.textContent = orangeMsg;
    }else{
      alertEl.classList.add('overview-alert', 'overview-alert-green');
      alertEl.textContent = '所有標的運作正常';
    }
    alertEl.onclick = () => goHoldings();
    alertEl.onkeydown = (e) => {
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        goHoldings();
      }
    };
    renderTreemap(summary);
  }


  // ========= Treemap + Drawdown =========
  let week1OverviewTreemapChart = null;
  let week1TreemapRenderSeq = 0;
  let week1TreemapPreferFallback = false;

  function week1IsTreemapSeriesAvailable(){
    if(typeof Highcharts === 'undefined') return false;
    if(Highcharts.seriesTypes && Highcharts.seriesTypes.treemap) return true;
    try{
      const registry = Highcharts.SeriesRegistry;
      if(registry && registry.seriesTypes && registry.seriesTypes.treemap) return true;
    }catch(e){ /* ignore */ }
    return false;
  }

  function week1AppendTreemapModuleScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.dataset.week1Treemap = '1';
      s.onload = () => {
        let attempts = 0;
        const timer = window.setInterval(() => {
          if(week1IsTreemapSeriesAvailable()){
            window.clearInterval(timer);
            s.dataset.loaded = '1';
            resolve();
            return;
          }
          attempts += 1;
          if(attempts > 120){
            window.clearInterval(timer);
            reject(new Error('treemap series not registered'));
          }
        }, 25);
      };
      s.onerror = () => reject(new Error(`treemap module load failed: ${src}`));
      document.head.appendChild(s);
    });
  }

  function week1EscapeHtml(str){
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function week1TreemapColorForReturn(pct){
    if(!Number.isFinite(pct)) return '#94a3b8';
    if (pct <= -0.25) return '#7f1d1d';
    if (pct <= -0.12) return '#b91c1c';
    if (pct < -0.03) return '#ef4444';
    if (pct < 0.03) return '#facc15';
    if (pct < 0.12) return '#4ade80';
    if (pct < 0.22) return '#16a34a';
    return '#166534';
  }

  function week1TreemapTextColor(bgHex){
    const hex = String(bgHex || '').replace('#', '').trim();
    if(!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const toLinear = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    return luminance > 0.48 ? '#16243A' : '#ffffff';
  }

  function week1EnsureTreemapTooltip(){
    let tooltip = document.getElementById('week1-treemap-tooltip');
    if(tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.id = 'week1-treemap-tooltip';
    tooltip.style.cssText = `
      position:fixed;
      left:0;
      top:0;
      z-index:9999;
      max-width:40px;
      padding:10px 12px;
      border-radius:10px;
      background:rgba(15,23,42,0.96);
      color:#f8fafc;
      font-size:12px;
      line-height:1.45;
      word-break:break-word;
      box-shadow:0 16px 40px rgba(15,23,42,0.28);
      pointer-events:none;
      opacity:0;
      transform:translateY(4px);
      transition:opacity .08s ease, transform .08s ease;
    `;
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function week1MoveTreemapTooltip(clientX, clientY){
    const tooltip = week1EnsureTreemapTooltip();
    const offset = 14;
    const rect = tooltip.getBoundingClientRect();
    let left = clientX + offset;
    let top = clientY + offset;
    if(left + rect.width > window.innerWidth - 12){
      left = clientX - rect.width - offset;
    }
    if(top + rect.height > window.innerHeight - 12){
      top = clientY - rect.height - offset;
    }
    tooltip.style.left = `${Math.max(12, left)}px`;
    tooltip.style.top = `${Math.max(12, top)}px`;
  }

  function week1ShowTreemapTooltip(text, clientX, clientY){
    const tooltip = week1EnsureTreemapTooltip();
    tooltip.innerHTML = (text || '').replace(/\n/g, '<br>');
    tooltip.style.opacity = '1';
    tooltip.style.transform = 'translateY(0)';
    week1MoveTreemapTooltip(clientX, clientY);
  }

  function week1HideTreemapTooltip(){
    const tooltip = document.getElementById('week1-treemap-tooltip');
    if(!tooltip) return;
    tooltip.style.opacity = '0';
    tooltip.style.transform = 'translateY(4px)';
  }

  function week1BuildSvgPath(points){
    if(!points.length) return '';
    return points.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  }

  function week1RenderLineChartSvg(container, lines, options = {}){
    const width = options.width || 900;
    const height = options.height || 220;
    const pad = { top: 12, right: 18, bottom: 28, left: 46 };
    const allValues = lines.flatMap(line => line.points.map(p => p.y).filter(v => Number.isFinite(v)));
    if(!allValues.length){
      container.innerHTML = '<div class="empty">尚無資料</div>';
      return;
    }

    let minY = Math.min(...allValues);
    let maxY = Math.max(...allValues);
    if(options.maxY != null) maxY = options.maxY;
    if(options.minY != null) minY = options.minY;
    if(Math.abs(maxY - minY) < 0.0001){
      maxY += 1;
      minY -= 1;
    }

    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const pointCount = Math.max(...lines.map(line => line.points.length));
    const xAt = (idx) => pad.left + (pointCount <= 1 ? innerW / 2 : (idx / (pointCount - 1)) * innerW);
    const yAt = (val) => pad.top + innerH - ((val - minY) / (maxY - minY)) * innerH;

    const yTicks = 4;
    const grid = [];
    const labels = [];
    for(let i = 0; i <= yTicks; i++){
      const value = minY + (maxY - minY) * (i / yTicks);
      const y = yAt(value);
      grid.push(`<line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${(width - pad.right).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#e2e8f0" stroke-width="1" />`);
      labels.push(`<text x="${pad.left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="#64748b">${value.toFixed(0)}%</text>`);
    }

    const xLabels = [];
    const firstLine = lines[0]?.points || [];
    const labelIndexes = [0, Math.floor((pointCount - 1) / 2), pointCount - 1].filter((v, i, arr) => v >= 0 && arr.indexOf(v) === i);
    labelIndexes.forEach((idx) => {
      const point = firstLine[idx];
      if(!point) return;
      const dt = new Date(point.x);
      const label = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
      xLabels.push(`<text x="${xAt(idx).toFixed(2)}" y="${(height - 8).toFixed(2)}" text-anchor="middle" font-size="11" fill="#64748b">${label}</text>`);
    });

    const paths = lines.map((line) => {
      const validPoints = line.points
        .map((p, idx) => Number.isFinite(p.y) ? { x: xAt(idx), y: yAt(p.y) } : null)
        .filter(Boolean);
      if(!validPoints.length) return '';
      const path = week1BuildSvgPath(validPoints);
      const area = line.area
        ? `${path} L ${validPoints[validPoints.length - 1].x.toFixed(2)} ${(pad.top + innerH).toFixed(2)} L ${validPoints[0].x.toFixed(2)} ${(pad.top + innerH).toFixed(2)} Z`
        : '';
      return `
        ${line.area ? `<path d="${area}" fill="${line.color}" opacity="${line.fillOpacity || 0.14}"></path>` : ''}
        <path d="${path}" fill="none" stroke="${line.color}" stroke-width="${line.strokeWidth || 2}" ${line.dash ? `stroke-dasharray="${line.dash}"` : ''}></path>
      `;
    }).join('');

    container.style.overflow = 'hidden';
    container.style.height = `${height}px`;
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block; width:100%; height:${height}px" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        ${grid.join('')}
        <line x1="${pad.left}" y1="${(pad.top + innerH).toFixed(2)}" x2="${(width - pad.right).toFixed(2)}" y2="${(pad.top + innerH).toFixed(2)}" stroke="#cbd5e1" stroke-width="1"></line>
        ${paths}
        ${labels.join('')}
        ${xLabels.join('')}
      </svg>`;
  }

  function renderDrawdownChartFallback(container, series){
    container.style.height = '380px';
    container.style.display = '';
    const lines = [{
      color: '#DC2626',
      area: true,
      fillOpacity: 0.15,
      points: series.map(p => ({ x: new Date(p.date).getTime(), y: +(p.drawdownPct * 100).toFixed(2) }))
    }];
    week1RenderLineChartSvg(container, lines, { height: 380, maxY: 0 });
  }

  function week1TreemapWorstAspect(row, side){
    if(!row.length || side <= 0) return Number.POSITIVE_INFINITY;
    const areas = row.map(item => item.area);
    const sum = areas.reduce((acc, value) => acc + value, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    const sideSq = side * side;
    return Math.max((sideSq * max) / (sum * sum), (sum * sum) / (sideSq * min));
  }

  function week1TreemapLayoutRow(row, rect, out){
    const areaSum = row.reduce((sum, item) => sum + item.area, 0);
    if(rect.w >= rect.h){
      const rowH = areaSum / rect.w;
      let cursorX = rect.x;
      row.forEach((item) => {
        const itemW = item.area / rowH;
        out.push({ ...item, x: cursorX, y: rect.y, w: itemW, h: rowH });
        cursorX += itemW;
      });
      return { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
    }

    const rowW = areaSum / rect.h;
    let cursorY = rect.y;
    row.forEach((item) => {
      const itemH = item.area / rowW;
      out.push({ ...item, x: rect.x, y: cursorY, w: rowW, h: itemH });
      cursorY += itemH;
    });
    return { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h };
  }

  function week1TreemapSquarify(items, rect, out, row = []){
    if(!items.length){
      if(row.length) week1TreemapLayoutRow(row, rect, out);
      return;
    }

    const next = items[0];
    const remaining = items.slice(1);
    const side = Math.min(rect.w, rect.h);
    const testRow = row.concat(next);

    if(!row.length || week1TreemapWorstAspect(testRow, side) <= week1TreemapWorstAspect(row, side)){
      week1TreemapSquarify(remaining, rect, out, testRow);
      return;
    }

    const nextRect = week1TreemapLayoutRow(row, rect, out);
    week1TreemapSquarify(items, nextRect, out, []);
  }

  function week1BuildTreemapLayout(layoutItems){
    const items = layoutItems
      .slice()
      .sort((a, b) => b.weight - a.weight);
    const out = [];
    if(!items.length) return out;

    if(items.length === 1){
      out.push({ ...items[0], x: 0, y: 0, w: 100, h: 100 });
      return out;
    }

    out.push({ ...items[0], x: 0, y: 0, w: 50, h: 100 });

    if(items.length === 2){
      out.push({ ...items[1], x: 50, y: 0, w: 50, h: 100 });
      return out;
    }

    const rightItems = items.slice(1);
    const rightTotalWeight = rightItems.reduce((sum, item) => sum + item.weight, 0) || 1;
    const second = items[1];
    const rest = items.slice(2);
    const secondShare = second.weight / rightTotalWeight;
    const secondHeight = Math.max(22, Math.min(48, secondShare * 100));

    out.push({ ...second, x: 50, y: 0, w: 50, h: secondHeight });

    const lowerRect = { x: 50, y: secondHeight, w: 50, h: 100 - secondHeight };
    if(!rest.length || lowerRect.h <= 0){
      return out;
    }

    if(rest.length === 1){
      out.push({ ...rest[0], ...lowerRect });
      return out;
    }

    const restTotalWeight = rest.reduce((sum, item) => sum + item.weight, 0) || 1;
    const restArea = lowerRect.w * lowerRect.h;
    const normalizedRest = rest.map((item) => ({
      ...item,
      area: (item.weight / restTotalWeight) * restArea
    }));
    week1TreemapSquarify(normalizedRest, lowerRect, out);
    return out;
  }

  function week1BuildTreemapDetailTitle(row, totalMV){
    const returnPct = Number.isFinite(row.totalReturnPct) ? row.totalReturnPct / 100 : 0;
    const allocation = totalMV > 0 ? row.marketValue / totalMV : 0;
    const sign = returnPct >= 0 ? '+' : '';
    return [
      `${row.stock?.symbol || '—'} ${row.stock?.name || ''}`.trim(),
      `含息報酬率：${sign}${(returnPct * 100).toFixed(1)}%`,
      `市值：${Math.round(row.marketValue).toLocaleString()}`,
      `配置：${(allocation * 100).toFixed(1)}%`,
      `含息損益：${Math.round(Number.isFinite(row.totalPnlWithFees) ? row.totalPnlWithFees : 0).toLocaleString()}`
    ].join('\n');
  }

  function week1BindTreemapInteractions(container){
    container.querySelectorAll('[data-week1-treemap-item="1"]').forEach((el) => {
      el.addEventListener('click', () => {
        if (typeof goHoldings === 'function') goHoldings();
      });
      el.addEventListener('mouseenter', (event) => {
        week1ShowTreemapTooltip(el.dataset.tooltip || '', event.clientX, event.clientY);
      });
      el.addEventListener('mousemove', (event) => {
        week1MoveTreemapTooltip(event.clientX, event.clientY);
      });
      el.addEventListener('mouseleave', () => {
        week1HideTreemapTooltip();
      });
      el.addEventListener('focus', () => {
        const rect = el.getBoundingClientRect();
        week1ShowTreemapTooltip(el.dataset.tooltip || '', rect.right, rect.top);
      });
      el.addEventListener('blur', () => {
        week1HideTreemapTooltip();
      });
    });
  }

  function week1RenderTreemapMainTile(item, totalMV){
    const r = item.row;
    const returnPct = Number.isFinite(r.totalReturnPct) ? r.totalReturnPct / 100 : 0;
    const allocation = totalMV > 0 ? r.marketValue / totalMV : 0;
    const sign = returnPct >= 0 ? '+' : '';
    const bg = week1TreemapColorForReturn(returnPct);
    const fg = week1TreemapTextColor(bg);
    const inset = 4;
    const left = `calc(${item.x.toFixed(4)}% + ${inset}px)`;
    const top = `calc(${item.y.toFixed(4)}% + ${inset}px)`;
    const width = `calc(${item.w.toFixed(4)}% - ${inset * 2}px)`;
    const height = `calc(${item.h.toFixed(4)}% - ${inset * 2}px)`;
    const small = item.w < 18 || item.h < 18;
    const tiny = item.w < 12 || item.h < 12;
    const sizeKey = Math.min(item.w, item.h);
    const symbolFontSize = Math.max(13, Math.min(22, Math.round(11 + sizeKey * 0.22)));
    const nameFontSize = Math.max(11, Math.min(15, Math.round(9 + sizeKey * 0.12)));
    const detailTitle = week1BuildTreemapDetailTitle(r, totalMV);
    return `
      <button
        type="button"
        data-week1-treemap-item="1"
        data-stock-id="${week1EscapeHtml(r.stock?.id || '')}"
        data-tooltip="${week1EscapeHtml(detailTitle)}"
        aria-label="${week1EscapeHtml(detailTitle)}"
        style="
          position:absolute;
          left:${left};
          top:${top};
          width:${width};
          height:${height};
          border:0;
          border-radius:14px;
          padding:${tiny ? 8 : small ? 10 : 14}px;
          text-align:left;
          cursor:pointer;
          color:${fg};
          background:${bg};
          overflow:hidden;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
        ">
        <div style="
          position:absolute;
          inset:0;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          min-width:0;
          padding:${tiny ? 10 : 14}px;
          padding-bottom:${tiny ? 10 : 14}px;
          text-align:center;
        ">
          <div>
            <div style="font-size:${symbolFontSize}px;font-weight:800;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${week1EscapeHtml(r.stock?.symbol || '—')}</div>
          </div>
        </div>

      </button>`;
  }

  function week1RenderTreemapSideItem(row, totalMV){
    const returnPct = Number.isFinite(row.totalReturnPct) ? row.totalReturnPct / 100 : 0;
    const allocation = totalMV > 0 ? row.marketValue / totalMV : 0;
    const sign = returnPct >= 0 ? '+' : '';
    const bg = week1TreemapColorForReturn(returnPct);
    const fg = week1TreemapTextColor(bg);
    const detailTitle = week1BuildTreemapDetailTitle(row, totalMV);
    return `
      <button
        type="button"
        class="week1-treemap-side-item"
        data-week1-treemap-item="1"
        data-stock-id="${week1EscapeHtml(row.stock?.id || '')}"
        data-tooltip="${week1EscapeHtml(detailTitle)}"
        aria-label="${week1EscapeHtml(detailTitle)}"
        style="background:${bg};color:${fg};">
        <div class="week1-treemap-side-left">
          <div class="week1-treemap-side-symbol">${week1EscapeHtml(row.stock?.symbol || '—')}</div>
          <div class="week1-treemap-side-name">${week1EscapeHtml(row.stock?.name || '')}</div>
        </div>
        <div class="week1-treemap-side-right">
          <div class="week1-treemap-side-return">${sign}${(returnPct * 100).toFixed(1)}%</div>
          <div class="week1-treemap-side-meta">${Math.round(row.marketValue).toLocaleString()} / ${(allocation * 100).toFixed(1)}%</div>
        </div>
      </button>`;
  }

  function week1BuildConfirmedTreemapLayout(sorted, totalMV){
    const layout = [];
    if(!sorted.length || !Number.isFinite(totalMV) || totalMV <= 0) return layout;

    const mainRows = sorted.slice(0, 6);
    const totalArea = 10000;
    const toArea = (row) => Math.max(0, (Math.max(0, Number(row.marketValue) || 0) / totalMV) * totalArea);
    const first = mainRows[0];
    const second = mainRows[1];
    const bottomRows = mainRows.slice(2);
    const firstArea = toArea(first);
    const leftW = Math.max(0, Math.min(100, firstArea / 100));

    if(first){
      layout.push({ kind: 'main', row: first, x: 0, y: 0, w: leftW, h: 100 });
    }
    if(sorted.length === 1 || leftW >= 100){
      return layout;
    }

    const rightX = leftW;
    const rightW = 100 - leftW;
    const secondArea = second ? toArea(second) : 0;
    const topH = second && rightW > 0 ? Math.max(0, Math.min(100, secondArea / rightW)) : 0;

    if(second){
      layout.push({ kind: 'main', row: second, x: rightX, y: 0, w: rightW, h: topH });
    }

    const bottomY = topH;
    const bottomH = 100 - topH;
    if(bottomH <= 0 || !bottomRows.length){
      return layout;
    }

    const bottomItems = bottomRows.map((row) => ({
      kind: 'main',
      row,
      area: toArea(row)
    }));

    let cursorX = rightX;
    bottomItems.forEach((item, index) => {
      const isLast = index === bottomItems.length - 1;
      const exactWidth = bottomH > 0 ? item.area / bottomH : 0;
      const width = isLast ? (100 - cursorX) : exactWidth;
      if(width <= 0) return;

      layout.push({
        kind: 'main',
        row: item.row,
        x: cursorX,
        y: bottomY,
        w: width,
        h: bottomH
      });

      cursorX += width;
    });

    return layout;
  }

  function week1RenderTreemapHybrid(container, metrics, totalMV){
    container.style.overflow = 'visible';
    container.style.height = 'auto';

    const sorted = metrics
      .slice()
      .sort((a, b) => b.marketValue - a.marketValue);
    const mobile = window.innerWidth <= 980;
    const mainHeight = 360;

    if(mobile){
      const sideHtml = sorted.map((row) => week1RenderTreemapSideItem(row, totalMV)).join('');
      container.innerHTML = `
        <div class="week1-treemap-hybrid">
          <div class="week1-treemap-side">${sideHtml}</div>
        </div>`;
      week1BindTreemapInteractions(container);
      return;
    }

    const layoutRects = week1BuildConfirmedTreemapLayout(sorted, totalMV);
    const sideRows = sorted.slice(6);
    const mainHtml = layoutRects.map((item) => {
      if(item.kind === 'side'){
        const row = item.row;
        const returnPct = Number.isFinite(row.totalReturnPct) ? row.totalReturnPct / 100 : 0;
        const sign = returnPct >= 0 ? '+' : '';
        const bg = week1TreemapColorForReturn(returnPct);
        const fg = week1TreemapTextColor(bg);
        const detailTitle = week1BuildTreemapDetailTitle(row, totalMV);
        const inset = 4;
        const left = `calc(${item.x.toFixed(4)}% + ${inset}px)`;
        const top = `calc(${item.y.toFixed(4)}% + ${inset}px)`;
        const width = `calc(${item.w.toFixed(4)}% - ${inset * 2}px)`;
        const height = `calc(${item.h.toFixed(4)}% - ${inset * 2}px)`;
        const tiny = item.h < 12;
        const symbolFontSize = Math.max(11, Math.min(14, Math.round(9 + item.h * 0.12)));
        const returnFontSize = Math.max(9, Math.min(11, Math.round(8 + item.h * 0.08)));
        return `
          <button
            type="button"
            data-week1-treemap-item="1"
            data-stock-id="${week1EscapeHtml(row.stock?.id || '')}"
            data-tooltip="${week1EscapeHtml(detailTitle)}"
            aria-label="${week1EscapeHtml(detailTitle)}"
            style="
              position:absolute;
              left:${left};
              top:${top};
              width:${width};
              height:${height};
              border:0;
              border-radius:12px;
              padding:${tiny ? 6 : 8}px;
              text-align:center;
              cursor:pointer;
              color:${fg};
              background:${bg};
              overflow:hidden;
              box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
              display:flex;
              flex-direction:column;
              align-items:center;
              justify-content:center;
              gap:3px;
            ">
            <div style="font-size:${symbolFontSize}px;font-weight:800;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${week1EscapeHtml(row.stock?.symbol || '—')}</div>
          </button>`;
      }
      return week1RenderTreemapMainTile(item, totalMV);
    }).join('');

    container.innerHTML = `
      <div class="week1-treemap-hybrid">
        <div class="week1-treemap-main" style="height:${mainHeight}px">
          <div class="week1-treemap-main-canvas">${mainHtml}</div>
        </div>
        ${sideRows.length ? `<div class="week1-treemap-side week1-treemap-side-secondary">${sideRows.map((row) => week1RenderTreemapSideItem(row, totalMV)).join('')}</div>` : ''}
      </div>`;

    week1BindTreemapInteractions(container);
  }

  function week1RenderTreemapSimpleFallback(container, metrics, totalMV){
    const sorted = metrics
      .slice()
      .sort((a, b) => b.marketValue - a.marketValue);

    container.style.overflow = 'visible';
    container.style.height = 'auto';
    container.innerHTML = `
      <div style="
        display:grid;
        grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));
        gap:12px;
        min-height:320px;
      ">
        ${sorted.map((row) => {
          const returnPct = Number.isFinite(row.totalReturnPct) ? row.totalReturnPct / 100 : 0;
          const sign = returnPct >= 0 ? '+' : '';
          const allocation = totalMV > 0 ? row.marketValue / totalMV : 0;
          const bg = week1TreemapColorForReturn(returnPct);
          const fg = week1TreemapTextColor(bg);
          const detailTitle = week1BuildTreemapDetailTitle(row, totalMV);
          return `
            <button
              type="button"
              data-week1-treemap-item="1"
              data-stock-id="${week1EscapeHtml(row.stock?.id || '')}"
              data-tooltip="${week1EscapeHtml(detailTitle)}"
              aria-label="${week1EscapeHtml(detailTitle)}"
              style="
                border:0;
                border-radius:14px;
                padding:14px;
                min-height:96px;
                text-align:left;
                cursor:pointer;
                color:${fg};
                background:${bg};
                box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
                display:flex;
                flex-direction:column;
                justify-content:space-between;
                gap:10px;
              ">
              <div style="min-width:0">
                <div style="font-size:16px;font-weight:800;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${week1EscapeHtml(row.stock?.symbol || '—')}</div>
                <div style="margin-top:4px;font-size:12px;opacity:.82;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${week1EscapeHtml(row.stock?.name || '')}</div>
              </div>
              <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px">
                <div style="font-size:15px;font-weight:800;line-height:1">${sign}${(returnPct * 100).toFixed(1)}%</div>
                <div style="font-size:11px;font-weight:700;opacity:.9;line-height:1.25;text-align:right">${Math.round(row.marketValue).toLocaleString()} / ${(allocation * 100).toFixed(1)}%</div>
              </div>
            </button>`;
        }).join('')}
      </div>`;

    week1BindTreemapInteractions(container);
  }

  function week1EnsureHighchartsTreemapModule(){
    if(typeof Highcharts === 'undefined') return Promise.resolve();
    if(week1IsTreemapSeriesAvailable()) return Promise.resolve();
    if(window.__week1TreemapModulePromise) return window.__week1TreemapModulePromise;

    window.__week1TreemapModulePromise = (async () => {
      const major = String((Highcharts && Highcharts.version) || '11').split('.')[0] || '11';
      const urls = [
        'js/vendor/highcharts-treemap.js',
        `https://code.highcharts.com/${major}/modules/treemap.js`,
        `https://cdn.jsdelivr.net/npm/highcharts@${major}/modules/treemap.js`,
        `https://unpkg.com/highcharts@${major}/modules/treemap.js`,
        'https://code.highcharts.com/modules/treemap.js'
      ];

      for(const url of urls){
        if(week1IsTreemapSeriesAvailable()) return;
        try{
          await week1AppendTreemapModuleScript(url);
          if(week1IsTreemapSeriesAvailable()) return;
        }catch(err){
          console.warn('[WEEK1-UPGRADE] treemap 模組載入失敗，改試下一個來源：', url, err);
        }
      }
      throw new Error('treemap module unavailable');
    })().finally(() => {
      if(!week1IsTreemapSeriesAvailable()){
        window.__week1TreemapModulePromise = null;
      }
    });

    return window.__week1TreemapModulePromise;
  }

  function week1RenderTreemapFallback(container, metrics, totalMV){
    container.style.overflow = 'hidden';
    const layoutItems = metrics
      .slice()
      .sort((a, b) => b.marketValue - a.marketValue)
      .map((r) => ({ row: r, weight: Math.max(1, r.marketValue) }));
    const layoutRects = week1BuildTreemapLayout(layoutItems);

    const items = layoutRects.map((item) => {
      const r = item.row;
      const returnPct = Number.isFinite(r.totalReturnPct) ? r.totalReturnPct / 100 : 0;
      const allocation = totalMV > 0 ? r.marketValue / totalMV : 0;
      const sign = returnPct >= 0 ? '+' : '';
      const bg = week1TreemapColorForReturn(returnPct);
      const fg = week1TreemapTextColor(bg);
      const inset = 4;
      const left = `calc(${item.x.toFixed(4)}% + ${inset}px)`;
      const top = `calc(${item.y.toFixed(4)}% + ${inset}px)`;
      const width = `calc(${item.w.toFixed(4)}% - ${inset * 2}px)`;
      const height = `calc(${item.h.toFixed(4)}% - ${inset * 2}px)`;
      const small = item.w < 18 || item.h < 18;
      const tiny = item.w < 12 || item.h < 12;
      const sizeKey = Math.min(item.w, item.h);
      const symbolFontSize = Math.max(13, Math.min(22, Math.round(11 + sizeKey * 0.22)));
      const nameFontSize = Math.max(11, Math.min(15, Math.round(9 + sizeKey * 0.12)));
      const detailTitle = [
        `${r.stock?.symbol || '—'} ${r.stock?.name || ''}`.trim(),
        `含息報酬率：${sign}${(returnPct * 100).toFixed(1)}%`,
        `市值：${Math.round(r.marketValue).toLocaleString()}`,
        `配置：${(allocation * 100).toFixed(1)}%`,
        `含息損益：${Math.round(Number.isFinite(r.totalPnlWithFees) ? r.totalPnlWithFees : 0).toLocaleString()}`
      ].join('\n');
      return `
        <button
          type="button"
          class="week1-treemap-fallback-item"
          data-stock-id="${week1EscapeHtml(r.stock?.id || '')}"
          data-tooltip="${week1EscapeHtml(detailTitle)}"
          aria-label="${week1EscapeHtml(detailTitle)}"
          style="
            position:absolute;
            left:${left};
            top:${top};
            width:${width};
            height:${height};
            border:0;
            border-radius:14px;
            padding:${tiny ? 8 : small ? 10 : 14}px;
            text-align:left;
            cursor:pointer;
            color:${fg};
            background:${bg};
            overflow:hidden;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
          ">
          <div style="
            position:absolute;
            inset:0;
            display:flex;
            flex-direction:column;
            align-items:center;
            justify-content:center;
            min-width:0;
            padding:${tiny ? 10 : 14}px;
            padding-bottom:${tiny ? 10 : 14}px;
            text-align:center;
          ">
            <div>
              <div style="font-size:${symbolFontSize}px;font-weight:800;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${week1EscapeHtml(r.stock?.symbol || '—')}</div>
            </div>
          </div>

        </button>`;
    }).join('');

    container.innerHTML = `
      <div style="
        position:relative;
        width:100%;
        height:100%;
        min-height:320px;
      ">${items}</div>`;

    container.querySelectorAll('.week1-treemap-fallback-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (typeof goHoldings === 'function') goHoldings();
      });
      el.addEventListener('mouseenter', (event) => {
        week1ShowTreemapTooltip(el.dataset.tooltip || '', event.clientX, event.clientY);
      });
      el.addEventListener('mousemove', (event) => {
        week1MoveTreemapTooltip(event.clientX, event.clientY);
      });
      el.addEventListener('mouseleave', () => {
        week1HideTreemapTooltip();
      });
      el.addEventListener('focus', () => {
        const rect = el.getBoundingClientRect();
        week1ShowTreemapTooltip(el.dataset.tooltip || '', rect.right, rect.top);
      });
      el.addEventListener('blur', () => {
        week1HideTreemapTooltip();
      });
    });
  }

  function renderTreemap(summary = calculatePortfolioSummary()) {
    const container = document.getElementById('overview-treemap');
    if (!container) return;
    const renderSeq = ++week1TreemapRenderSeq;
    const metrics = computeStockMetrics(summary).filter(r => r.qty > 0 && r.marketValue > 0);
    if (metrics.length === 0) {
      if(week1OverviewTreemapChart){
        try { week1OverviewTreemapChart.destroy(); } catch(e) { /* ignore */ }
        week1OverviewTreemapChart = null;
      }
      container.style.overflow = 'hidden';
      container.innerHTML = '<div class="empty">尚無持股資料</div>';
      return;
    }
    const totalMV = metrics.reduce((s, r) => s + r.marketValue, 0);

    if(week1TreemapPreferFallback){
      week1RenderTreemapFallback(container, metrics, totalMV);
      return;
    }

    if(!week1OverviewTreemapChart && !container.innerHTML.trim()){
      container.style.overflow = 'hidden';
      container.innerHTML = '<div class="empty">載入持股地圖中...</div>';
    }

    loadHighchartsIfNeeded().then(() => {
      if(renderSeq !== week1TreemapRenderSeq) return;
      if (!week1IsTreemapSeriesAvailable()) {
        week1TreemapPreferFallback = true;
        week1RenderTreemapFallback(container, metrics, totalMV);
        return;
      }

      const data = metrics.map(r => {
        const returnPct = Number.isFinite(r.totalReturnPct) ? r.totalReturnPct / 100 : 0;
        const color = week1TreemapColorForReturn(returnPct);
        return {
          name: r.stock?.symbol || '—',
          value: r.marketValue,
          color,
          custom: {
            stockName: r.stock?.name || '',
            returnPct,
            allocation: totalMV > 0 ? r.marketValue / totalMV : 0,
            totalPnl: Number.isFinite(r.totalPnlWithFees) ? r.totalPnlWithFees : 0,
            textColor: week1TreemapTextColor(color)
          }
        };
      });

      if(week1OverviewTreemapChart){
        try { week1OverviewTreemapChart.destroy(); } catch(e) { /* ignore */ }
        week1OverviewTreemapChart = null;
      }

      container.style.overflow = 'hidden';
      week1OverviewTreemapChart = Highcharts.chart('overview-treemap', {
        chart: { backgroundColor: 'transparent' },
        credits: { enabled: false },
        title: { text: null },
        series: [{
          type: 'treemap',
          layoutAlgorithm: 'squarified',
          data: data,
          dataLabels: {
            enabled: true,
            useHTML: true,
            style: { textOutline: 'none' },
            formatter: function () {
              const textColor = this.point.custom?.textColor || '#ffffff';
              return `<div style="font-size:16px;font-weight:800;line-height:1.1;color:${textColor}">${this.point.name}</div>`;
            }
          },
          point: {
            events: {
              click: function () {
                if (typeof goHoldings === 'function') goHoldings();
              }
            }
          }
        }],
        tooltip: {
          useHTML: true,
          padding: 8,
          distance: 12,
          style: {
            whiteSpace: 'normal',
            width: '190px',
            maxWidth: '190px',
            fontSize: '12px',
            lineHeight: '1.45'
          },
          formatter: function () {
            const c = this.point.custom;
            const pct = (c.returnPct * 100).toFixed(2);
            const alloc = (c.allocation * 100).toFixed(1);
            const sign = c.returnPct >= 0 ? '+' : '';
            return `<div style="width:190px;white-space:normal;word-break:break-word;">
              ${this.point.name} ${c.stockName}<br>
              含息報酬率：${sign}${pct}%<br>
              市值：${Math.round(this.point.value).toLocaleString()}<br>
              配置：${alloc}%<br>
              含息損益：${Math.round(c.totalPnl).toLocaleString()}
            </div>`;
          }
        }
      });
      // 建圖當下容器寬度可能尚未穩定（會落在 Highcharts 預設 600px），下一個 frame 校正尺寸
      window.requestAnimationFrame(() => {
        try{
          const ch = week1OverviewTreemapChart;
          if(ch && renderSeq === week1TreemapRenderSeq){
            const w = container.getBoundingClientRect().width;
            if(w > 0 && Math.abs(ch.chartWidth - w) > 1) ch.reflow();
          }
        }catch(e){ /* ignore */ }
      });
    }).catch((err) => {
      if(renderSeq !== week1TreemapRenderSeq) return;
      console.warn('[renderTreemap] Highcharts failed, using fallback', err);
      week1TreemapPreferFallback = true;
      week1RenderTreemapFallback(container, metrics, totalMV);
    });
  }

  function computeDrawdownSeries() {
    const renderableSnapshots = getRenderableSnapshots();
    if (renderableSnapshots.length < 2) return [];

    const sorted = [...renderableSnapshots].sort((a, b) => {
      const da = new Date(a.date || a.time).getTime();
      const db = new Date(b.date || b.time).getTime();
      return da - db;
    });

    let peak = -Infinity;
    const out = [];
    for (const s of sorted) {
      const valueRaw = s.total ?? s.totalAsset ?? s.asset ?? s.value ?? 0;
      const value = parseN(valueRaw);
      const dateRaw = s.date || s.time;
      const ts = new Date(dateRaw).getTime();
      if (!Number.isFinite(value) || value <= 0) continue;
      if (!Number.isFinite(ts)) continue;
      if (value > peak) peak = value;
      const dd = peak > 0 ? (value - peak) / peak : 0;
      const date = String(dateRaw).slice(0, 10);
      out.push({
        date,
        value: value,
        peak: peak,
        drawdownPct: dd
      });
    }
    return out;
  }

  // KPI 用回撤指標：沿用 computeDrawdownSeries 口徑，並把「今日總資產」視為最新一筆
  function computeDrawdownKpi(currentTotal){
    const series = computeDrawdownSeries();
    const result = {
      maxDrawdownPct: null,
      currentDrawdownPct: null,
      maxDrawdownTitle: '',
      currentDrawdownTitle: ''
    };
    if(series.length < 2) return result;

    let peak = series.reduce((m, p) => Math.max(m, p.peak), 0);
    let mddPoint = series[0];
    for(const p of series){
      if(p.drawdownPct < mddPoint.drawdownPct) mddPoint = p;
    }
    let maxDd = mddPoint.drawdownPct;
    let mddDate = mddPoint.date;

    const cur = parseN(currentTotal);
    if(Number.isFinite(cur) && cur > 0){
      if(cur > peak) peak = cur;
      const curDd = peak > 0 ? (cur - peak) / peak : 0;
      if(curDd < maxDd){
        maxDd = curDd;
        mddDate = localDateStr();
      }
      result.currentDrawdownPct = curDd * 100;
      result.currentDrawdownTitle = `今日總資產 ${fmtInt.format(Math.round(cur))}；歷史峰值 ${fmtInt.format(Math.round(peak))}`;
    }
    result.maxDrawdownPct = maxDd * 100;
    result.maxDrawdownTitle = `最大回撤發生於 ${mddDate}`;
    return result;
  }

  function renderDrawdownChart() {
    const container = document.getElementById('drawdown-chart');
    const wrap = document.getElementById('drawdown-chart-wrap');
    const msgEl = document.getElementById('drawdown-chart-msg');
    const statsEl = document.getElementById('drawdown-stats');
    if (!container || !wrap || !statsEl) return;
    const series = computeDrawdownSeries();
    if (series.length < 2) {
      container.style.display = 'none';
      if(msgEl){
        msgEl.style.display = '';
        msgEl.textContent = '需要至少 2 筆快照才能計算回撤';
      }
      statsEl.textContent = '';
      return;
    }

    container.style.display = '';
    if(msgEl){ msgEl.style.display = 'none'; msgEl.textContent = ''; }

    const chartData = series.map(p => [
      new Date(p.date).getTime(),
      +(p.drawdownPct * 100).toFixed(2)
    ]);

    let mddPoint = series[0];
    for (const p of series) {
      if (p.drawdownPct < mddPoint.drawdownPct) mddPoint = p;
    }
    const mddPct = (mddPoint.drawdownPct * 100).toFixed(2);
    const mddDate = new Date(mddPoint.date).toLocaleDateString('zh-TW');

    const last = series[series.length - 1];
    const currentInDrawdown = last.drawdownPct < -0.001;
    let currentText;
    if (currentInDrawdown) {
      let lastPeakIdx = series.length - 1;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].value >= last.peak) { lastPeakIdx = i; break; }
      }
      const daysSincePeak = Math.round(
        (new Date(last.date).getTime() - new Date(series[lastPeakIdx].date).getTime())
        / 86400000
      );
      currentText = `目前回撤 ${(last.drawdownPct * 100).toFixed(2)}%，距上次峰值已 ${daysSincePeak} 天`;
    } else {
      currentText = '✓ 目前已創歷史新高';
    }

    // Drawdown chart only needs base Highcharts (no treemap module).
    // Avoid loadHighchartsIfNeeded() which blocks on treemap loading.
    if (typeof Highcharts !== 'undefined') {
      try {
        Highcharts.chart('drawdown-chart', {
          chart: { type: 'area', backgroundColor: 'transparent' },
          credits: { enabled: false },
          title: { text: null },
          xAxis: { type: 'datetime' },
          yAxis: {
            title: { text: '回撤 %' },
            max: 0,
            labels: { formatter: function () { return this.value + '%'; } }
          },
          legend: { enabled: false },
          series: [{
            name: '回撤',
            data: chartData,
            color: '#DC2626',
            fillOpacity: 0.15,
            lineWidth: 2
          }],
          tooltip: {
            formatter: function () {
              const p = series.find(x => new Date(x.date).getTime() === this.x);
              if (!p) return '';
              return `${new Date(p.date).toLocaleDateString('zh-TW')}<br>總資產：${Math.round(p.value).toLocaleString()}<br>歷史峰值：${Math.round(p.peak).toLocaleString()}<br>回撤：${(p.drawdownPct * 100).toFixed(2)}%`;
            }
          }
        });
        statsEl.innerHTML = `最大回撤 (MDD)：${mddPct}%（發生於 ${mddDate}）　|　${currentText}`;
        return;
      } catch(e) { /* fall through to SVG fallback */ }
    }

    // Highcharts not yet loaded or failed — use built-in SVG fallback.
    // If another return chart is concurrently loading Highcharts, retry a few times first.
    if (typeof Highcharts === 'undefined') {
      const tryCount = (renderDrawdownChart._retries || 0) + 1;
      renderDrawdownChart._retries = tryCount;
      if (tryCount <= 8) {
        if(msgEl){
          msgEl.style.display = '';
          msgEl.textContent = '載入回撤圖表中…';
        }
        setTimeout(() => renderDrawdownChart(), 400);
        return;
      }
    }

    renderDrawdownChart._retries = 0;
    if(msgEl){ msgEl.style.display = 'none'; msgEl.textContent = ''; }
    renderDrawdownChartFallback(container, series);
    statsEl.innerHTML = `最大回撤 (MDD)：${mddPct}%（發生於 ${mddDate}）　|　${currentText}`;
  }
