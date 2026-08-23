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
          <div class="cash-stat"><span class="lbl">自由現金總額</span><span class="val">${fmtAmt(d.cashAmount)}</span></div>
          <div class="cash-stat"><span class="lbl">自由現金比例</span><span class="val ${belowFloorNow ? 'neg-text' : ''}">${fmtPct1v(cashPct)}</span></div>
          <div class="cash-stat"><span class="lbl">需保留</span><span class="val">${floorPct != null ? `${floorPct}%` : '未設定'}${Number.isFinite(floorAmount) ? `（${fmtAmt(floorAmount)}）` : ''}</span></div>
          <div class="cash-stat"><span class="lbl">保留後可投資</span><span class="val">${fmtAmt(d.grossInvestableCash)}</span></div>
          <div class="cash-stat" title="工具頁筆記中有效買進計畫的全成交金額">
            <span class="lbl">預約單占用</span>
            <span class="val">${d.reservationCount > 0 ? `${fmtAmt(d.reservationBuyTotal)}（${d.reservationCount} 筆）` : '無買進預約'}</span>
          </div>
          <div class="cash-stat" title="自由現金 − 保留額 − 預約單占用">
            <span class="lbl">淨可投資金額</span>
            <span class="val ${belowFloorPost ? 'neg-text' : ''}">${fmtAmt(d.investableCash)}</span>
          </div>
        </div>
      </div>`;
  }
