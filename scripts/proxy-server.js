// proxy-server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// 資料儲存路徑
const DB_PATH = path.join(__dirname, '../data/db.json');
// 交易日誌自動匯入收件匣（Claude / Codex 寫入，前端開頁時 consume-on-read）
const TJ_INBOX_PATH = path.join(__dirname, '../data/trade-journal-inbox.json');

// 確保目錄存在
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const historyCache = new Map(); // key: `${symbol}_${days}` => { data, source, priceType, fetchedAt }
const inflightHistory = new Map(); // key => Promise
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1 hour
const HISTORY_SYMBOL_RE = /^(\^[A-Z]{2,6}|[0-9]{4,6}[A-Z]?)$/;
const TWSE_UA = 'Mozilla/5.0 (compatible; PortfolioTracker/1.0)';
const TWSE_MIS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const YAHOO_UA = 'Mozilla/5.0';
const QUOTE_BATCH_LIMIT = 8;
let twseMisCookie = '';
let twseMisCookieFetchedAt = 0;

// 啟用 CORS
app.use(cors());
app.use(express.json({ limit: '20mb' })); // 增加限制以容納較大的資料庫

// ── 資料存取 API ──────────────────────────────────────
function hasUsefulPortfolioData(data) {
  return !!data && typeof data === 'object' &&
    ['stocks', 'txns', 'accounts', 'watchlist'].some((key) => Array.isArray(data[key]) && data[key].length > 0);
}

function readStoredDB() {
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (error) {
    console.warn('[storage] 現有存檔讀取失敗，略過空資料防護:', error.message);
    return null;
  }
}

function mergeTradeJournalsForSave(incoming, existing) {
  if (!incoming || !existing || typeof incoming !== 'object' || typeof existing !== 'object') return incoming;
  const existingStore = ensureTradeJournalsMeta(existing);
  const incomingStore = ensureTradeJournalsMeta(incoming);
  const existingHasRows = Object.values(existingStore).some((rows) => Array.isArray(rows) && rows.length > 0);
  if (existingHasRows) {
    incoming.meta.tradeJournals = existingStore;
    return incoming;
  }
  incoming.meta.tradeJournals = incomingStore;
  return incoming;
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isBeforeTwseCloseSnapshotTime(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes() < 15 * 60 + 30;
}

function removePremarketTodayPerformanceRecords(data) {
  if (!data || typeof data !== 'object' || !isBeforeTwseCloseSnapshotTime()) return data;
  const today = localDateKey();
  if (Array.isArray(data.snapshots)) {
    data.snapshots = data.snapshots.filter((row) => row?.date !== today);
  }
  if (data.meta?.dailyArchive && typeof data.meta.dailyArchive === 'object') {
    delete data.meta.dailyArchive[today];
  }
  return data;
}

function preservePerformanceHistoryForSave(incoming, existing) {
  if (!incoming || !existing || typeof incoming !== 'object' || typeof existing !== 'object') return incoming;

  if (!Array.isArray(incoming.snapshots)) incoming.snapshots = [];
  const incomingDates = new Set(incoming.snapshots.map((row) => row?.date).filter(Boolean));
  for (const row of (Array.isArray(existing.snapshots) ? existing.snapshots : [])) {
    if (row?.date && !incomingDates.has(row.date)) incoming.snapshots.push(row);
  }
  incoming.snapshots.sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));

  if (!incoming.meta || typeof incoming.meta !== 'object') incoming.meta = {};
  if (!incoming.meta.dailyArchive || typeof incoming.meta.dailyArchive !== 'object') incoming.meta.dailyArchive = {};
  const existingArchive = existing.meta?.dailyArchive;
  if (existingArchive && typeof existingArchive === 'object') {
    for (const [date, entry] of Object.entries(existingArchive)) {
      if (!Object.prototype.hasOwnProperty.call(incoming.meta.dailyArchive, date)) {
        incoming.meta.dailyArchive[date] = entry;
      }
    }
  }
  return incoming;
}

// 儲存資料庫到硬碟
app.post('/api/save-db', (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: '無效的資料格式' });
    }
    if (!hasUsefulPortfolioData(data)) {
      console.warn('[storage] 已拒絕空 portfolio 存檔');
      return res.status(409).json({ error: '已拒絕空 portfolio 存檔' });
    }
    const existing = readStoredDB();
    if (!hasUsefulPortfolioData(data) && hasUsefulPortfolioData(existing)) {
      console.warn('[storage] 已拒絕空資料覆蓋完整存檔');
      return res.status(409).json({ error: '已拒絕空資料覆蓋完整存檔' });
    }

    mergeTradeJournalsForSave(data, existing);
    removePremarketTodayPerformanceRecords(data);
    if (req.get('X-Allow-Performance-Delete') !== '1') {
      preservePerformanceHistoryForSave(data, existing);
      removePremarketTodayPerformanceRecords(data);
    }

    // 加上時間戳記
    if (!data.meta) data.meta = {};
    const now = new Date().toISOString();
    data.meta._lastServerSave = now;
    data.meta._updatedAt = now;

    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[storage] 資料已儲存至: ${DB_PATH}`);
    res.json({ success: true, timestamp: data.meta._lastServerSave });
  } catch (error) {
    console.error('[storage] 儲存失敗:', error.message);
    res.status(500).json({ error: '伺服器儲存失敗', message: error.message });
  }
});

// 從硬碟讀取資料庫
app.get('/api/load-db', (req, res) => {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return res.status(404).json({ error: '找不到存檔檔案' });
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const data = JSON.parse(raw);
    console.log(`[storage] 已載入存檔資料`);
    res.json(data);
  } catch (error) {
    console.error('[storage] 載入失敗:', error.message);
    res.status(500).json({ error: '伺服器載入失敗', message: error.message });
  }
});

function ensureTradeJournalsMeta(data) {
  if (!data.meta || typeof data.meta !== 'object') data.meta = {};
  if (!data.meta.tradeJournals || typeof data.meta.tradeJournals !== 'object' || Array.isArray(data.meta.tradeJournals)) {
    data.meta.tradeJournals = {};
  }
  return data.meta.tradeJournals;
}

function tradeJournalId() {
  return `tj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTradeJournalStatusServer(status) {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'success' || key === 'done' || key === 'executed') return 'filled';
  if (key === 'failed' || key === 'missed' || key === 'unfilled') return 'expired';
  if (key === 'cancel' || key === 'canceled') return 'cancelled';
  return ['planned', 'filled', 'cancelled', 'expired'].includes(key) ? key : 'planned';
}

function normalizeTradeJournalSideServer(side) {
  const key = String(side || '').trim().toLowerCase();
  return key === 'sell' || key === '賣出' ? 'sell' : 'buy';
}

function normalizeTradeJournalSourceServer(source) {
  const key = String(source || '').trim().toLowerCase();
  if (key === 'claude_code' || key === 'claude-code') return 'claude';
  return ['manual', 'codex', 'claude'].includes(key) ? key : 'codex';
}

