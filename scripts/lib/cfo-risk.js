'use strict';

// CFO 風險警訊（九項紅黃燈）。
//
// 2026-09-05：原本由 trading-dashboard :5050 的 /api/cfo-warnings 提供，Harry 決定停用該儀表板後
// 移轉到本機 proxy。門檻與判燈邏輯與原實作逐項一致，唯二差異：
//   1. 原實作的 VIX 連續天數與匯率壓力讀 trading.db 的 daily_indicator_records；
//      這裡改由 Yahoo 日線當場推算，不再依賴任何 SQLite。
//   2. 原實作的 history（前幾日紅燈數比較）來自 daily_cfo_risk_records，本機沒有等價歷史表，
//      因此回傳 history: null，並在 notes 說明。Observatory 與前端都不使用該欄位。

const THRESHOLDS = {
  tnxRed: 4.7,
  tnxSpikeAmber: 0.2,
  vixAmber: 22.0,
  vixRed: 24.0,
  vixRedDays: 3,
  currencyRed: 2.0,
  currencyAmber: 0.8,
  moveAmber: 100.0,
  moveRed: 120.0,
  skewAmber: 150.0,
  skewRed: 160.0,
  hygAmber: -0.5,
  hygRed: -1.5,
  brentAmber: 85.0,
  brentRed: 100.0,
  spreadAmber: 0.0,
  spreadRedRise: 0.5,
  biasHotRed: 8.0,
  biasHotAmber: 5.0,
  biasCold: -10.0
};

// key -> Yahoo symbol。bias 需要 60MA，因此用較長的 range。
const SERIES_SPEC = [
  { symbol: '^TNX', range: '3mo' },
  { symbol: '^VIX', range: '3mo' },
  { symbol: '^IRX', range: '3mo' },
  { symbol: '^MOVE', range: '3mo' },
  { symbol: '^SKEW', range: '3mo' },
  { symbol: 'HYG', range: '1mo' },
  { symbol: 'BZ=F', range: '1mo' },
  { symbol: 'DX-Y.NYB', range: '1mo' },
  { symbol: 'TWD=X', range: '1mo' },
  { symbol: '0050.TW', range: '6mo' }
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits) {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lastPoint(series) {
  return Array.isArray(series) && series.length ? series[series.length - 1] : null;
}

// 對齊 Python 版 _cfo_series_info：value、data_date、近 5 個交易日變化百分比。
function seriesInfo(series) {
  const tail = lastPoint(series);
  if (!tail) return { value: null, dataDate: null, pct5d: null };
  const value = tail.value;
  let pct5d = null;
  if (series.length >= 2) {
    const backIndex = Math.min(5, series.length - 1);
    const prev = series[series.length - 1 - backIndex].value;
    if (prev) pct5d = (value / prev - 1) * 100;
  }
  return { value, dataDate: tail.date, pct5d };
}

function makeWarning({ key, label, level, value, display, detail, subChecks, dataDate = null, source = 'yahoo' }) {
  // 與原實作一致：沒有資料時不得判為綠燈，改標 missing。
  if (value == null && level === 'ok') {
    return { key, label, level: 'missing', value: null, display: '--', detail: '資料不足，暫不判讀為綠燈', data_date: dataDate, source, sub_checks: subChecks };
  }
  return { key, label, level, value, display, detail, data_date: dataDate, source, sub_checks: subChecks };
}

function check(name, triggered, value) {
  return { name, triggered: Boolean(triggered), value };
}

function fmt(value, digits, suffix = '', signed = false) {
  if (value == null) return '--';
  const body = Math.abs(value).toFixed(digits);
  const sign = signed ? (value < 0 ? '-' : '+') : (value < 0 ? '-' : '');
  return `${sign}${body}${suffix}`;
}

// 連續多少個交易日收在門檻之上（由最新往回數）。
function consecutiveDaysAtOrAbove(series, threshold) {
  let count = 0;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].value >= threshold) count += 1;
    else break;
  }
  return count;
}

