// proxy-server.js
const express = require('express');
const fetch = require('node-fetch'); // v2
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// 健康檢查
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * 原本的 /quote：Yahoo v7/finance/quote
 * 近期常回 Unauthorized；保留以備後用
 * 範例：/quote?symbol=0050.TW
 */
app.get('/quote', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: 'missing symbol' });

    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'node-proxy' } });
    const text = await r.text();

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.type('application/json').send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 新的 /quote2：Yahoo v8/finance/chart（通常不需授權）
 * 可從 meta 讀到 regularMarketPrice、currency 等
 * 範例：/quote2?symbol=0050.TW
 */
app.get('/quote2', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: 'missing symbol' });

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
    const r = await fetch(url, { headers: { 'User-Agent': 'node-proxy' } });
    const text = await r.text();

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.type('application/json').send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 新的 /twse：台灣證交所即時 JSON（官方）
 * 台股即時價很穩定；上市 tse_XXXX.tw，上櫃改 otc_XXXX.tw
 * 範例（台灣50）：/twse?symbol=0050
 * 範例（台積電）：/twse?symbol=2330
 */
app.get('/twse', async (req, res) => {
  try {
    const symbol = req.query.symbol; // 只填數字代碼，如 0050、2330
    if (!symbol) return res.status(400).json({ error: 'missing symbol' });

    // 上市用 tse_；若是上櫃請改成 otc_
    const ex_ch = `tse_${symbol}.tw`;
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(ex_ch)}`;

    const r = await fetch(url, {
      headers: {
        'User-Agent': 'node-proxy',
        'Referer': 'https://mis.twse.com.tw/stock/index.jsp',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      }
    });
    const text = await r.text();

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.type('application/json').send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`proxy server listening on http://localhost:${PORT}`));
