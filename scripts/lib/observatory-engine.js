'use strict';

// Observatory 決策引擎（純函式，無 IO）。
//
// 由 tools/portfolio-observatory/observatory_engine.py 移植，門檻沿用該工具 config.json 的預設值，
// 好讓兩邊在並行期間可以逐項對帳。設計原則同原版：規則式、可解釋，不用黑箱模型。
//
// 與 Python 版的差異（刻意為之）：
//   1. 過熱評估移除「市場警示層」項目 —— 該欄位原本來自 trading-dashboard :5050 的 vnext 決策層，
//      Harry 已停用該儀表板，沒有等價替代來源，因此不再計分，也不假裝它是綠燈。
//   2. 這裡只做「市場面」運算（過熱、情境、成交上限級距）。逐標的買賣建議需要持倉，
//      改由前端 js/views/observatory.js 以 investments-next 自己的持倉真相計算，
//      避免後端再重建一份股數與成本。

const OVERHEAT_THRESHOLDS = {
  vixComplacency: 14,
  soxMa5DevHot: 6.0,
  indexRsiHot: 72
};

const SCENARIO_CENTERS = {
  big_up: 1.8,
  small_up: 0.7,
  flat: 0.0,
  small_down: -0.7,
  big_down: -1.8
};

const SCENARIO_LABELS = {
  big_up: '高開續攻（多頭延續）',
  small_up: '緩步墊高（偏多震盪上行）',
  flat: '區間拉鋸（震盪走平）',
  small_down: '開高走低（轉弱回檔）',
  big_down: '開低續弱（空方延續）'
};

const SCENARIO_STRATEGY = {
  big_up: '偏向高開後續攻：早盤若衝高且量價健康，可沿趨勢續抱；若急拉過快，分批賣紅鎖利，不追價。',
  small_up: '偏向溫和走高：指數維持多頭墊高，核心續抱；衛星維持奈米打卡，避免追高擴張部位。',
  flat: '偏向區間震盪：高低來回但方向未定，延續原預約單與紀律，不因盤中雜訊頻繁改單。',
  small_down: '偏向開高走低或緩步回檔：若跌勢延續，核心可分段掛淺價；衛星維持小量，不做重壓攤平。',
  big_down: '偏向開低續弱或空方擴大：若恐慌延續，核心/2330 依現金與全成交上限分批承接；衛星與偵查層不加碼。'
};

const SCENARIO_ORDER = ['big_up', 'small_up', 'flat', 'small_down', 'big_down'];
const SCENARIO_WEIGHT = { big_up: 1.0, small_up: 0.5, flat: 0.0, small_down: -0.5, big_down: -1.0 };

const DAILY_MAX_FILL = {
  normal: [20000, 30000],
  minor_correction: [30000, 50000],
  clear_correction: [50000, 80000],
  big_drop: [80000, 100000]
};