function overallStatus(redCount, amberCount, missingCount) {
  if (redCount === 0 && amberCount === 0 && missingCount >= 5) {
    return ['missing', '資料不足', '多數 CFO 風險資料未取得，暫不應解讀為全綠。'];
  }
  if (redCount >= 5) return ['red', '高度防守', '紅燈達 5 個以上，代表多個壓力面同步惡化，應以減碼、防守與等待恐慌為主。'];
  if (redCount >= 3) return ['red', '風險擴散', '紅燈達 3 個以上，風險已不只是單點壓力，應提高防守。'];
  if (redCount >= 1) return ['amber', '局部警戒', '已有紅燈，但尚未形成全面擴散；停止追高，保留現金並觀察是否增加。'];
  if (amberCount >= 3) return ['amber', '風險升溫', '黃燈偏多，市場壓力正在累積；降低買進速度。'];
  if (amberCount >= 1) return ['amber', '觀察', '有少數壓力指標轉黃；可持有，但不追高。'];
  return ['ok', '風險低', '目前系統性風險不高；若只有股市乖離偏高，重點是避免追高。'];
}

function groupLevel(keys, byKey) {
  const levels = keys.map((key) => byKey[key]?.level);
  if (levels.includes('red') || levels.filter((l) => l === 'amber').length >= 2) return 'red';
  if (levels.includes('amber')) return 'amber';
  if (levels.some((l) => l == null || l === 'missing')) return 'missing';
  return 'ok';
}

function groupSummary(warnings) {
  const byKey = Object.fromEntries(warnings.map((w) => [w.key, w]));
  const specs = [
    ['panic', '恐慌組', ['vix', 'skew'], 'VIX + SKEW', '觀察恐慌是否從避險需求擴散到股市波動。'],
    ['bond', '債市組', ['tnx', 'move'], '10Y + MOVE', '觀察利率急升是否伴隨債市波動放大。'],
    ['credit', '信用組', ['hyg', 'vix'], 'HYG + VIX', '觀察信用壓力是否和股市恐慌同步升高。'],
    ['currency', '匯率組', ['currency'], 'DXY + USD/TWD', '觀察美元與新台幣壓力是否推升外資風險。'],
    ['overheat', '過熱組', ['brent', 'bias'], 'Brent + 0050乖離', '觀察通膨壓力與股市過熱是否同時存在。']
  ];
  const statusText = { red: '同步惡化', amber: '觀察', missing: '資料不足' };
  return specs.map(([key, label, sourceKeys, metric, description]) => {
    const level = groupLevel(sourceKeys, byKey);
    return { key, label, metric, level, status: statusText[level] || '正常', description };
  });
}

/**
 * @param {object} deps
 * @param {(symbol: string, range: string) => Promise<Array<{date: string, value: number}>>} deps.fetchDailyCloses
 * @param {(source: string, message: string, error?: unknown) => void} [deps.logError]
 */
