  // ========= 分層配置子彈圖（實際 bar + 目標刻度 + 容忍區間色帶）=========
  // rows: [{ key, label, actualPct, targetPct, color }]
  // tolerance: 容忍區間（±%）
  function renderTierBullet(container, rows, tolerance){
    if(!container) return;
    const tol = Number.isFinite(tolerance) ? tolerance : 5;
    const hasTargets = rows.some(r => Number.isFinite(r.targetPct));
    const scaleMax = Math.max(
      100,
      ...rows.map(r => Math.max(parseN(r.actualPct), Number.isFinite(r.targetPct) ? r.targetPct + tol : 0))
    );
    const toX = (v) => Math.max(0, Math.min(100, (v / scaleMax) * 100));

    const html = rows.map(r => {
      const actual = parseN(r.actualPct);
      const target = Number.isFinite(r.targetPct) ? r.targetPct : null;
      const diff = target != null ? actual - target : null;
      const over = diff != null && Math.abs(diff) > tol;
      const diffText = diff != null
        ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`
        : '—';
      const barColor = over ? '#dc2626' : (r.color || '#2563EB');
      const bandHtml = target != null
        ? `<div class="bullet-band" style="left:${toX(Math.max(0, target - tol)).toFixed(2)}%;width:${(toX(target + tol) - toX(Math.max(0, target - tol))).toFixed(2)}%"></div>`
        : '';
      const tickHtml = target != null
        ? `<div class="bullet-tick" style="left:${toX(target).toFixed(2)}%" title="目標 ${target}%"></div>`
        : '';
      const tooltip = target != null
        ? `${r.label}：實際 ${actual.toFixed(1)}%／目標 ${target}%（偏差 ${diffText}，容忍 ±${tol}%）`
        : `${r.label}：實際 ${actual.toFixed(1)}%（未設定目標）`;
      return `<div class="bullet-row${over ? ' bullet-over' : ''}" title="${tooltip}">
        <div class="bullet-label"><span class="bullet-dot" style="background:${r.color || '#2563EB'}"></span>${r.label}</div>
        <div class="bullet-track">
          ${bandHtml}
          <div class="bullet-bar" style="width:${toX(actual).toFixed(2)}%;background:${barColor}"></div>
          ${tickHtml}
        </div>
        <div class="bullet-vals">
          <span class="bullet-actual">${actual.toFixed(1)}%</span>
          <span class="bullet-target mini muted">${target != null ? `目標 ${target}%` : '未設目標'}</span>
          <span class="bullet-diff mini ${over ? 'neg-text' : 'muted'}">${diff != null ? `偏差 ${diffText}` : ''}</span>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = html + (hasTargets
      ? `<div class="mini muted" style="margin-top:6px">灰帶 = 目標 ±${tol}% 容忍區間；紅色 bar = 偏離超限。分母為總資產（含現金）。</div>`
      : `<div class="mini muted" style="margin-top:6px">尚未設定分層目標，點右上「設定目標」開始（建議初始值：核心75 / 衛星15 / 偵查5 / 現金5）。</div>`);
  }
