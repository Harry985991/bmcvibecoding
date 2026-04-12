// proxy-server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = 3000;
const historyCache = new Map(); // key: `${symbol}_${days}` => { data, source, priceType, fetchedAt }
const inflightHistory = new Map(); // key => Promise
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1 hour
const HISTORY_SYMBOL_RE = /^[0-9]{4,6}[A-Z]?$/;
const TWSE_UA = 'Mozilla/5.0 (compatible; PortfolioTracker/1.0)';
const YAHOO_UA = 'Mozilla/5.0';

// 啟用 CORS
app.use(cors());
app.use(express.json());

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

  // PRIMARY: Yahoo Finance (adjusted prices)
  try {
    const yahooData = await fetchFromYahoo(symbol, days);
    if (enough(yahooData)) {
      return { source: 'yahoo', priceType: 'adjusted', data: yahooData };
    }
    logInfo('history', `Yahoo returned insufficient data for ${symbol}, trying TWSE/TPEx`);
  } catch (e) {
    logError('yahoo', `failed for ${symbol}`, e);
  }

  // FALLBACK: TWSE/TPEx official raw prices
  try {
    const twseData = await fetchFromTwse(symbol, days);
    if (enough(twseData)) {
      return { source: 'twse', priceType: 'raw', data: twseData };
    }

    // Extend fallback for OTC symbols (e.g. bond ETFs) via TPEx official endpoint.
    const tpexData = await fetchFromTpex(symbol, days);
    const merged = dedupeAndSortHistory([...(twseData || []), ...(tpexData || [])]).slice(-days);
    if (merged.length > 0) {
      return { source: 'twse', priceType: 'raw', data: merged };
    }
    logInfo('history', `TWSE/TPEx returned no usable rows for ${symbol}`);
  } catch (e) {
    logError('twse', `failed for ${symbol}`, e);
  }

  return null;
}

app.get('/api/history', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const daysRaw = req.query.days;

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
  if (cached && (Date.now() - cached.fetchedAt) < HISTORY_TTL_MS) {
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
  const isTWCodeLike = /^[0-9]{3,6}[A-Z]?$/.test(base);

  if (hasSuffix) {
    add(orig);
    add(base + (orig.endsWith('.TW') ? '.TWO' : '.TW'));
    add(base); // in case Yahoo accepts bare code
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

async function fetchYahooOnce(url) {
  return axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    },
    timeout: 12000,
    validateStatus: (s) => s >= 200 && s < 500 // allow 4xx to inspect body
  });
}

async function tryYahoo(symbol) {
  const cand = buildCandidates(symbol);
  let lastErr = null;
  for (const sym of cand) {
    // Try V8
    try {
      const url8 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`;
      const r8 = await fetchYahooOnce(url8);
      const price8 = parseV8Price(r8.data);
      if (Number.isFinite(price8)) {
        return { ok: true, via: 'v8', symbol: sym, data: r8.data };
      }
    } catch (e) { lastErr = e; }

    // Try V7
    try {
      const url7 = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
      const r7 = await fetchYahooOnce(url7);
      const price7 = parseV7Price(r7.data);
      if (Number.isFinite(price7)) {
        return { ok: true, via: 'v7', symbol: sym, data: r7.data };
      }
    } catch (e) { lastErr = e; }
  }
  return { ok: false, error: lastErr || new Error('No candidate succeeded') };
}

// 股價查詢端點（整合候選符號與多端點備援）
app.get('/quote', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: '缺少 symbol 參數' });
  console.log(`[quote] 查詢: ${symbol}`);
  const r = await tryYahoo(symbol);
  if (r.ok) {
    res.set('X-Used-Symbol', r.symbol);
    res.set('X-Used-Endpoint', r.via);
    return res.json(r.data);
  }
  console.error(`[quote] 全部嘗試失敗: ${symbol}`, r.error?.message || r.error);
  return res.status(502).json({ error: '股價查詢失敗', message: r.error?.message || String(r.error) });
});

// 股價查詢端點 (備用；同樣使用強化邏輯，以提高成功率)
app.get('/quote2', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: '缺少 symbol 參數' });
  console.log(`[quote2] 查詢: ${symbol}`);
  const r = await tryYahoo(symbol);
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
