// proxy-server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = 3000;

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
  console.log(`股價查詢端點: http://localhost:${PORT}/quote?symbol=SYMBOL`);
  console.log(`股價查詢端點 (備用): http://localhost:${PORT}/quote2?symbol=SYMBOL`);
  console.log(`健康檢查: http://localhost:${PORT}/health`);
});

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n正在關閉代理伺服器...');
  process.exit(0);
});