function positiveNumberServer(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function positiveIntegerServer(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeTradeJournalOrderServer(raw = {}, defaults = {}, data = {}) {
  const now = new Date().toISOString();
  const date = String(raw.date || defaults.date || now.slice(0, 10)).slice(0, 10);
  const symbol = String(raw.symbol || raw.stockSymbol || '').trim().toUpperCase();
  const stock = Array.isArray(data.stocks)
    ? data.stocks.find((s) => String(s.symbol || '').trim().toUpperCase() === symbol)
    : null;
  const score = raw.decisionScore != null && Number.isFinite(Number(raw.decisionScore))
    ? Math.max(-5, Math.min(5, Number.parseInt(raw.decisionScore, 10)))
    : null;

  return {
    id: raw.id || raw.clientId || tradeJournalId(),
    date,
    source: normalizeTradeJournalSourceServer(raw.source || defaults.source),
    side: normalizeTradeJournalSideServer(raw.side || raw.type || defaults.side),
    status: normalizeTradeJournalStatusServer(raw.status || defaults.status),
    symbol,
    name: String(raw.name || raw.stockName || stock?.name || '').trim(),
    plannedPrice: positiveNumberServer(raw.plannedPrice ?? raw.planPrice ?? raw.limitPrice ?? raw.price),
    plannedQty: positiveIntegerServer(raw.plannedQty ?? raw.planQty ?? raw.qty ?? raw.quantity),
    actualPrice: positiveNumberServer(raw.actualPrice ?? raw.filledPrice ?? raw.executionPrice),
    actualQty: positiveIntegerServer(raw.actualQty ?? raw.filledQty ?? raw.executionQty),
    filledTime: raw.filledTime || raw.actualTime || raw.executionTime || '',
    condition: String(raw.condition || raw.trigger || '').trim(),
    strategyNote: String(raw.strategyNote || raw.reason || defaults.strategyNote || '').trim().slice(0, 800),
    sourceText: String(raw.sourceText || defaults.sourceText || '').trim().slice(0, 3000),
    resultNote: String(raw.resultNote || raw.note || '').trim().slice(0, 500),
    account: String(raw.account || defaults.account || 'ctbc').trim(),
    decisionScore: score,
    linkedTxnId: raw.linkedTxnId || null,
    linkedAt: raw.linkedAt || null,
    createdAt: raw.createdAt || now,
    updatedAt: now
  };
}

function upsertTradeJournalOrderServer(data, order) {
  const store = ensureTradeJournalsMeta(data);
  if (!Array.isArray(store[order.date])) store[order.date] = [];
  const rows = store[order.date];
  const idx = rows.findIndex((item) => item.id === order.id);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...order, updatedAt: new Date().toISOString() };
  else rows.push(order);
  rows.sort((a, b) => String(b.filledTime || b.createdAt || '').localeCompare(String(a.filledTime || a.createdAt || '')));
  return idx >= 0 ? rows[idx] : order;
}

function findTradeJournalOrderServer(data, id) {
  const store = ensureTradeJournalsMeta(data);
  for (const [date, rows] of Object.entries(store)) {
    if (!Array.isArray(rows)) continue;
    const idx = rows.findIndex((item) => item && item.id === id);
    if (idx >= 0) return { store, date, rows, idx, order: rows[idx] };
  }
  return null;
}

function syncTradeJournalOrderToTxnServer(data, order) {
  if (!order || order.status !== 'filled' || order.linkedTxnId) return { ok: false, skipped: true };
  const stock = Array.isArray(data.stocks)
    ? data.stocks.find((s) => String(s.symbol || '').trim().toUpperCase() === String(order.symbol || '').trim().toUpperCase())
    : null;
  if (!stock) return { ok: false, reason: `missing stock ${order.symbol}` };
  const price = positiveNumberServer(order.actualPrice) || positiveNumberServer(order.plannedPrice);
  const qty = positiveIntegerServer(order.actualQty) || positiveIntegerServer(order.plannedQty);
  if (!price || !qty) return { ok: false, reason: 'missing actual price or qty' };
  if (!Array.isArray(data.txns)) data.txns = [];
  const time = new Date(order.filledTime || `${order.date}T09:00`).toISOString();
  const txn = {
    id: `txn_${tradeJournalId()}`,
    stockId: stock.id,
    account: order.account || 'ctbc',
    type: order.side === 'sell' ? 'sell' : 'buy',
    price,
    qty,
    amount: Math.round(price * qty),
    time,
    note: ['交易日誌同步', order.resultNote ? `結果：${order.resultNote}` : '', order.source ? `來源：${order.source}` : ''].filter(Boolean).join('｜'),
    decisionScore: order.decisionScore,
    journalNote: String(order.strategyNote || order.sourceText || '').slice(0, 200)
  };
  data.txns.push(txn);
  order.linkedTxnId = txn.id;
  order.linkedAt = new Date().toISOString();
  order.updatedAt = order.linkedAt;
  return { ok: true, txnId: txn.id };
}

app.get('/api/trade-journals', (req, res) => {
  try {
    const data = readStoredDB();
    if (!hasUsefulPortfolioData(data)) return res.status(404).json({ error: '找不到可用投資資料' });
    const store = ensureTradeJournalsMeta(data);
    const date = req.query.date ? String(req.query.date).slice(0, 10) : null;
    res.json(date ? { date, orders: Array.isArray(store[date]) ? store[date] : [] } : { tradeJournals: store });
  } catch (error) {
    res.status(500).json({ error: '讀取交易日誌失敗', message: error.message });
  }
});

app.post('/api/trade-journals/import', (req, res) => {
  try {
    const data = readStoredDB();
    if (!hasUsefulPortfolioData(data)) return res.status(404).json({ error: '找不到可用投資資料，無法匯入預約單' });
    const payload = req.body || {};
    const list = Array.isArray(payload) ? payload : (payload.orders || payload.entries || payload.tradeOrders || []);
    if (!Array.isArray(list) || list.length === 0) {
      return res.status(400).json({ error: '請提供 orders / entries 陣列，或直接傳入陣列' });
    }
    const defaults = {
      date: payload.date,
      source: payload.source || 'codex',
      sourceText: payload.sourceText || '',
      strategyNote: payload.strategyNote || '',
      account: payload.account || 'ctbc'
    };
    const imported = [];
    const skipped = [];
    const syncResults = [];
    for (const raw of list) {
      const order = normalizeTradeJournalOrderServer(raw, defaults, data);
      if (!order.symbol) {
        skipped.push({ reason: 'missing symbol' });
        continue;
      }
      const stored = upsertTradeJournalOrderServer(data, order);
      imported.push(stored);
      if (stored.status === 'filled' && !stored.linkedTxnId) {
        syncResults.push({ id: stored.id, ...syncTradeJournalOrderToTxnServer(data, stored) });
      }
    }
    if (!data.meta) data.meta = {};
    const now = new Date().toISOString();
    data.meta._lastServerSave = now;
    data.meta._updatedAt = now;
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    res.json({
      success: true,
      imported: imported.length,
      skipped: skipped.length,
      syncResults,
      timestamp: data.meta._lastServerSave
    });
  } catch (error) {
    console.error('[trade-journals] 匯入失敗:', error.message);
    res.status(500).json({ error: '匯入交易日誌失敗', message: error.message });
  }
});

app.patch('/api/trade-journals/:id', (req, res) => {
  try {
    const data = readStoredDB();
    if (!hasUsefulPortfolioData(data)) return res.status(404).json({ error: '找不到可用投資資料，無法更新交易日誌' });
    const id = String(req.params.id || '').trim();
    const found = findTradeJournalOrderServer(data, id);
    if (!found) return res.status(404).json({ error: `找不到交易日誌 ${id}` });
    const merged = { ...found.order, ...(req.body || {}), id };
    const order = normalizeTradeJournalOrderServer(merged, { date: found.date, source: found.order.source || 'manual' }, data);
    const stored = upsertTradeJournalOrderServer(data, order);
    const syncResults = [];
    if (stored.status === 'filled' && !stored.linkedTxnId) {
      syncResults.push({ id: stored.id, ...syncTradeJournalOrderToTxnServer(data, stored) });
    }
    if (!data.meta) data.meta = {};
    const now = new Date().toISOString();
    data.meta._lastServerSave = now;
    data.meta._updatedAt = now;
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    res.json({ success: true, order: stored, syncResults, timestamp: now });
  } catch (error) {
    console.error('[trade-journals] 更新失敗:', error.message);
    res.status(500).json({ error: '更新交易日誌失敗', message: error.message });
  }
});

app.delete('/api/trade-journals/:id', (req, res) => {
  try {
    const data = readStoredDB();
    if (!hasUsefulPortfolioData(data)) return res.status(404).json({ error: '找不到可用投資資料，無法刪除交易日誌' });
    const id = String(req.params.id || '').trim();
    const found = findTradeJournalOrderServer(data, id);
    if (!found) return res.status(404).json({ error: `找不到交易日誌 ${id}` });
    const [deleted] = found.rows.splice(found.idx, 1);
    if (found.rows.length === 0) delete found.store[found.date];
    if (!data.meta) data.meta = {};
    const now = new Date().toISOString();
    data.meta._lastServerSave = now;
    data.meta._updatedAt = now;
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    res.json({ success: true, deleted, timestamp: now });
  } catch (error) {
    console.error('[trade-journals] 刪除失敗:', error.message);
    res.status(500).json({ error: '刪除交易日誌失敗', message: error.message });
  }
});

// 交易日誌自動匯入收件匣：回傳內容後立即歸檔（consume-on-read），
// 避免重複匯入、也不讓已刪除的單復活。Claude / Codex 直接寫 TJ_INBOX_PATH。
app.get('/api/trade-journal-inbox', (req, res) => {
  try {
    if (!fs.existsSync(TJ_INBOX_PATH)) return res.json({ orders: [] });
    const raw = fs.readFileSync(TJ_INBOX_PATH, 'utf8');
    if (!raw.trim()) return res.json({ orders: [] });
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ error: 'inbox JSON 解析失敗', message: e.message });
    }
    const orders = Array.isArray(payload) ? payload : (payload.orders || payload.entries || payload.tradeOrders || []);
    // 歸檔（rename，不刪除，保留追溯）
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(TJ_INBOX_PATH, path.join(path.dirname(TJ_INBOX_PATH), `trade-journal-inbox.processed-${stamp}.json`));
    } catch (e) {
      console.warn('[trade-journal-inbox] 歸檔失敗:', e.message);
    }
    res.json({
      orders: Array.isArray(orders) ? orders : [],
      source: (payload && !Array.isArray(payload) && payload.source) || 'claude',
      date: (payload && !Array.isArray(payload) && payload.date) || null
    });
  } catch (error) {
    res.status(500).json({ error: '讀取收件匣失敗', message: error.message });
  }
});

