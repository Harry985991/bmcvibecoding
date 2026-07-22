  // ========= 價格供應器（本地代理專用）=========
  // 僅使用本地 Node.js proxy server，不再依賴 jina / allorigins 等外部服務。
  // 啟動方式：cd /Users/harrychao/claude-workspace/tools/vibecoding && npm start
  const priceProvider = {
    async fetch(symbol) {
      if (!symbol) return null;
      const origSym = String(symbol).toUpperCase();
      const LOCAL = (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');

      // 建立要嘗試的代號格式清單
      const symbolsToTry = [];
      if (origSym.endsWith('B')) {
        // 債券代碼（00687B 等）嘗試三種格式
        symbolsToTry.push(origSym, `${origSym}.TW`, `${origSym}.TWO`);
      } else if (origSym.endsWith('.TW') || origSym.endsWith('.TWO')) {
        symbolsToTry.push(origSym);
      } else {
        symbolsToTry.push(`${origSym}.TW`);
      }

      const parseV8 = (j) => {
        try {
          const m = j?.chart?.result?.[0]?.meta;
          const price = m?.regularMarketPrice ?? m?.previousClose ?? null;
          const marketTime = Number(m?.regularMarketTime);
          if (price == null || isNaN(Number(price))) return null;
          return {
            price: Number(price),
            marketTime: Number.isFinite(marketTime) ? marketTime : null
          };
        } catch { return null; }
      };
      const parseV7 = (j) => {
        try {
          const r = j?.quoteResponse?.result?.[0];
          const price = r?.regularMarketPrice ?? r?.regularMarketPreviousClose ?? null;
          const marketTime = Number(r?.regularMarketTime);
          if (price == null || isNaN(Number(price))) return null;
          return {
            price: Number(price),
            marketTime: Number.isFinite(marketTime) ? marketTime : null
          };
        } catch { return null; }
      };

      for (const sym of symbolsToTry) {
        // 端點 1：/quote2
        try {
          const res = await fetch(`${LOCAL}/quote2?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' });
          if (res.ok) {
            const j = await res.json();
            const q = parseV8(j) ?? parseV7(j);
            if (q && typeof q.price === 'number' && !isNaN(q.price)) {
              return { price: Number(q.price), marketTime: q.marketTime, via: 'local-quote2', symbol: sym };
            }
          }
        } catch { /* 代理未啟動，繼續嘗試下一端點 */ }

        // 端點 2：/quote
        try {
          const res = await fetch(`${LOCAL}/quote?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' });
          if (res.ok) {
            const j = await res.json();
            const q = parseV7(j) ?? parseV8(j);
            if (q && typeof q.price === 'number' && !isNaN(q.price)) {
              return { price: Number(q.price), marketTime: q.marketTime, via: 'local-quote', symbol: sym };
            }
          }
        } catch { /* 繼續 */ }
      }

      // 全部失敗：回傳結構化錯誤，讓呼叫端顯示清楚提示
      return { error: true, symbol: origSym, message: '本地代理無回應，請確認已執行 npm start' };
    },
    async fetchBatch(symbols) {
      const list = Array.from(new Set((symbols || [])
        .map(s => String(s || '').trim().toUpperCase())
        .filter(Boolean)));
      if (!list.length) return { ok: true, quotes: new Map(), results: [] };
      const LOCAL = (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');
      try {
        const res = await fetch(`${LOCAL}/quotes`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: list })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const quotes = new Map();
        const results = Array.isArray(payload?.results) ? payload.results : [];
        for (const item of results) {
          if (!item?.ok || item.price == null || isNaN(Number(item.price))) continue;
          const quote = {
            price: Number(item.price),
            prevClose: item.prevClose != null && Number.isFinite(Number(item.prevClose)) ? Number(item.prevClose) : null,
            prevChangePct: item.prevChangePct != null && Number.isFinite(Number(item.prevChangePct)) ? Number(item.prevChangePct) : null,
            todayOpen: item.todayOpen != null && Number.isFinite(Number(item.todayOpen)) ? Number(item.todayOpen) : null,
            marketTime: Number.isFinite(Number(item.marketTime)) ? Number(item.marketTime) : null,
            marketState: item.marketState || '',
            source: item.source || item.via || '',
            tradeDate: item.tradeDate || '',
            tradeTime: item.tradeTime || '',
            marketPhase: item.marketPhase || '',
            priceSource: item.priceSource || '',
            via: item.via || 'local-quotes',
            symbol: item.symbol || item.requestedSymbol,
          };
          quotes.set(String(item.requestedSymbol || '').toUpperCase(), quote);
          if (item.symbol) quotes.set(String(item.symbol).replace(/\.(TW|TWO)$/i, '').toUpperCase(), quote);
        }
        return { ok: true, quotes, results, durationMs: payload?.durationMs || null };
      } catch (err) {
        console.warn('[priceProvider.fetchBatch] batch quote failed, fallback to single quote', err);
        const quotes = new Map();
        const results = await Promise.allSettled(list.map(async (symbol) => {
          const q = await priceProvider.fetch(symbol);
          if (q && !q.error && typeof q.price === 'number') {
            quotes.set(symbol, q);
            return { requestedSymbol: symbol, ok: true };
          }
          return { requestedSymbol: symbol, ok: false, message: q?.message || '無法取得價格' };
        }));
        return { ok: quotes.size > 0, quotes, results };
      }
    },
    async fetchQuote(symbol) {
      if (!symbol) return null;
      const origSym = String(symbol).toUpperCase();
      const LOCAL = (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');

      const symbolsToTry = [];
      if (origSym.endsWith('B')) {
        symbolsToTry.push(origSym, `${origSym}.TW`, `${origSym}.TWO`);
      } else if (origSym.endsWith('.TW') || origSym.endsWith('.TWO')) {
        symbolsToTry.push(origSym);
      } else {
        symbolsToTry.push(`${origSym}.TW`);
      }

      const parseV7Full = (j) => {
        try {
          const r = j?.quoteResponse?.result?.[0];
          if (!r) return null;
          const live = r.regularMarketPrice ?? r.regularMarketPreviousClose ?? null;
          if (live == null || isNaN(Number(live))) return null;
          return {
            livePrice:     Number(live),
            prevClose:     r.regularMarketPreviousClose != null ? Number(r.regularMarketPreviousClose) : null,
            prevChangePct: r.regularMarketChangePercent != null ? Number(r.regularMarketChangePercent) : null,
            todayOpen:     r.regularMarketOpen != null ? Number(r.regularMarketOpen) : null,
            marketTime:    Number.isFinite(Number(r.regularMarketTime)) ? Number(r.regularMarketTime) : null,
            marketState:   r.marketState || '',
            source:        r._source || '',
            tradeDate:     r._tradeDate || '',
            tradeTime:     r._tradeTime || '',
            marketPhase:   r._marketPhase || '',
            priceSource:   r._priceSource || '',
          };
        } catch { return null; }
      };

      const parseV8Full = (j) => {
        try {
          const m = j?.chart?.result?.[0]?.meta;
          if (!m) return null;
          const live = m.regularMarketPrice ?? m.previousClose ?? null;
          if (live == null || isNaN(Number(live))) return null;
          return {
            livePrice:     Number(live),
            prevClose:     m.chartPreviousClose != null ? Number(m.chartPreviousClose) : (m.previousClose != null ? Number(m.previousClose) : null),
            prevChangePct: null,
            todayOpen:     null,
            marketTime:    Number.isFinite(Number(m.regularMarketTime)) ? Number(m.regularMarketTime) : null,
            marketState:   m.marketState || '',
            source:        m._source || '',
            tradeDate:     m._tradeDate || '',
            tradeTime:     m._tradeTime || '',
            marketPhase:   m._marketPhase || '',
            priceSource:   m._priceSource || '',
          };
        } catch { return null; }
      };

      for (const sym of symbolsToTry) {
        try {
          const res = await fetch(`${LOCAL}/quote?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' });
          if (res.ok) {
            const j = await res.json();
            const q = parseV7Full(j) ?? parseV8Full(j);
            if (q) return { ...q, symbol: sym, via: 'local-quote' };
          }
        } catch { /* continue */ }

        try {
          const res = await fetch(`${LOCAL}/quote2?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' });
          if (res.ok) {
            const j = await res.json();
            const q = parseV8Full(j) ?? parseV7Full(j);
            if (q) return { ...q, symbol: sym, via: 'local-quote2' };
          }
        } catch { /* continue */ }
      }

      return { error: true, symbol: origSym, message: '本地代理無回應' };
    }
  };

  // ========= ETF 判斷 + NAV 折溢價 =========
  function isEtfSymbol(symbol){
    const s = String(symbol || '').trim().toUpperCase();
    // 台灣 ETF：00 開頭 4~6 碼（含債券 ETF 尾碼 B）
    return /^00\d{2,4}[A-Z]?B?$/.test(s);
  }

  // 主動式 ETF 白名單（高股息、ESG、主題型等由經理人主動選股的 ETF）
  const ACTIVE_ETF_SET = new Set([
    '00692','00701','00731','00850','00878','00888','00891','00893','00894',
    '00895','00896','00900','00901','00904','00905','00907','00912','00913',
    '00915','00918','00919','00921','00922','00927','00929','00930','00932',
    '00934','00936','00937','00939','00940','00941','00943','00944','00946',
    '006205','006206','006207','00679B','00687B','00695B','00696B','00697B',
    '00718B','00719B','00720B','00721B','00722B','00723B','00724B','00725B',
    '00726B','00727B','00734B','00740B','00741B','00751B','00761B','00764B',
    '00772B','00773B','00778B','00779B','00780B','00781B','00782B','00783B',
    '00786B','00787B','00788B','00789B','00790B','00791B','00792B','00793B',
    '00794B','00795B','00796B','00847B','00848B','00849B','00853B','00854B',
    '00855B','00856B','00857B','00858B','00859B','00860B','00861B','00862B',
    '00863B','00864B','00865B','00931B','00933B','00937B','00938B','00942B'
  ]);
  function classifySymbol(symbol, categoryOverride) {
    if (categoryOverride === 'stock')   return { label: '個股', cls: 'wl-cat-stock' };
    if (categoryOverride === 'passive') return { label: '被動ETF', cls: 'wl-cat-passive' };
    if (categoryOverride === 'active')  return { label: '主動ETF', cls: 'wl-cat-active' };
    const s = String(symbol || '').trim().toUpperCase();
    if (!isEtfSymbol(s)) return { label: '個股', cls: 'wl-cat-stock' };
    if (ACTIVE_ETF_SET.has(s)) return { label: '主動ETF', cls: 'wl-cat-active' };
    return { label: '被動ETF', cls: 'wl-cat-passive' };
  }

  async function fetchNavPremium(symbol){
    const sym = String(symbol || '').trim().toUpperCase();
    if(!sym) return null;
    const cacheKey = `nav_premium_${sym}`;
    const TTL = 6 * 60 * 60 * 1000;
    try{
      const cached = await idbGet(cacheKey);
      if(cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < TTL){
        return cached.data;
      }
    }catch(e){ /* ignore */ }
    try{
      const baseUrl = (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/wantgoo-nav/${encodeURIComponent(sym)}`, { cache: 'no-store' });
      if(!res.ok) return null;
      const json = await res.json();
      if(json.error) return null;
      const data = {
        nav: json.nav ?? null,
        marketPrice: json.marketPrice ?? null,
        premiumPct: json.premiumPct ?? null,
        date: json.date ?? null
      };
      try{ await idbPut(cacheKey, { fetchedAt: Date.now(), data }); }catch(e){}
      return data;
    }catch(e){
      console.warn(`[nav] ${sym} fetch failed:`, e);
      return null;
    }
  }


  const priceHistoryInFlight = {};

  async function fetchPriceHistory(symbol, force = false) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return null;
    const cacheKey = `history_official_v1_${sym}`;
    const TTL = 6 * 60 * 60 * 1000;
    if (!force) {
      try {
        const cached = await idbGet(cacheKey);
        if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < TTL) {
          return cached.data;
        }
      } catch (e) { /* ignore */ }
    }
    const requestKey = `${cacheKey}_${force ? 'force' : 'cached'}`;
    if(priceHistoryInFlight[requestKey]) return priceHistoryInFlight[requestKey];

    priceHistoryInFlight[requestKey] = (async () => {
      try {
        const baseUrl = (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');
        const forceQuery = force ? '&force=1' : '';
        const res = await fetch(`${baseUrl}/api/history?symbol=${encodeURIComponent(sym)}&days=260${forceQuery}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('history fetch failed');
        const json = await res.json();
        const data = json.data || [];
        if (data.length > 0) {
          try {
            await idbPut(cacheKey, { symbol: sym, fetchedAt: Date.now(), data });
          } catch (e) { /* ignore */ }
        }
        return data;
      } catch (e) {
        console.warn(`[history] ${sym} fetch failed:`, e);
        return null;
      } finally {
        delete priceHistoryInFlight[requestKey];
      }
    })();
    return priceHistoryInFlight[requestKey];
  }

  // ===== [WEEK1-UPGRADE] Temporary: clear history cache for re-fetch =====
  window.clearHistoryCache = async function() {
    const symbols = (DB.stocks || []).map((s) => (s.symbol || s.id)).filter(Boolean);
    for (const rawSym of symbols) {
      const sym = String(rawSym).trim().toUpperCase();
      if (!sym) continue;
      try {
        await idbPut(`history_official_v1_${sym}`, null);
        await idbPut(`history_${sym}`, null);
      } catch (e) { /* ignore */ }
    }
    console.log('[history] Cache cleared for', symbols.length, 'symbols. Refresh the page to refetch.');
  };
  console.log('[WEEK1] Run window.clearHistoryCache() in console to force refresh indicator data');
