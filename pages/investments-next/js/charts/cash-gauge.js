  // ========= 現金治理水位計 =========
  // data: { cashAmount, cashPct, floorPct, reservationCount, reservationBuyTotal,
  //         postFillCashAmount, postFillCashPct, totalAssets }
  function renderCashGauge(container, data){
    if(!container) return;
    const d = data || {};
    const cashPct = parseN(d.cashPct);
    const floorPct = Number.isFinite(d.floorPct) ? d.floorPct : null;
    const postPct = Number.isFinite(d.postFillCashPct) ? d.postFillCashPct : null;
    const scaleMax = Math.max(10, Math.ceil(Math.max(cashPct, floorPct || 0, postPct || 0) * 1.4));
    const toY = (v) => Math.max(0, Math.min(100, (v / scaleMax) * 100));

    const belowFloorNow = floorPct != null && cashPct < floorPct;
    const belowFloorPost = floorPct != null && postPct != null && postPct < floorPct;
    const stateClass = belowFloorNow ? 'cash-danger' : (belowFloorPost ? 'cash-warn' : 'cash-ok');

    const fmtAmt = (v) => Number.isFinite(v) ? fmtInt.format(Math.round(v)) : '—';
    const fmtPct1v = (v) => Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';

    const floorAmount = floorPct != null && Number.isFinite(d.totalAssets) ? d.totalAssets * floorPct / 100 : null;
    const headroom = Number.isFinite(d.postFillCashAmount) && Number.isFinite(floorAmount)
      ? d.postFillCashAmount - floorAmount : null;

    container.innerHTML = `
      <div class="cash-gauge ${stateClass}">
        <div class="cash-gauge-bar" title="現金比例 = 可用現金 ÷ 總資產 = ${fmtAmt(d.cashAmount)} ÷ ${fmtAmt(d.totalAssets)} = ${fmtPct1v(cashPct)}">
          <div class="cash-gauge-track">
            <div class="cash-gauge-fill" style="height:${toY(cashPct).toFixed(1)}%"></div>
            ${postPct != null ? `<div class="cash-gauge-post" style="height:${toY(postPct).toFixed(1)}%" title="預約單全成交後現金比例 ${fmtPct1v(postPct)}"></div>` : ''}
            ${floorPct != null ? `<div class="cash-gauge-floor" style="bottom:${toY(floorPct).toFixed(1)}%" title="安全線 ${floorPct}%"></div>` : ''}
          </div>
          <div class="cash-gauge-axis mini muted"><span>${scaleMax}%</span><span>0%</span></div>
        </div>
        <div class="cash-gauge-stats">
          <div class="cash-stat"><span class="lbl">可用現金</span><span class="val">${fmtAmt(d.cashAmount)}</span></div>
          <div class="cash-stat"><span class="lbl">現金比例</span><span class="val ${belowFloorNow ? 'neg-text' : ''}">${fmtPct1v(cashPct)}</span></div>
          <div class="cash-stat"><span class="lbl">安全線</span><span class="val">${floorPct != null ? `${floorPct}%` : '未設定'}${Number.isFinite(floorAmount) ? `（${fmtAmt(floorAmount)}）` : ''}</span></div>
          <div class="cash-stat" title="工具頁筆記中「觀察中／今日關注」買進計畫的 Σ(計畫價 × 張數 × 1000)，依 V2.1 全成交假設">
            <span class="lbl">預約單需現金</span>
            <span class="val">${d.reservationCount > 0 ? `${fmtAmt(d.reservationBuyTotal)}（${d.reservationCount} 筆）` : '無買進預約'}</span>
          </div>
          <div class="cash-stat" title="可用現金 − 預約單需現金 = 全成交後現金">
            <span class="lbl">全成交後現金</span>
            <span class="val ${belowFloorPost ? 'neg-text' : ''}">${fmtAmt(d.postFillCashAmount)}（${fmtPct1v(postPct)}）</span>
          </div>
          <div class="cash-stat" title="全成交後現金 − 安全線金額">
            <span class="lbl">距安全線餘裕</span>
            <span class="val ${Number.isFinite(headroom) && headroom < 0 ? 'neg-text' : ''}">${Number.isFinite(headroom) ? `${headroom >= 0 ? '+' : ''}${fmtAmt(Math.abs(headroom) * (headroom < 0 ? -1 : 1))}` : '—'}</span>
          </div>
        </div>
      </div>`;
  }