// 代理 WantGoo 股息資訊
app.get('/api/wantgoo/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // 判斷股票類型並使用正確的 URL 格式
    let url;
    if (symbol.endsWith('B')) {
      // 債券
      url = `https://www.wantgoo.com/stock/bond/${symbol}/dividend-policy/ex-dividend`;
    } else if (symbol.startsWith('00') && symbol.length === 4) {
      // ETF (0050, 00878, 00923, 00646)
      url = `https://www.wantgoo.com/stock/etf/${symbol}/dividend-policy/ex-dividend`;
    } else {
      // 一般股票 (8215)
      url = `https://www.wantgoo.com/stock/stock/${symbol}/dividend-policy/ex-dividend`;
    }
    
    console.log(`代理請求: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.wantgoo.com/'
      },
      timeout: 10000
    });
    
    console.log(`成功代理回應，狀態: ${response.status}, 長度: ${response.data.length}`);
    
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(response.data);
    
  } catch (error) {
    console.error('代理請求失敗:', error.message);
    res.status(500).json({
      error: '代理請求失敗',
      message: error.message,
      details: error.response?.status || '未知錯誤'
    });
  }
});

// ── ETF 折溢價：MoneyDJ 淨值表格 ─────────────────────
// 資料來源：https://www.moneydj.com/ETF/X/Basic/Basic0003.xdjhtm?etfid={symbol}.TW
// 回傳近 30 日淨值、市價、折溢價(%)
const navCache = new Map(); // key: symbol => { data, fetchedAt }
const NAV_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時快取

async function fetchNavFromMoneyDJ(sym) {
  // 檢查快取
  const cached = navCache.get(sym);
  if (cached && (Date.now() - cached.fetchedAt) < NAV_CACHE_TTL_MS) {
    logInfo('nav', `cache hit for ${sym}`);
    return cached.data;
  }

  const url = `https://www.moneydj.com/ETF/X/Basic/Basic0003.xdjhtm?etfid=${sym}.TW`;
  logInfo('nav', `fetching MoneyDJ: ${url}`);
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    },
    timeout: 12000
  });
  const html = response.data || '';

  // 解析 HTML 表格：<tr> 中包含日期(yyyy/mm/dd) + NAV + 市價 + 折溢價(%)
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
  const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
  const rows = [];
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const cells = [];
    let cm;
    while ((cm = cellRegex.exec(match[1])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 4 && /^\d{4}\/\d{2}\/\d{2}$/.test(cells[0])) {
      const nav = parseFloat(cells[1]);
      const marketPrice = parseFloat(cells[2]);
      const premiumPct = parseFloat(cells[3]);
      if (Number.isFinite(nav) && Number.isFinite(marketPrice)) {
        rows.push({
          date: cells[0].replace(/\//g, '-'),
          nav,
          marketPrice,
          premiumPct: Number.isFinite(premiumPct) ? premiumPct : null
        });
      }
    }
  }

  if (rows.length === 0) {
    logInfo('nav', `no data parsed for ${sym}`);
    return null;
  }

  const result = {
    symbol: sym,
    nav: rows[0].nav,
    marketPrice: rows[0].marketPrice,
    premiumPct: rows[0].premiumPct,
    date: rows[0].date,
    history: rows, // 近 30 日
    source: 'moneydj'
  };

  navCache.set(sym, { data: result, fetchedAt: Date.now() });
  logInfo('nav', `parsed ${rows.length} rows for ${sym}, latest: NAV=${rows[0].nav}, premium=${rows[0].premiumPct}%`);
  return result;
}

// 保留舊函式名稱作為相容（不再使用）
function parseNavOverviewHtml(html) {
  // 頁面表頭：代碼、名稱、淨值、市價、折溢價、成交量、追蹤標的、淨值漲跌%、市價漲跌%、折溢價%
  // 嘗試以文字行解析（玩股網可能用 div 而非 table）
  const results = new Map();

  // 策略 1: 正規 table 解析
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/gi);
  if (tableMatch) {
    for (const tableHtml of tableMatch) {
      if (!/(淨值|折溢價)/i.test(tableHtml)) continue;
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        const cells = [];
        const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
        }
        // 代碼通常是 4~6 位數字+可能的英文尾碼
        if (cells.length >= 6 && /^\d{4,6}[A-Z]?$/.test(cells[0])) {
          const code = cells[0].trim();
          const nav = parseFloat(cells[2]) || null;
          const marketPrice = parseFloat(cells[3]) || null;
          const premiumAmt = parseFloat(cells[4]);
          // 折溢價% 可能在 index 9 或最後幾欄
          let premiumPct = null;
          // 從後往前找百分比欄位
          for (let i = cells.length - 1; i >= 5; i--) {
            const val = parseFloat(cells[i]);
            if (Number.isFinite(val) && Math.abs(val) < 50) {
              premiumPct = val;
              break;
            }
          }
          // 如果找不到百分比但有 nav 和 marketPrice，自行計算
          if (premiumPct == null && nav > 0 && marketPrice > 0) {
            premiumPct = Number((((marketPrice - nav) / nav) * 100).toFixed(2));
          }
          if (nav != null || marketPrice != null) {
            results.set(code, { symbol: code, name: cells[1] || '', nav, marketPrice, premiumPct, source: 'wantgoo-overview' });
          }
        }
      }
      if (results.size > 0) break;
    }
  }

  // 策略 2: 文字行解析（如果不是 table 而是 div 列表）
  if (results.size === 0) {
    const lines = html.replace(/<[^>]+>/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (/^\d{4,6}[A-Z]?$/.test(lines[i])) {
        const code = lines[i];
        const name = (i + 1 < lines.length && !/^\d/.test(lines[i + 1])) ? lines[i + 1] : '';
        // 往後找數值
        const nums = [];
        for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
          const v = parseFloat(lines[j]);
          if (Number.isFinite(v)) nums.push(v);
          if (nums.length >= 5) break;
        }
        if (nums.length >= 3) {
          const nav = nums[0];
          const marketPrice = nums[1];
          const premiumAmt = nums[2];
          const premiumPct = nums.length >= 4 && Math.abs(nums[nums.length - 1]) < 50
            ? nums[nums.length - 1]
            : (nav > 0 ? Number((((marketPrice - nav) / nav) * 100).toFixed(2)) : null);
          results.set(code, { symbol: code, name, nav, marketPrice, premiumPct, source: 'wantgoo-overview' });
        }
      }
    }
  }

  return results;
}