function createCfoRisk({ fetchDailyCloses, logError = () => {} }) {
  async function loadSeries() {
    const settled = await Promise.allSettled(
      SERIES_SPEC.map((spec) => fetchDailyCloses(spec.symbol, spec.range))
    );
    const out = {};
    settled.forEach((result, index) => {
      const { symbol } = SERIES_SPEC[index];
      if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length) {
        out[symbol] = result.value;
      } else {
        out[symbol] = [];
        if (result.status === 'rejected') logError('cfo-risk', `${symbol} 日線抓取失敗`, result.reason);
      }
    });
    return out;
  }

  function buildWarnings(series) {
    const t = THRESHOLDS;
    const warnings = [];

    // 1. 美 10Y 殖利率
    const tnxSeries = series['^TNX'] || [];
    const tnxInfo = seriesInfo(tnxSeries);
    const tnxClose = tnxInfo.value == null ? null : round(tnxInfo.value, 3);
    let tnxChange = null;
    if (tnxSeries.length >= 6) {
      tnxChange = round(tnxSeries[tnxSeries.length - 1].value - tnxSeries[tnxSeries.length - 6].value, 3);
    } else if (tnxSeries.length >= 2) {
      tnxChange = round(tnxSeries[tnxSeries.length - 1].value - tnxSeries[0].value, 3);
    }
    const tnxAbs = tnxClose != null && tnxClose >= t.tnxRed;
    const tnxSpike = tnxChange != null && tnxChange >= t.tnxSpikeAmber;
    warnings.push(makeWarning({
      key: 'tnx',
      label: '美 10Y 殖利率',
      level: tnxAbs ? 'red' : (tnxSpike ? 'amber' : 'ok'),
      value: tnxClose,
      display: tnxClose == null ? '--' : `${tnxClose.toFixed(3)}%`,
      detail: tnxChange != null ? `門檻 ${t.tnxRed}% / 5日變化 ${fmt(tnxChange, 3, '', true)}` : `門檻 ${t.tnxRed}%`,
      dataDate: tnxInfo.dataDate,
      subChecks: [
        check(`絕對值 > ${t.tnxRed}%`, tnxAbs, tnxClose == null ? '--' : `${tnxClose.toFixed(3)}%`),
        check(`5日急升 > ${t.tnxSpikeAmber}`, tnxSpike, fmt(tnxChange, 3, '', true))
      ]
    }));

    // 2. VIX 恐慌指數
    const vixSeries = series['^VIX'] || [];
    const vixInfo = seriesInfo(vixSeries);
    const vixNow = vixInfo.value == null ? null : round(vixInfo.value, 2);
    const vixConsec = consecutiveDaysAtOrAbove(vixSeries, t.vixRed);
    const vixConsecHit = vixConsec >= t.vixRedDays;
    const vixSingleHit = vixNow != null && vixNow >= t.vixAmber;
    warnings.push(makeWarning({
      key: 'vix',
      label: 'VIX 恐慌指數',
      level: vixConsecHit ? 'red' : (vixSingleHit ? 'amber' : 'ok'),
      value: vixNow,
      display: fmt(vixNow, 2),
      detail: `連續 > ${t.vixRed.toFixed(0)}：${vixConsec}/${t.vixRedDays} 天`,
      dataDate: vixInfo.dataDate,
      subChecks: [
        check(`單日 > ${t.vixAmber.toFixed(0)}`, vixSingleHit, fmt(vixNow, 2)),
        check(`連續${t.vixRedDays}天 > ${t.vixRed.toFixed(0)}`, vixConsecHit, `${vixConsec}/${t.vixRedDays}`)
      ]
    }));

    // 3. 匯率壓力 = DXY 5日% + USD/TWD 5日%
    const dxyPct = seriesInfo(series['DX-Y.NYB'] || []).pct5d;
    const twdPct = seriesInfo(series['TWD=X'] || []).pct5d;
    const cpVal = (dxyPct == null || twdPct == null) ? null : round(dxyPct + twdPct, 2);
    const cpRed = cpVal != null && cpVal >= t.currencyRed;
    const cpAmber = cpVal != null && cpVal >= t.currencyAmber;
    warnings.push(makeWarning({
      key: 'currency',
      label: '匯率壓力',
      level: cpRed ? 'red' : (cpAmber ? 'amber' : 'ok'),
      value: cpVal,
      display: fmt(cpVal, 2, '%', true),
      detail: 'DXY + USD/TWD 5日壓力',
      dataDate: seriesInfo(series['TWD=X'] || []).dataDate,
      subChecks: [check(`5日 >= ${t.currencyRed}%`, cpRed, fmt(cpVal, 2, '%', true))]
    }));

    // 4. MOVE 債券波動
    const moveInfo = seriesInfo(series['^MOVE'] || []);
    const moveVal = moveInfo.value == null ? null : round(moveInfo.value, 1);
    warnings.push(makeWarning({
      key: 'move',
      label: 'MOVE 債券波動',
      level: moveVal != null && moveVal >= t.moveRed ? 'red' : (moveVal != null && moveVal >= t.moveAmber ? 'amber' : 'ok'),
      value: moveVal,
      display: fmt(moveVal, 1),
      detail: `< ${t.moveAmber.toFixed(0)} 正常 / > ${t.moveRed.toFixed(0)} 壓力`,
      dataDate: moveInfo.dataDate,
      subChecks: [
        check(`> ${t.moveAmber.toFixed(0)} 黃燈`, moveVal != null && moveVal >= t.moveAmber, fmt(moveVal, 1)),
        check(`> ${t.moveRed.toFixed(0)} 紅燈`, moveVal != null && moveVal >= t.moveRed, fmt(moveVal, 1))
      ]
    }));

    // 5. SKEW 尾部風險
    const skewInfo = seriesInfo(series['^SKEW'] || []);
    const skewVal = skewInfo.value == null ? null : round(skewInfo.value, 1);
    warnings.push(makeWarning({
      key: 'skew',
      label: 'SKEW 尾部風險',
      level: skewVal != null && skewVal >= t.skewRed ? 'red' : (skewVal != null && skewVal >= t.skewAmber ? 'amber' : 'ok'),
      value: skewVal,
      display: fmt(skewVal, 1),
      detail: `< ${t.skewAmber.toFixed(0)} 正常 / > ${t.skewRed.toFixed(0)} 偏高`,
      dataDate: skewInfo.dataDate,
      subChecks: [
        check(`> ${t.skewAmber.toFixed(0)} 避險需求升`, skewVal != null && skewVal >= t.skewAmber, fmt(skewVal, 1)),
        check(`> ${t.skewRed.toFixed(0)} 尾部風險高`, skewVal != null && skewVal >= t.skewRed, fmt(skewVal, 1))
      ]
    }));

    // 6. 高收益債壓力（HYG 5日變化）
    const hygInfo = seriesInfo(series.HYG || []);
    const hyg5d = hygInfo.pct5d == null ? null : round(hygInfo.pct5d, 2);
    warnings.push(makeWarning({
      key: 'hyg',
      label: '高收益債壓力',
      level: hyg5d != null && hyg5d <= t.hygRed ? 'red' : (hyg5d != null && hyg5d <= t.hygAmber ? 'amber' : 'ok'),
      value: hyg5d,
      display: fmt(hyg5d, 2, '%', true),
      detail: hygInfo.value != null ? `HYG 5日 ${hygInfo.value.toFixed(2)}` : 'HYG 5日變化',
      dataDate: hygInfo.dataDate,
      subChecks: [
        check(`5日跌 > ${Math.abs(t.hygAmber)}% 黃燈`, hyg5d != null && hyg5d <= t.hygAmber, fmt(hyg5d, 2, '%', true)),
        check(`5日跌 > ${Math.abs(t.hygRed)}% 紅燈`, hyg5d != null && hyg5d <= t.hygRed, fmt(hyg5d, 2, '%', true))
      ]
    }));

    // 7. Brent 原油
    const brentInfo = seriesInfo(series['BZ=F'] || []);
    const brentVal = brentInfo.value == null ? null : round(brentInfo.value, 2);
    warnings.push(makeWarning({
      key: 'brent',
      label: 'Brent 原油',
      level: brentVal != null && brentVal >= t.brentRed ? 'red' : (brentVal != null && brentVal >= t.brentAmber ? 'amber' : 'ok'),
      value: brentVal,
      display: brentVal == null ? '--' : `$${brentVal.toFixed(2)}`,
      detail: `< $${t.brentAmber.toFixed(0)} 正常 / > $${t.brentRed.toFixed(0)} 紅燈`,
      dataDate: brentInfo.dataDate,
      subChecks: [
        check(`> $${t.brentAmber.toFixed(0)} 通膨壓力`, brentVal != null && brentVal >= t.brentAmber, brentVal == null ? '--' : `$${brentVal.toFixed(2)}`),
        check(`> $${t.brentRed.toFixed(0)} 地緣風險`, brentVal != null && brentVal >= t.brentRed, brentVal == null ? '--' : `$${brentVal.toFixed(2)}`)
      ]
    }));

    // 8. 10Y-2Y 利差（^TNX - ^IRX，依日期對齊）
    const irxSeries = series['^IRX'] || [];
    const irxByDate = new Map(irxSeries.map((point) => [point.date, point.value]));
    const combined = tnxSeries
      .filter((point) => irxByDate.has(point.date))
      .map((point) => ({ date: point.date, value: point.value - irxByDate.get(point.date) }));
    let spreadVal = null;
    let spreadRise = null;
    let spreadDate = null;
    if (combined.length >= 2) {
      spreadVal = round(combined[combined.length - 1].value, 3);
      spreadDate = combined[combined.length - 1].date;
      if (combined.length >= 22) {
        spreadRise = round(spreadVal - combined[combined.length - 22].value, 3);
      } else if (combined.length >= 5) {
        spreadRise = round(spreadVal - combined[0].value, 3);
      }
    }
    const inverted = spreadVal != null && spreadVal < t.spreadAmber;
    const rapidRise = spreadRise != null && spreadRise >= t.spreadRedRise && spreadVal != null && spreadVal >= -0.1;
    warnings.push(makeWarning({
      key: 'spread',
      label: '10Y-2Y 利差',
      level: rapidRise ? 'red' : (inverted ? 'amber' : 'ok'),
      value: spreadVal,
      display: fmt(spreadVal, 3, '%', true),
      detail: spreadRise != null ? `30日變化 ${fmt(spreadRise, 3, '', true)}` : '殖利率曲線',
      dataDate: spreadDate,
      subChecks: [
        check('倒掛（< 0）', inverted, fmt(spreadVal, 3, '%', true)),
        check('30日急升 > 0.5 轉正', rapidRise, fmt(spreadRise, 3, '', true))
      ]
    }));

    // 9. 大盤季線乖離率（0050 vs 60MA）
    const twSeries = series['0050.TW'] || [];
    let biasVal = null;
    let biasDate = null;
    if (twSeries.length >= 60) {
      const window = twSeries.slice(-60);
      const ma60 = window.reduce((sum, point) => sum + point.value, 0) / window.length;
      const closeNow = twSeries[twSeries.length - 1].value;
      if (ma60 > 0) biasVal = round((closeNow / ma60 - 1) * 100, 2);
      biasDate = twSeries[twSeries.length - 1].date;
    }
    const biasOpportunity = biasVal != null && biasVal <= t.biasCold;
    warnings.push(makeWarning({
      key: 'bias',
      label: '大盤季線乖離率',
      level: biasVal != null && biasVal >= t.biasHotRed ? 'red' : (biasVal != null && biasVal >= t.biasHotAmber ? 'amber' : 'ok'),
      value: biasVal,
      display: `${fmt(biasVal, 2, '%', true)}${biasOpportunity ? ' (機會)' : ''}`,
      detail: '0050 vs 60MA',
      dataDate: biasDate,
      subChecks: [
        check(`正乖離 > ${t.biasHotAmber}% 偏熱`, biasVal != null && biasVal >= t.biasHotAmber, fmt(biasVal, 2, '%', true)),
        check(`正乖離 > ${t.biasHotRed}% 過熱`, biasVal != null && biasVal >= t.biasHotRed, fmt(biasVal, 2, '%', true)),
        check(`負乖離 < ${t.biasCold}% 機會`, biasOpportunity, fmt(biasVal, 2, '%', true))
      ]
    }));

    return warnings;
  }

  async function buildCfoRiskSnapshot() {
    const series = await loadSeries();
    const warnings = buildWarnings(series);
    const redCount = warnings.filter((w) => w.level === 'red').length;
    const amberCount = warnings.filter((w) => w.level === 'amber').length;
    const missingCount = warnings.filter((w) => w.level === 'missing').length;
    const [overallLevel, statusLabel, interpretation] = overallStatus(redCount, amberCount, missingCount);
    return {
      date: new Date().toISOString().slice(0, 10),
      warnings,
      groups: groupSummary(warnings),
      overall_level: overallLevel,
      status_label: statusLabel,
      red_count: redCount,
      amber_count: amberCount,
      missing_count: missingCount,
      history: null,
      interpretation,
      updated_at: new Date().toISOString(),
      source: 'proxy/yahoo',
      notes: ['本機 proxy 版不保存每日紅燈歷史，history 固定為 null；門檻與判燈邏輯與原 trading-dashboard 實作一致。']
    };
  }

  return { buildCfoRiskSnapshot };
}

module.exports = { createCfoRisk, CFO_THRESHOLDS: THRESHOLDS, CFO_SERIES_SPEC: SERIES_SPEC, __test: { seriesInfo, consecutiveDaysAtOrAbove, overallStatus, num } };