const SATELLITE_STOP_LOSS_PCT = -10;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits) {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 市場過熱評估。分數越高越熱。
 * @param {object} inputs
 * @param {number|null} inputs.vix
 * @param {number|null} inputs.soxMa5DevPct 費半相對 5MA 的乖離百分比
 * @param {number|null} inputs.soxChangePct
 * @param {number|null} inputs.nvdaChangePct
 * @param {number|null} inputs.cfoRed CFO 風險警訊紅燈數
 * @param {number|null} inputs.cfoAmber CFO 風險警訊黃燈數
 */
function assessOverheat(inputs = {}, thresholds = OVERHEAT_THRESHOLDS) {
  const th = { ...OVERHEAT_THRESHOLDS, ...thresholds };
  const reasons = [];
  let score = 0;

  const vix = num(inputs.vix);
  if (vix != null && vix <= th.vixComplacency) {
    score += 2;
    reasons.push(`VIX ${vix} 偏低（≤${th.vixComplacency}），市場過度樂觀`);
  }

  const soxDev = num(inputs.soxMa5DevPct);
  if (soxDev != null && soxDev >= th.soxMa5DevHot) {
    score += 2;
    reasons.push(`費半正乖離 ${soxDev}%（≥${th.soxMa5DevHot}%），短線過熱`);
  }

  const soxChg = num(inputs.soxChangePct) ?? 0;
  const nvdaChg = num(inputs.nvdaChangePct) ?? 0;
  if (soxChg >= 3 || nvdaChg >= 4) {
    score += 1;
    reasons.push('費半/輝達單日大漲，追高風險升高');
  }

  const red = num(inputs.cfoRed);
  const amber = num(inputs.cfoAmber);
  if (red) {
    score += 2 * red;
    reasons.push(`CFO 風險警訊：紅燈 ${red} 項`);
  }
  if (amber) {
    score += amber;
    reasons.push(`CFO 風險警訊：黃燈 ${amber} 項`);
  }

  let level;
  let verdict;
  if (score >= 5) {
    level = 'red';
    verdict = '市場明顯過熱：賣紅、降積極度、暫停追高';
  } else if (score >= 2) {
    level = 'amber';
    verdict = '局部過熱：謹慎，核心仍可逢低，衛星維持奈米打卡';
  } else {
    level = 'green';
    verdict = '未見過熱：依紀律執行，買黑賣紅照常';
  }

  if (!reasons.length) reasons.push('各項過熱指標均在正常範圍');

  return {
    level,
    score,
    verdict,
    reasons,
    inputs: { vix, sox_ma5_dev_pct: soxDev, cfo_red: red, cfo_amber: amber }
  };
}

/**
 * 由美股關鍵數字推估隔日台股 gap，映射五情境與機率。
 * 權重與 Python 版相同：TSM ADR 0.4、費半 0.35、NVDA 0.15、S&P 0.10。
 */
function predictTwScenarios(inputs = {}) {
  const parts = [
    [num(inputs.tsmChangePct), 0.4],
    [num(inputs.soxChangePct), 0.35],
    [num(inputs.nvdaChangePct), 0.15],
    [num(inputs.spxChangePct), 0.10]
  ].filter(([value]) => value != null);

  let gap = null;
  if (parts.length) {
    const weightSum = parts.reduce((sum, [, w]) => sum + w, 0);
    gap = round(parts.reduce((sum, [v, w]) => sum + v * w, 0) / weightSum, 2);
  }

  let probs;
  if (gap == null) {
    probs = { big_up: 10, small_up: 25, flat: 30, small_down: 25, big_down: 10 };
  } else {
    const raw = {};
    let total = 0;
    for (const key of SCENARIO_ORDER) {
      const value = Math.exp(-((gap - SCENARIO_CENTERS[key]) ** 2) / 1.6);
      raw[key] = value;
      total += value;
    }
    probs = {};
    for (const key of SCENARIO_ORDER) probs[key] = Math.round((raw[key] / total) * 100);
    // 修正四捨五入誤差，讓總和 = 100
    const diff = 100 - SCENARIO_ORDER.reduce((sum, key) => sum + probs[key], 0);
    const top = SCENARIO_ORDER.reduce((best, key) => (probs[key] > probs[best] ? key : best), SCENARIO_ORDER[0]);
    probs[top] += diff;
  }

  return {
    estimated_gap_pct: gap,
    inputs: {
      sox: num(inputs.soxChangePct),
      tsm_adr: num(inputs.tsmChangePct),
      nvda: num(inputs.nvdaChangePct),
      spx: num(inputs.spxChangePct)
    },
    scenarios: SCENARIO_ORDER.map((key) => ({
      key,
      scenario: SCENARIO_LABELS[key],
      probability: probs[key],
      strategy: SCENARIO_STRATEGY[key]
    }))
  };
}

/** 情境偏多/偏空綜合分數：-1（極空）~ +1（極多）。 */
function scenarioBias(prediction) {
  const scenarios = prediction?.scenarios || [];
  const total = scenarios.reduce((sum, item) => sum + (item.probability || 0), 0) || 1;
  const weighted = scenarios.reduce((sum, item) => sum + (SCENARIO_WEIGHT[item.key] || 0) * (item.probability || 0), 0);
  return round(weighted / total, 3);
}

/** 依預估 gap 決定當日全成交上限級距。 */
function fillWindow(prediction, dailyMaxFill = DAILY_MAX_FILL) {
  const gap = prediction?.estimated_gap_pct;
  if (gap != null && gap <= -1.8) return { label: 'big_drop', range: dailyMaxFill.big_drop };
  if (gap != null && gap <= -1.0) return { label: 'clear_correction', range: dailyMaxFill.clear_correction };
  if (gap != null && gap <= -0.4) return { label: 'minor_correction', range: dailyMaxFill.minor_correction };
  return { label: 'normal', range: dailyMaxFill.normal };
}

module.exports = {
  assessOverheat,
  predictTwScenarios,
  scenarioBias,
  fillWindow,
  OVERHEAT_THRESHOLDS,
  DAILY_MAX_FILL,
  SATELLITE_STOP_LOSS_PCT
};