async function getNavOverviewData() {
  if (navOverviewCache.data && (Date.now() - navOverviewCache.fetchedAt) < NAV_OVERVIEW_TTL_MS) {
    return navOverviewCache.data;
  }
  const url = 'https://www.wantgoo.com/stock/etf/net-value';
  logInfo('wantgoo-nav', `fetching overview: ${url}`);
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.wantgoo.com/'
    },
    timeout: 15000
  });
  const data = parseNavOverviewHtml(response.data || '');
  logInfo('wantgoo-nav', `overview parsed: ${data.size} ETFs`);
  if (data.size > 0) {
    navOverviewCache.data = data;
    navOverviewCache.fetchedAt = Date.now();
  }
  return data;
}

// 個股折溢價頁面解析（fallback）
async function fetchSingleNavFromWantgoo(sym) {
  let urlType = 'etf';
  if (sym.endsWith('B')) urlType = 'bond';
  const url = `https://www.wantgoo.com/stock/${urlType}/${sym}/discount-premium`;
  logInfo('wantgoo-nav', `fetching single: ${url}`);
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.wantgoo.com/'
    },
    timeout: 12000
  });
  const html = response.data || '';
  // 找包含日期 + 數值的表格列（表頭：日期、市價、淨值、折溢價、折溢價%、申購買回淨單位數）
  // 嘗試以文字行方式解析
  const lines = html.replace(/<[^>]+>/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  // 找日期格式行（yyyy/mm/dd）並取後面的數值
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(lines[i])) {
      const date = lines[i].replace(/\//g, '-');
      const nums = [];
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const v = parseFloat(lines[j]);
        if (Number.isFinite(v)) nums.push(v);
        if (nums.length >= 4) break;
      }
      // 表頭順序：日期、市價、淨值、折溢價、折溢價%
      if (nums.length >= 4) {
        return {
          symbol: sym,
          nav: nums[1],           // 淨值
          marketPrice: nums[0],   // 市價
          premiumPct: nums[3],    // 折溢價%
          date,
          source: 'wantgoo-single'
        };
      }
      if (nums.length >= 2) {
        const marketPrice = nums[0];
        const nav = nums[1];
        const premiumPct = nav > 0 ? Number((((marketPrice - nav) / nav) * 100).toFixed(2)) : null;
        return { symbol: sym, nav, marketPrice, premiumPct, date, source: 'wantgoo-single' };
      }
    }
  }
  return null;
}

app.get('/api/wantgoo-nav/:symbol', async (req, res) => {
  const sym = String(req.params.symbol || '').trim().toUpperCase();
  if (!sym) return res.status(400).json({ error: true, symbol: sym, message: 'missing symbol' });

  try {
    const result = await fetchNavFromMoneyDJ(sym);
    if (result) {
      logInfo('nav', `returning data for ${sym}: NAV=${result.nav}, premium=${result.premiumPct}%`);
      return res.json(result);
    }
    logInfo('nav', `no data found for ${sym}`);
    return res.json({ error: true, symbol: sym, message: '找不到折溢價資料' });
  } catch (error) {
    logError('nav', `failed for ${sym}`, error);
    return res.status(502).json({ error: true, symbol: sym, message: error.message || '代理請求失敗' });
  }
});

function logInfo(source, message) {
  console.log(`[${new Date().toISOString()}] [${source}] ${message}`);
}

function logError(source, message, error) {
  console.error(`[${new Date().toISOString()}] [${source}] ${message}`, error?.message || error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCloseValue(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function rocToWestern(rocDate) {
  const parts = String(rocDate || '').split('/');
  if (parts.length !== 3) return null;
  const year = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10);
  const day = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const westernYear = year + 1911;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${westernYear}-${mm}-${dd}`;
}

function getMonthStarts(monthCount) {
  const now = new Date();
  const out = [];
  for (let i = monthCount - 1; i >= 0; i -= 1) {
    out.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  }
  return out;
}

function toTwseMonthCode(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  return `${y}${m}01`;
}

function dedupeAndSortHistory(rows) {
  const byDate = new Map();
  for (const row of rows) byDate.set(row.date, row.close);
  return Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFromTwse(symbol, days) {
  const monthsToFetch = Math.ceil(days / 20) + 1;
  const monthStarts = getMonthStarts(monthsToFetch);
  const collected = [];

  for (let i = 0; i < monthStarts.length; i += 1) {
    if (i > 0) await sleep(600); // respect TWSE rate limit

    const monthCode = toTwseMonthCode(monthStarts[i]);
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${monthCode}&stockNo=${encodeURIComponent(symbol)}`;
    logInfo('twse', `requesting ${symbol} ${monthCode}`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': TWSE_UA,
        'Accept': 'application/json'
      },
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 500
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status} for ${monthCode}`);
    }

    const payload = response.data;
    if (!payload || typeof payload !== 'object') {
      throw new Error(`invalid response body for ${monthCode}`);
    }
    if (payload.stat !== 'OK' || !Array.isArray(payload.data) || payload.data.length === 0) {
      logInfo('twse', `no data for ${symbol} ${monthCode}, stat=${payload.stat || 'unknown'}`);
      continue;
    }

    for (const row of payload.data) {
      if (!Array.isArray(row) || row.length < 7) continue;
      const date = rocToWestern(row[0]);
      const close = parseCloseValue(row[6]);
      if (!date || close === null) continue;
      collected.push({ date, close });
    }
  }

  if (collected.length === 0) return null;
  const normalized = dedupeAndSortHistory(collected);
  return normalized.slice(-days);
}

function toTpexMonthCode(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  return `${y}/${m}/01`;
}

async function fetchFromTpex(symbol, days) {
  const monthsToFetch = Math.ceil(days / 20) + 1;
  const monthStarts = getMonthStarts(monthsToFetch);
  const collected = [];

  for (let i = 0; i < monthStarts.length; i += 1) {
    if (i > 0) await sleep(600); // keep request pace conservative

    const monthCode = toTpexMonthCode(monthStarts[i]);
    logInfo('tpex', `requesting ${symbol} ${monthCode}`);
    const response = await axios.post(
      'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock',
      new URLSearchParams({
        code: symbol,
        date: monthCode,
        response: 'json'
      }).toString(),
      {
        headers: {
          'User-Agent': TWSE_UA,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json'
        },
        timeout: 15000,
        validateStatus: (status) => status >= 200 && status < 500
      }
    );

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status} for ${monthCode}`);
    }

    const payload = response.data;
    if (!payload || typeof payload !== 'object') {
      throw new Error(`invalid response body for ${monthCode}`);
    }
    if (payload.stat !== 'ok') {
      logInfo('tpex', `no data for ${symbol} ${monthCode}, stat=${payload.stat || 'unknown'}`);
      continue;
    }

    const rows = payload?.tables?.[0]?.data;
    if (!Array.isArray(rows) || rows.length === 0) {
      logInfo('tpex', `empty rows for ${symbol} ${monthCode}`);
      continue;
    }

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 7) continue;
      const date = rocToWestern(row[0]);
      const close = parseCloseValue(row[6]);
      if (!date || close === null) continue;
      collected.push({ date, close });
    }
  }

  if (collected.length === 0) return null;
  const normalized = dedupeAndSortHistory(collected);
  return normalized.slice(-days);
}

