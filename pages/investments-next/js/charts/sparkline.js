  // ========= Sparkline（近 5 日收盤迷你走勢，原生 SVG）=========
  // closes: [{date, close}]，至少 2 筆才繪製
  function buildSparklineSVG(closes, opts = {}){
    const rows = (Array.isArray(closes) ? closes : [])
      .map(r => ({ date: r?.date || '', close: parseN(r?.close) }))
      .filter(r => Number.isFinite(r.close) && r.close > 0);
    if(rows.length < 2) return '';
    const w = opts.width || 64;
    const h = opts.height || 20;
    const pad = 2;
    const values = rows.map(r => r.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = (max - min) || (max * 0.01) || 1;
    const stepX = (w - pad * 2) / (rows.length - 1);
    const pts = rows.map((r, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (r.close - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const up = values[values.length - 1] >= values[0];
    const color = up ? '#059669' : '#dc2626';
    const first = rows[0];
    const last = rows[rows.length - 1];
    const chgPct = first.close > 0 ? ((last.close - first.close) / first.close * 100) : null;
    const title = `近${rows.length}日收盤：${rows.map(r => `${String(r.date).slice(5)} ${r.close}`).join('、')}`
      + (Number.isFinite(chgPct) ? `（區間 ${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%）` : '');
    return `<svg class="holding-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><title>${title}</title>`
      + `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></polyline>`
      + `<circle cx="${pts[pts.length - 1].split(',')[0]}" cy="${pts[pts.length - 1].split(',')[1]}" r="1.8" fill="${color}"></circle>`
      + `</svg>`;
  }
