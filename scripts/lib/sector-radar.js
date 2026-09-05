'use strict';

// sector-radar 唯讀讀取層。
//
// 只讀 tools/sector-radar/data/computed/YYYY-MM-DD.json（compute.py 產出的結構化快照），
// 不讀 dashboard/data.js（那份外面包了 `window.RADAR_DATA = `，需要脆弱的字串硬切）。
// 永遠不寫 sector-radar 目錄。
//
// 持股真相邊界：sector-radar 會把 db.json 的交易紀錄重建成 position（股數/成本/損益/市值）並寫進快照。
// 那是一份會延遲的投影，不是真相。investments-next 自己就握有 db.json，因此本模組在回傳前
// 以白名單挑欄位，並在最後再跑一次遞迴清除，確保 position / held / shares / cost / pnl_pct / value
// 這些持股投影欄位不會離開後端。前端一律用股票代號 join 自己的持倉。

const fs = require('fs');
const path = require('path');

const SNAPSHOT_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

// 明確禁止外流的持股投影欄位（第二道防線；白名單本身已不會挑到這些）。
const FORBIDDEN_KEYS = new Set(['position', 'held', 'shares', 'cost', 'pnl_pct', 'value', 'avg_cost', 'market_value']);

const META_FIELDS = ['generated', 'generated_at', 'data_date', 'data_age_trading_days', 'source', 'gaps', 'notes'];

const MARKET_FIELDS = [
  'mode', 'taiex_close', 'taiex_ma20', 'taiex_above_ma20', 'taiex_ma20_slope',
  'breadth_above_ma20', 'pullback_allowed', 'taiex_ret20', 'foreign_breadth', 'tranches_pct'
];

const GROUP_FIELDS = [
  'id', 'name', 'count', 'rev_yoy_slope', 'rev_yoy', 'rs20', 'rs60', 'ret20', 'per_pctile',
  'chips_norm', 'pct_above_ma20', 'money20', 'eps_cum_yoy', 'gross_margin_qoq',
  'score_std', 'trap_count', 'score'
];

const STOCK_FIELDS = [
  'id', 'name', 'market', 'group_id', 'last_date', 'close',
  'ret5', 'ret20', 'above_ma5', 'above_ma20', 'above_ma60',
  'bias_ma5', 'bias_ma20', 'bias_ma60', 'ma5_above_ma20', 'ma20_slope5',
  'off_high20', 'off_high60', 'volume_ratio20', 'close_location', 'money20',
  'rs5', 'rs20', 'rev_series', 'rev_yoy', 'rev_mom', 'rev_ym', 'rev_yoy_slope', 'rev_yoy_declining',
  'eps_cum_yoy', 'gross_margin', 'gross_margin_qoq',
  'per', 'val_basis', 'per_pctile', 'foreign_net20', 'trust_net20', 'chips_norm',
  'data_gaps', 'data_notes', 'score', 'cyclical_trap', 'label', 'reason',
  'guerrilla_status', 'guerrilla_rank', 'guerrilla_reason'
];

const SHORTLIST_FIELDS = ['id', 'name', 'group_id', 'status', 'reason', 'score', 'close', 'rs5', 'volume_ratio20'];

function pick(source, fields) {
  if (!source || typeof source !== 'object') return {};
  const out = {};
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

/** 第二道防線：遞迴刪除任何殘留的持股投影欄位。 */
function scrubHoldingProjection(node) {
  if (Array.isArray(node)) {
    node.forEach(scrubHoldingProjection);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_KEYS.has(key)) {
        delete node[key];
        continue;
      }
      scrubHoldingProjection(node[key]);
    }
  }
  return node;
}