function parseYahooHistoryCsv(csvText) {
  const text = String(csvText || '').trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  if (lines.length <= 1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 6) continue;
    const date = cols[0].trim();
    const adjClose = parseCloseValue(cols[5]);
    const rawClose = parseCloseValue(cols[4]);
    const close = adjClose !== null ? adjClose : rawClose;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null) continue;
    rows.push({ date, close });
  }

  return dedupeAndSortHistory(rows);
}

function formatTaipeiDateFromUnix(unixSec) {
  const dt = new Date(unixSec * 1000);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

function parseYahooChartHistory(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  const adjCloses = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];

  const rows = [];
  const n = Math.min(timestamps.length, closes.length);
  for (let i = 0; i < n; i += 1) {
    const ts = Number(timestamps[i]);
    const adjClose = Number(adjCloses?.[i]);
    const rawClose = Number(closes[i]);
    const close = Number.isFinite(adjClose) ? adjClose : rawClose;
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    const date = formatTaipeiDateFromUnix(ts);
    if (!date) continue;
    rows.push({ date, close });
  }
  return dedupeAndSortHistory(rows);
}

async function fetchFromYahoo(symbol, days) {
  const nowSec = Math.floor(Date.now() / 1000);
  const period1 = nowSec - Math.floor(days * 1.5 * 24 * 60 * 60);
  const period2 = nowSec;
  const candidates = buildCandidates(symbol);
  logInfo('yahoo', `history candidates for ${symbol}: ${candidates.join(', ')}`);

  for (const ticker of candidates) {
    const url = `https://query1.finance.yahoo.com/v7/finance/download/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
    logInfo('yahoo', `requesting ${ticker}`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': YAHOO_UA,
        'Accept': 'text/csv,*/*'
      },
      timeout: 15000,
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 500
    });

    if (response.status === 200) {
      const parsed = parseYahooHistoryCsv(response.data);
      if (parsed.length > 0) {
        return parsed.slice(-days);
      }
      logInfo('yahoo', `${ticker} download CSV empty, trying chart endpoint`);
    } else {
      logInfo('yahoo', `${ticker} download returned HTTP ${response.status}, trying chart endpoint`);
    }

    // Download CSV may be unavailable or blocked for some symbols; fallback to chart API.
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
    const chartResponse = await axios.get(chartUrl, {
      headers: {
        'User-Agent': YAHOO_UA,
        'Accept': 'application/json'
      },
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 500
    });

    if (chartResponse.status !== 200) {
      logInfo('yahoo', `${ticker} chart endpoint returned HTTP ${chartResponse.status}`);
      continue;
    }

    const parsedFromChart = parseYahooChartHistory(chartResponse.data);
    if (parsedFromChart.length > 0) {
      return parsedFromChart.slice(-days);
    }
    logInfo('yahoo', `${ticker} chart returned no usable history rows`);
  }

  return null;
}

async function fetchHistory(symbol, days) {
  const enough = (arr) => Array.isArray(arr) && arr.length >= Math.min(days * 0.5, 50);

  // PRIMARY: TWSE/TPEx official raw prices
  try {
    const twseData = await fetchFromTwse(symbol, days);
    if (enough(twseData)) {
      return { source: 'twse', priceType: 'raw', data: twseData };
    }

    // Extend official coverage for OTC symbols (e.g. bond ETFs) via TPEx endpoint.
    const tpexData = await fetchFromTpex(symbol, days);
    if (enough(tpexData)) {
      return { source: 'tpex', priceType: 'raw', data: tpexData };
    }

    const merged = dedupeAndSortHistory([...(twseData || []), ...(tpexData || [])]).slice(-days);
    if (merged.length > 0) {
      return { source: tpexData?.length ? 'twse-tpex' : 'twse', priceType: 'raw', data: merged };
    }
    logInfo('history', `TWSE/TPEx returned no usable rows for ${symbol}, trying Yahoo`);
  } catch (e) {
    logError('twse', `failed for ${symbol}`, e);
  }

  // FALLBACK: Yahoo Finance adjusted prices
  try {
    const yahooData = await fetchFromYahoo(symbol, days);
    if (enough(yahooData)) {
      return { source: 'yahoo', priceType: 'adjusted', data: yahooData };
    }
    logInfo('history', `Yahoo returned insufficient data for ${symbol}`);
  } catch (e) {
    logError('yahoo', `failed for ${symbol}`, e);
  }

  return null;
}

app.get('/api/history', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const daysRaw = req.query.days;
  const force = ['1', 'true', 'yes'].includes(String(req.query.force || '').trim().toLowerCase());

  if (!symbol) return res.status(400).json({ error: 'missing symbol' });
  if (!HISTORY_SYMBOL_RE.test(symbol)) {
    return res.status(400).json({ error: 'invalid symbol format', symbol });
  }

  let days = 260;
  if (daysRaw !== undefined) {
    const parsedDays = Number.parseInt(String(daysRaw), 10);
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
      return res.status(400).json({ error: 'invalid days parameter' });
    }
    days = Math.min(parsedDays, 500);
  }

  const key = `${symbol}_${days}`;
  const cached = historyCache.get(key);
  if (force && cached) {
    historyCache.delete(key);
  }
  if (!force && cached && (Date.now() - cached.fetchedAt) < HISTORY_TTL_MS) {
    logInfo('history', `cache hit ${key}`);
    return res.json({
      symbol,
      source: cached.source,
      priceType: cached.priceType || 'raw',
      days: Array.isArray(cached.data) ? cached.data.length : 0,
      data: cached.data
    });
  }
  if (cached) historyCache.delete(key);

  try {
    let pending = inflightHistory.get(key);
    if (!pending) {
      logInfo('history', `cache miss ${key}, fetching`);
      pending = (async () => {
        const fetched = await fetchHistory(symbol, days);
        if (!fetched || !Array.isArray(fetched.data) || fetched.data.length === 0) return null;
        const entry = {
          data: fetched.data,
          source: fetched.source,
          priceType: fetched.priceType || 'raw',
          fetchedAt: Date.now()
        };
        historyCache.set(key, entry);
        return entry;
      })().finally(() => {
        inflightHistory.delete(key);
      });
      inflightHistory.set(key, pending);
    } else {
      logInfo('history', `inflight join ${key}`);
    }

    const result = await pending;
    if (!result) return res.status(502).json({ error: 'all sources failed', symbol });
    return res.json({
      symbol,
      source: result.source,
      priceType: result.priceType || 'raw',
      days: result.data.length,
      data: result.data
    });
  } catch (error) {
    logError('history', `endpoint failed for ${symbol}`, error);
    return res.status(502).json({ error: 'all sources failed', symbol });
  }
});

// ===== Yahoo helpers with robust fallbacks =====
function buildCandidates(input) {
  const orig = String(input).trim().toUpperCase();
  const out = new Set();
  const add = (s) => { if (s) out.add(s); };

  const hasSuffix = orig.endsWith('.TW') || orig.endsWith('.TWO');
  const base = hasSuffix ? orig.replace(/\.(TW|TWO)$/,'') : orig;
  const isBondETF = /B$/.test(base);
  const isTWCodeLike = /^[0-9]{3,6}[A-Z]?$/.test(base);

  if (hasSuffix) {
    add(orig);
    add(base + (orig.endsWith('.TW') ? '.TWO' : '.TW'));
    add(base); // in case Yahoo accepts bare code
  } else if (isBondETF) {
    add(base);
    add(base + '.TW');
    add(base + '.TWO');
  } else if (isTWCodeLike) {
    // TW listing priority: TW first, then TWO, then bare code.
    add(base + '.TW');
    add(base + '.TWO');
    add(base);
  } else {
    add(orig);
  }

  return Array.from(out);
}

function parseV8Price(j) {
  try {
    const m = j?.chart?.result?.[0]?.meta;
    const p = m?.regularMarketPrice ?? m?.previousClose ?? null;
    return Number.isFinite(p) ? Number(p) : null;
  } catch { return null; }
}

function parseV7Price(j) {
  try {
    const r = j?.quoteResponse?.result?.[0];
    const p = r?.regularMarketPrice ?? r?.regularMarketPreviousClose ?? null;
    return Number.isFinite(p) ? Number(p) : null;
  } catch { return null; }
}

function getTaipeiNow(date = new Date()) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

function getTaipeiDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return (y && m && d) ? `${y}-${m}-${d}` : null;
}

function parseIsoDateParts(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function diffCalendarDays(dateStrA, dateStrB) {
  const a = parseIsoDateParts(dateStrA);
  const b = parseIsoDateParts(dateStrB);
  if (!a || !b) return Number.NaN;
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / 86400000);
}

function isTaiwanQuoteSymbol(input) {
  const orig = String(input || '').trim().toUpperCase();
  const base = orig.replace(/\.(TW|TWO)$/, '');
  return /^[0-9]{3,6}[A-Z]?$/.test(base);
}

function parseTwNumeric(value) {
  if (value == null) return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text || text === '-') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function parseTwDataDate(rawDate) {
  const digits = String(rawDate || '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function fallbackTwTradeDate(now = new Date()) {
  const twNow = getTaipeiNow(now);
  const candidate = new Date(twNow.getFullYear(), twNow.getMonth(), twNow.getDate());
  const mins = twNow.getHours() * 60 + twNow.getMinutes();
  if (mins < 9 * 60) {
    candidate.setDate(candidate.getDate() - 1);
  }
  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() - 1);
  }
  return [
    candidate.getFullYear(),
    String(candidate.getMonth() + 1).padStart(2, '0'),
    String(candidate.getDate()).padStart(2, '0')
  ].join('-');
}

function getTwDataDate(msg) {
  const explicitDate = parseTwDataDate(msg?.d);
  if (explicitDate) return explicitDate;

  const twNow = getTaipeiNow();
  const mins = twNow.getHours() * 60 + twNow.getMinutes();
  const isWeekday = twNow.getDay() >= 1 && twNow.getDay() <= 5;
  if (isWeekday && mins >= 9 * 60 && mins <= 13 * 60 + 30) {
    return getTaipeiDateString();
  }
  return fallbackTwTradeDate();
}

function isTwPreopen(now = new Date()) {
  const twNow = getTaipeiNow(now);
  const mins = twNow.getHours() * 60 + twNow.getMinutes();
  return twNow.getDay() >= 1 && twNow.getDay() <= 5 && mins >= 8 * 60 + 30 && mins < 9 * 60;
}

function detectTwMarketPhase(now, price, isPreopen) {
  const twNow = getTaipeiNow(now);
  if (isPreopen) return 'preopen';
  const mins = twNow.getHours() * 60 + twNow.getMinutes();
  if (twNow.getDay() >= 1 && twNow.getDay() <= 5 && mins >= 9 * 60 && mins <= 13 * 60 + 30 && price != null) {
    return 'regular';
  }
  return 'closed';
}

function splitOrderbookLevels(raw) {
  if (!raw || raw === '-') return [];
  return String(raw)
    .split('_')
    .map((part) => part.trim())
    .filter((part) => part && part !== '-');
}

function parseOrderbookLevels(pricesRaw, volumesRaw) {
  const prices = splitOrderbookLevels(pricesRaw);
  const volumes = splitOrderbookLevels(volumesRaw);
  return prices.slice(0, 5).map((price, idx) => ({
    level: idx + 1,
    price,
    volume: volumes[idx] || null
  }));
}

function normalizeTwTradeTime(rawTime) {
  const text = String(rawTime || '').trim();
  if (!text || text === '-') return null;
  if (/^\d{6}$/.test(text)) {
    return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}`;
  }
  if (/^\d{4}$/.test(text)) {
    return `${text.slice(0, 2)}:${text.slice(2, 4)}:00`;
  }
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  if (/^\d{2}:\d{2}$/.test(text)) return `${text}:00`;
  return null;
}

