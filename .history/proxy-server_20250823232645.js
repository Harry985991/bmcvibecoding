// proxy-server.js
const express = require('express');
const fetch = require('node-fetch'); // v2
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

// /quote?symbol=0050.TW  -> Yahoo v7 quote JSON (原本 v7)
app.get('/quote', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    if(!symbol) return res.status(400).json({error:'missing symbol'});
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'node-proxy' } });
    const text = await r.text();
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.type('application/json').send(text);
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// /quote2?symbol=0050.TW -> Yahoo v8 chart (meta)（你的前端用到 meta.regularMarketPrice）
app.get('/quote2', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    if(!symbol) return res.status(400).json({error:'missing symbol'});
    // 使用 v8 chart endpoint
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'node-proxy' } });
    const text = await r.text();
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.type('application/json').send(text);
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// /twse?symbol=0050 -> TWSE 備援（回傳原始 TWSE JSON）
app.get('/twse', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    if(!symbol) return res.status(400).json({error:'missing symbol'});
    // 這裡採用 TWSE 即時報價 API（若你有別的 TWSE endpoint 可改）
    // 範例使用 mis.twse.com.tw getStockInfo（回傳結構會不同，前端需配合）
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${encodeURIComponent(symbol)}.tw`;
    const r = await fetch(url, { headers: { 'User-Agent': 'node-proxy' } });
    const text = await r.text();
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.type('application/json').send(text);
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

app.listen(PORT, ()=> console.log(`proxy server listening on http://localhost:${PORT}`));
