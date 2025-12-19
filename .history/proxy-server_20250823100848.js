const express = require('express');
const fetch = require('node-fetch'); // v2
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// /quote?symbol=0050.TW
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

app.listen(PORT, () => console.log(`proxy server listening on http://localhost:${PORT}`));