function buildTaipeiUnixSeconds(dateStr, timeStr, marketPhase) {
  if (!dateStr) return null;
  const fallbackTime = marketPhase === 'preopen' ? '08:59:00' : '13:30:00';
  const resolvedTime = normalizeTwTradeTime(timeStr) || fallbackTime;
  const ms = Date.parse(`${dateStr}T${resolvedTime}+08:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function parseTwseMisMessage(msg, requestedCode) {
  const chMatch = String(msg?.ch || '').match(/(?:tse|otc)_([^.]+)\.tw/i);
  const code = String(msg?.c || chMatch?.[1] || requestedCode || '').trim().toUpperCase();
  if (!code) return null;

  const now = new Date();
  const latestTrade = msg?.z;
  const trialPrice = msg?.pz;
  const prevCloseRaw = msg?.y;
  const openRaw = msg?.o;
  const highRaw = msg?.h;
  const lowRaw = msg?.l;
  const totalVolumeRaw = msg?.v;
  const tradeTime = normalizeTwTradeTime(msg?.t);
  const askLevels = parseOrderbookLevels(msg?.a, msg?.f);
  const bidLevels = parseOrderbookLevels(msg?.b, msg?.g);
  const ask1 = askLevels[0]?.price ?? null;
  const preopen = isTwPreopen(now) && parseTwNumeric(trialPrice) != null;

  const priceCandidates = preopen ? [trialPrice, latestTrade, ask1, openRaw] : [latestTrade, ask1, openRaw];
  let priceRaw = null;
  for (const candidate of priceCandidates) {
    if (parseTwNumeric(candidate) != null) {
      priceRaw = candidate;
      break;
    }
  }

  const price = parseTwNumeric(priceRaw);
  const prevClose = parseTwNumeric(prevCloseRaw);
  const openPrice = parseTwNumeric(openRaw);
  const highPrice = parseTwNumeric(highRaw);
  const lowPrice = parseTwNumeric(lowRaw);
  const dataDate = getTwDataDate(msg);
  const marketPhase = detectTwMarketPhase(now, price, preopen);
  const resolvedPrice = price ?? prevClose;

  let priceSource = 'unknown';
  if (preopen && parseTwNumeric(trialPrice) != null) priceSource = 'trial';
  else if (parseTwNumeric(latestTrade) != null) priceSource = 'trade';
  else if (parseTwNumeric(ask1) != null) priceSource = 'ask1';
  else if (openPrice != null) priceSource = 'open';
  else if (prevClose != null) priceSource = 'prev_close';

  const marketTime = buildTaipeiUnixSeconds(dataDate, tradeTime, marketPhase);

  return {
    symbol: code,
    name: msg?.n || '',
    date: dataDate,
    price: resolvedPrice,
    prevClose,
    openPrice,
    highPrice,
    lowPrice,
    totalVolume: parseTwNumeric(totalVolumeRaw),
    marketTime,
    tradeTime,
    marketPhase,
    priceSource,
    bidLevels,
    askLevels,
    source: 'twse-mis'
  };
}

function getTwseMisCandidateScore(quote) {
  if (!quote || quote.price == null) return -1;
  const sourceRank = {
    trial: 5,
    trade: 4,
    ask1: 3,
    open: 2,
    prev_close: 1,
    unknown: 0
  };
  const phaseRank = {
    regular: 3,
    preopen: 2,
    closed: 1
  };
  return (phaseRank[quote.marketPhase] || 0) * 10 + (sourceRank[quote.priceSource] || 0);
}

function normalizeSetCookieHeader(setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  return list
    .map((item) => String(item || '').split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function getTwseMisSessionCookie(force = false, options = {}) {
  const ttl = 30 * 60 * 1000;
  if (!force && twseMisCookie && (Date.now() - twseMisCookieFetchedAt) < ttl) {
    return twseMisCookie;
  }
  const timeout = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 12000;

  const response = await axios.get('https://mis.twse.com.tw/stock/index.jsp', {
    headers: {
      'User-Agent': TWSE_MIS_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Connection': 'close'
    },
    timeout,
    validateStatus: (status) => status >= 200 && status < 500
  });

  const cookie = normalizeSetCookieHeader(response.headers?.['set-cookie']);
  if (cookie) {
    twseMisCookie = cookie;
    twseMisCookieFetchedAt = Date.now();
  }
  return twseMisCookie;
}

async function requestTwseMisQuote(exCh, cookie, options = {}) {
  const timeout = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 12000;
  const params = new URLSearchParams({
    ex_ch: exCh,
    json: '1',
    delay: '0',
    _: String(Date.now())
  });
  const headers = {
    'User-Agent': TWSE_MIS_UA,
    'Accept': 'application/json,text/javascript,*/*;q=0.01',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    'Referer': 'https://mis.twse.com.tw/stock/index.jsp',
    'X-Requested-With': 'XMLHttpRequest',
    'Connection': 'close'
  };
  if (cookie) headers.Cookie = cookie;

  return axios.get(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?${params.toString()}`, {
    headers,
    timeout,
    validateStatus: (status) => status >= 200 && status < 500
  });
}