function projectSnapshot(raw, fileName) {
  const market = pick(raw.market, MARKET_FIELDS);
  const shortlist = raw.market?.guerrilla_shortlist || {};
  market.guerrilla_shortlist = {
    actionable: (shortlist.actionable || []).map((item) => pick(item, SHORTLIST_FIELDS)),
    ready: (shortlist.ready || []).map((item) => pick(item, SHORTLIST_FIELDS)),
    watch: (shortlist.watch || []).map((item) => pick(item, SHORTLIST_FIELDS))
  };

  const payload = {
    ok: true,
    meta: {
      ...pick(raw.meta, META_FIELDS),
      snapshot_file: fileName,
      // rotation（60 日輪動熱力圖/累計折線）刻意不隨 API 提供：那兩張圖用 Chart.js 畫，
      // 留在 sector-radar 原頁下鑽，避免 investments-next 引入第二套圖表函式庫。
      rotation_available: Boolean(raw.rotation),
      holdings_projection_stripped: true
    },
    market,
    groups: (raw.groups || []).map((group) => pick(group, GROUP_FIELDS)),
    stocks: (raw.stocks || []).map((stock) => pick(stock, STOCK_FIELDS))
  };

  return scrubHoldingProjection(payload);
}

/**
 * @param {object} deps
 * @param {string} deps.computedDir sector-radar 的 data/computed 絕對路徑
 * @param {(source: string, message: string, error?: unknown) => void} [deps.logError]
 */
function createSectorRadar({ computedDir, logError = () => {} }) {
  let cache = { fetchedAt: 0, mtimeMs: 0, file: '', payload: null };
  const TTL_MS = 5 * 60 * 1000;

  function listSnapshotFiles() {
    if (!fs.existsSync(computedDir)) return [];
    return fs.readdirSync(computedDir)
      .filter((name) => SNAPSHOT_FILE_RE.test(name))
      .sort()
      .reverse();
  }

  /**
   * 讀最新可解析的快照。compute.py 寫檔當下可能被讀到半截，
   * 因此逐檔往前退，parse 失敗就換前一天，不讓整頁掛掉。
   */
  function readLatestSnapshot() {
    for (const name of listSnapshotFiles()) {
      const filePath = path.join(computedDir, name);
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!raw?.meta) continue;
        return { raw, fileName: name, mtimeMs: fs.statSync(filePath).mtimeMs };
      } catch (error) {
        logError('sector-radar', `快照解析失敗，改用前一日：${name}`, error);
      }
    }
    return null;
  }

  function getSnapshot() {
    const now = Date.now();
    const files = listSnapshotFiles();
    const latestName = files[0] || '';
    let latestMtime = 0;
    if (latestName) {
      try { latestMtime = fs.statSync(path.join(computedDir, latestName)).mtimeMs; } catch { latestMtime = 0; }
    }
    const cacheFresh = cache.payload
      && now - cache.fetchedAt < TTL_MS
      && cache.file === latestName
      && cache.mtimeMs === latestMtime;
    if (cacheFresh) return { ...cache.payload, cached: true };

    const found = readLatestSnapshot();
    if (!found) {
      return {
        ok: false,
        error: 'sector-radar 尚無可用快照',
        detail: '找不到 data/computed/YYYY-MM-DD.json；請確認 com.harry.sector-radar 是否已執行過。',
        meta: null
      };
    }
    const payload = projectSnapshot(found.raw, found.fileName);
    cache = { fetchedAt: now, mtimeMs: found.mtimeMs, file: found.fileName, payload };
    return payload;
  }

  /** 給重點看盤「台股內部結構」閘門使用的極小切片。 */
  function getMarketInternalSlice() {
    const snapshot = getSnapshot();
    if (!snapshot.ok) return null;
    return {
      date: snapshot.meta?.data_date || '',
      generatedAt: snapshot.meta?.generated_at || '',
      marketMode: snapshot.market?.mode || '',
      breadthAboveMa20: snapshot.market?.breadth_above_ma20 ?? null,
      taiexClose: snapshot.market?.taiex_close ?? null,
      source: 'sector-radar'
    };
  }

  return { getSnapshot, getMarketInternalSlice, __test: { projectSnapshot, scrubHoldingProjection, FORBIDDEN_KEYS } };
}

module.exports = { createSectorRadar, FORBIDDEN_KEYS };