function buildTwseMisExChCandidates(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  const base = normalized.replace(/\.(TW|TWO)$/, '');
  const isTpexPreferred = normalized.endsWith('.TWO') || /B$/.test(base);
  const first = isTpexPreferred ? 'otc' : 'tse';
  const second = first === 'tse' ? 'otc' : 'tse';
  const singleFirst = `${first}_${base}.tw`;
  const singleSecond = `${second}_${base}.tw`;
  return [
    singleFirst,
    singleSecond,
    `${singleFirst}|${singleSecond}`
  ];
}

async function fetchTwseMisQuote(symbol, options = {}) {
  const base = String(symbol || '').trim().toUpperCase().replace(/\.(TW|TWO)$/, '');
  const maxCandidates = Number.isFinite(Number(options.maxCandidates)) ? Math.max(1, Number(options.maxCandidates)) : null;
  const exChCandidates = buildTwseMisExChCandidates(symbol).slice(0, maxCandidates || undefined);
  const attempts = Number.isFinite(Number(options.attempts)) ? Math.max(1, Number(options.attempts)) : 2;
  const requestOptions = { timeoutMs: options.timeoutMs };
  let cookie = '';
  try {
    cookie = await getTwseMisSessionCookie(false, requestOptions);
  } catch (e) {
    logError('twse-mis', 'session cookie fetch failed', e);
  }

  let lastError = null;
  for (const exCh of exChCandidates) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (attempt === 1) cookie = await getTwseMisSessionCookie(true, requestOptions);
        const response = await requestTwseMisQuote(exCh, cookie, requestOptions);
        if (response.status !== 200) {
          throw new Error(`TWSE MIS HTTP ${response.status} for ${exCh}`);
        }

        const msgArray = response.data?.msgArray;
        if (!Array.isArray(msgArray) || msgArray.length === 0) {
          logInfo('twse-mis', `no quote rows for ${base} ex_ch=${exCh}`);
          break;
        }

        const candidates = msgArray
          .map((msg) => parseTwseMisMessage(msg, base))
          .filter((quote) => quote && quote.symbol === base && quote.price != null);

        if (candidates.length) {
          candidates.sort((a, b) => getTwseMisCandidateScore(b) - getTwseMisCandidateScore(a));
          return candidates[0];
        }
        logInfo('twse-mis', `parsed no usable quote for ${base} ex_ch=${exCh}`);
        break;
      } catch (e) {
        lastError = e;
        logError('twse-mis', `request failed for ${base} ex_ch=${exCh}`, e);
      }
    }
  }

  if (lastError) throw lastError;
  return null;
}

function extractYahooQuoteSnapshot(payload) {
  try {
    const r = payload?.quoteResponse?.result?.[0];
    if (r) {
      const price = r.regularMarketPrice ?? r.regularMarketPreviousClose ?? null;
      const marketTime = Number(r.regularMarketTime);
      if (Number.isFinite(price)) {
        return {
          price: Number(price),
          marketTime: Number.isFinite(marketTime) ? marketTime : null,
          date: Number.isFinite(marketTime) ? formatTaipeiDateFromUnix(marketTime) : null
        };
      }
    }
  } catch { /* noop */ }

  try {
    const m = payload?.chart?.result?.[0]?.meta;
    const price = m?.regularMarketPrice ?? m?.previousClose ?? null;
    const marketTime = Number(m?.regularMarketTime);
    if (Number.isFinite(price)) {
      return {
        price: Number(price),
        marketTime: Number.isFinite(marketTime) ? marketTime : null,
        date: Number.isFinite(marketTime) ? formatTaipeiDateFromUnix(marketTime) : null
      };
    }
  } catch { /* noop */ }

  return null;
}

async function fetchLatestOfficialClose(symbol) {
  const base = String(symbol || '').trim().toUpperCase().replace(/\.(TW|TWO)$/, '');
  let twseData = null;
  let tpexData = null;

  try {
    twseData = await fetchFromTwse(base, 10);
  } catch (e) {
    logError('twse-quote', `latest close failed for ${base}`, e);
  }

  try {
    tpexData = await fetchFromTpex(base, 10);
  } catch (e) {
    logError('tpex-quote', `latest close failed for ${base}`, e);
  }

  const merged = dedupeAndSortHistory([...(twseData || []), ...(tpexData || [])]);
  if (!merged.length) return null;

  const latest = merged[merged.length - 1];
  const prev = merged[merged.length - 2] || latest;
  const marketTimeMs = Date.parse(`${latest.date}T13:30:00+08:00`);

  return {
    symbol: base,
    date: latest.date,
    close: latest.close,
    prevClose: prev.close,
    marketTime: Number.isFinite(marketTimeMs) ? Math.floor(marketTimeMs / 1000) : null,
    source: 'official-eod'
  };
}

function buildOfficialQuotePayload(symbol, officialQuote) {
  return {
    quoteResponse: {
      result: [{
        symbol: officialQuote.symbol || String(symbol || '').trim().toUpperCase(),
        regularMarketPrice: officialQuote.close,
        regularMarketPreviousClose: officialQuote.prevClose,
        regularMarketTime: officialQuote.marketTime,
        marketState: 'CLOSED',
        sourceInterval: '1d',
        _source: officialQuote.source,
        _tradeDate: officialQuote.date
      }],
      error: null
    }
  };
}

function buildTwseMisQuotePayload(symbol, twQuote) {
  const marketState = twQuote.marketPhase === 'regular'
    ? 'REGULAR'
    : (twQuote.marketPhase === 'preopen' ? 'PREPRE' : 'CLOSED');
  return {
    quoteResponse: {
      result: [{
        symbol: twQuote.symbol || String(symbol || '').trim().toUpperCase(),
        shortName: twQuote.name || undefined,
        regularMarketPrice: twQuote.price,
        regularMarketPreviousClose: twQuote.prevClose,
        regularMarketChange: twQuote.price != null && twQuote.prevClose != null
          ? Number((twQuote.price - twQuote.prevClose).toFixed(2))
          : null,
        regularMarketChangePercent: twQuote.price != null && twQuote.prevClose
          ? Number((((twQuote.price - twQuote.prevClose) / twQuote.prevClose) * 100).toFixed(2))
          : null,
        regularMarketOpen: twQuote.openPrice,
        regularMarketDayHigh: twQuote.highPrice,
        regularMarketDayLow: twQuote.lowPrice,
        regularMarketVolume: twQuote.totalVolume,
        regularMarketTime: twQuote.marketTime,
        marketState,
        sourceInterval: twQuote.marketPhase === 'regular' ? '1m' : '1d',
        _source: twQuote.source,
        _tradeDate: twQuote.date,
        _tradeTime: twQuote.tradeTime,
        _marketPhase: twQuote.marketPhase,
        _priceSource: twQuote.priceSource
      }],
      error: null
    }
  };
}

async function fetchYahooOnce(url, options = {}) {
  const timeout = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 12000;
  return axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    },
    timeout,
    validateStatus: (s) => s >= 200 && s < 500 // allow 4xx to inspect body
  });
}

function annotateYahooQuotePayload(payload, via, symbol) {
  const snapshot = extractYahooQuoteSnapshot(payload);
  const tradeDate = snapshot?.date || null;
  try {
    const r = payload?.quoteResponse?.result?.[0];
    if (r) {
      r._source = 'yahoo';
      r._quoteVia = via;
      if (tradeDate) r._tradeDate = tradeDate;
    }
  } catch { /* noop */ }

  try {
    const m = payload?.chart?.result?.[0]?.meta;
    if (m) {
      m._source = 'yahoo';
      m._quoteVia = via;
      if (tradeDate) m._tradeDate = tradeDate;
      if (symbol && !m.symbol) m.symbol = symbol;
    }
  } catch { /* noop */ }

  return payload;
}

async function tryYahoo(symbol, options = {}) {
  const cand = buildCandidates(symbol);
  let lastErr = null;
  for (const sym of cand) {
    // Try V8
    try {
      const url8 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`;
      const r8 = await fetchYahooOnce(url8, options);
      const price8 = parseV8Price(r8.data);
      if (Number.isFinite(price8)) {
        annotateYahooQuotePayload(r8.data, 'v8', sym);
        return { ok: true, via: 'v8', symbol: sym, data: r8.data };
      }
    } catch (e) { lastErr = e; }

    // Try V7
    try {
      const url7 = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
      const r7 = await fetchYahooOnce(url7, options);
      const price7 = parseV7Price(r7.data);
      if (Number.isFinite(price7)) {
        annotateYahooQuotePayload(r7.data, 'v7', sym);
        return { ok: true, via: 'v7', symbol: sym, data: r7.data };
      }
    } catch (e) { lastErr = e; }
  }
  return { ok: false, error: lastErr || new Error('No candidate succeeded') };
}

async function resolveQuote(symbol, options = {}) {
  const normalized = String(symbol || '').trim().toUpperCase();
  const isTaiwanSymbol = isTaiwanQuoteSymbol(normalized);
  const yahooOptions = { timeoutMs: options.yahooTimeoutMs };

  if (!isTaiwanSymbol) {
    return tryYahoo(normalized, yahooOptions);
  }

  try {
    const twQuote = await fetchTwseMisQuote(normalized, {
      timeoutMs: options.twseTimeoutMs,
      attempts: options.twseAttempts,
      maxCandidates: options.twseMaxCandidates
    });
    if (twQuote && twQuote.price != null) {
      return {
        ok: true,
        via: twQuote.source,
        symbol: twQuote.symbol,
        data: buildTwseMisQuotePayload(normalized, twQuote)
      };
    }
  } catch (e) {
    logError('twse-mis', `failed for ${normalized}`, e);
  }

  const yahooFallback = await tryYahoo(normalized, yahooOptions);
  if (yahooFallback.ok) {
    return yahooFallback;
  }
  logError('yahoo-quote', `failed for ${normalized}`, yahooFallback.error || new Error('Yahoo quote unavailable'));

  const fallbackOfficial = await fetchLatestOfficialClose(normalized).catch((e) => {
    logError('official-quote', `failed for ${normalized}`, e);
    return null;
  });

  if (fallbackOfficial) {
    return {
      ok: true,
      via: fallbackOfficial.source,
      symbol: fallbackOfficial.symbol,
      data: buildOfficialQuotePayload(normalized, fallbackOfficial)
    };
  }

  return { ok: false, error: new Error('No Taiwan quote source succeeded') };
}

function summarizeQuotePayload(payload) {
  const snapshot = extractYahooQuoteSnapshot(payload);
  const r = payload?.quoteResponse?.result?.[0] || null;
  const m = payload?.chart?.result?.[0]?.meta || null;
  const node = r || m || {};
  return {
    price: snapshot?.price ?? null,
    marketTime: snapshot?.marketTime ?? null,
    marketState: node.marketState || '',
    source: node._source || '',
    tradeDate: node._tradeDate || '',
    tradeTime: node._tradeTime || '',
    marketPhase: node._marketPhase || '',
    priceSource: node._priceSource || '',
  };
}

function normalizeQuoteBatchSymbols(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '').split(',');
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const symbol = String(item || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out.slice(0, 80);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function resolveQuoteCompact(symbol) {
  const fastOptions = {
    twseTimeoutMs: 2500,
    twseAttempts: 1,
    twseMaxCandidates: 2,
    yahooTimeoutMs: 6500
  };
  try {
    const r = await resolveQuote(symbol, fastOptions);
    if (!r.ok) {
      return { requestedSymbol: symbol, ok: false, message: r.error?.message || '股價查詢失敗' };
    }
    const summary = summarizeQuotePayload(r.data);
    if (!Number.isFinite(Number(summary.price))) {
      return { requestedSymbol: symbol, ok: false, message: '來源未回傳可用價格' };
    }
    return {
      requestedSymbol: symbol,
      ok: true,
      symbol: r.symbol,
      via: r.via,
      ...summary
    };
  } catch (e) {
    return { requestedSymbol: symbol, ok: false, message: e?.message || String(e) };
  }
}

// 股價查詢端點（整合候選符號與多端點備援）
app.get('/quote', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: '缺少 symbol 參數' });
  console.log(`[quote] 查詢: ${symbol}`);
  const r = await resolveQuote(symbol);
  if (r.ok) {
    res.set('X-Used-Symbol', r.symbol);
    res.set('X-Used-Endpoint', r.via);
    return res.json(r.data);
  }
  console.error(`[quote] 全部嘗試失敗: ${symbol}`, r.error?.message || r.error);
  return res.status(502).json({ error: '股價查詢失敗', message: r.error?.message || String(r.error) });
});

async function handleQuoteBatch(req, res) {
  const symbols = normalizeQuoteBatchSymbols(req.body?.symbols || req.query?.symbols);
  if (!symbols.length) return res.status(400).json({ error: '缺少 symbols 參數' });
  console.log(`[quotes] 批次查詢: ${symbols.join(', ')}`);
  const startedAt = Date.now();
  const results = await mapWithConcurrency(symbols, QUOTE_BATCH_LIMIT, resolveQuoteCompact);
  const successCount = results.filter((r) => r?.ok).length;
  return res.json({
    ok: successCount > 0,
    total: symbols.length,
    successCount,
    durationMs: Date.now() - startedAt,
    results
  });
}

// 批次股價查詢端點：給持股頁「即時更新全部」使用，採短等待 + 快速回退策略。
app.post('/quotes', handleQuoteBatch);
app.get('/quotes', handleQuoteBatch);

// 股價查詢端點 (備用；同樣使用強化邏輯，以提高成功率)
app.get('/quote2', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: '缺少 symbol 參數' });
  console.log(`[quote2] 查詢: ${symbol}`);
  const r = await resolveQuote(symbol);
  if (r.ok) {
    res.set('X-Used-Symbol', r.symbol);
    res.set('X-Used-Endpoint', r.via);
    return res.json(r.data);
  }
  console.error(`[quote2] 全部嘗試失敗: ${symbol}`, r.error?.message || r.error);
  return res.status(502).json({ error: '股價查詢失敗', message: r.error?.message || String(r.error) });
});

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`代理伺服器運行在 http://localhost:${PORT}`);
  console.log(`WantGoo 代理端點: http://localhost:${PORT}/api/wantgoo/:symbol`);
  console.log(`ETF NAV 折溢價 (MoneyDJ): http://localhost:${PORT}/api/wantgoo-nav/:symbol`);
  console.log(`歷史股價端點: http://localhost:${PORT}/api/history?symbol=0050&days=260`);
  console.log(`股價查詢端點: http://localhost:${PORT}/quote?symbol=SYMBOL`);
  console.log(`股價查詢端點 (備用): http://localhost:${PORT}/quote2?symbol=SYMBOL`);
  console.log(`健康檢查: http://localhost:${PORT}/health`);
});

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n正在關閉代理伺服器...');
  process.exit(0);
});
