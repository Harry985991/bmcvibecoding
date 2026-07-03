  const storeKey = 'pfv1';
  const IDB_NAME = 'portfolio_db';
  const IDB_STORE = 'data';
  const IDB_KEY = 'pfv1';
  const DEFAULT_INITIAL_CAPITAL = 2626550;
  const DEFAULT_INITIAL_DATE = () => new Date(Date.UTC(2024, 7, 1, 0, 0, 0)).toISOString();

  // ── IndexedDB helpers ──────────────────────────────────────
  let _idb = null;
  let _idbUnavailable = false;
  function openIDB() {
    if (_idb) return Promise.resolve(_idb);
    if (_idbUnavailable) return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((res, rej) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        const timer = setTimeout(() => {
          _idbUnavailable = true;
          console.warn('[IDB] open timeout — falling back to localStorage only');
          rej(new Error('IndexedDB open timeout'));
        }, 2000);
        req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
        req.onsuccess = e => { clearTimeout(timer); _idb = e.target.result; res(_idb); };
        req.onerror   = e => { clearTimeout(timer); rej(e.target.error); };
        req.onblocked = ()=> { clearTimeout(timer); _idbUnavailable = true; rej(new Error('IndexedDB blocked')); };
      } catch(e) {
        _idbUnavailable = true;
        rej(e);
      }
    });
  }
  async function idbGet(key) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror   = e => rej(e.target.error);
    });
  }
  async function idbPut(key, value) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(value, key);
      req.onsuccess = () => res();
      req.onerror   = e => rej(e.target.error);
    });
  }

  // ── 自動備份（30 分鐘內不重複觸發）──────────────────────
  let _lastBackupTime = 0;
  const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
  function triggerAutoBackup(force = false) {
    const now = Date.now();
    if (!force && now - _lastBackupTime < BACKUP_INTERVAL_MS) return;
    _lastBackupTime = now;
    try {
      const json = JSON.stringify(DB, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const ts   = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
      a.href     = url;
      a.download = `portfolio_backup_${ts}.json`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch(e) {
      console.warn('自動備份失敗：', e);
    }
  }

  // ── 狀態列備份提示 ────────────────────────────────────────
  const dataHealthState = {
    storageWriteError: false,
    storageMessage: '',
    popoverOpen: false
  };
  const holdingsValidationState = {
    popoverOpen: false
  };

  function showBackupStatus(msg, isError = false) {
    let el = document.getElementById('_backup-status');
    if (!el) {
      el = document.createElement('div');
      el.id = '_backup-status';
      el.style.cssText = [
        'position:fixed','bottom:14px','right:16px','z-index:9999',
        'padding:8px 14px','border-radius:8px','font-size:12px',
        'pointer-events:none','transition:opacity .4s','opacity:1',
        'max-width:280px','line-height:1.5'
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = isError ? '#fee2e2' : '#dcfce7';
    el.style.color       = isError ? '#991b1b' : '#166534';
    el.style.opacity     = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = '0'; }, 4000);
  }

  function setInitDebugStatus(text, isError = false) {
    let el = document.getElementById('_init-debug-status');
    if (!el) {
      el = document.createElement('div');
      el.id = '_init-debug-status';
      el.style.cssText = [
        'position:fixed','left:12px','bottom:12px','z-index:100000',
        'padding:6px 10px','border-radius:999px','font-size:11px',
        'line-height:1.2','pointer-events:none',
        'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
        'box-shadow:0 8px 24px rgba(15,23,42,.24)'
      ].join(';');
      document.body.appendChild(el);
    }
    el.style.background = isError ? 'rgba(185,28,28,.94)' : 'rgba(15,23,42,.92)';
    el.style.color = '#fff';
    el.textContent = `${INIT_DEBUG_BUILD} | ${text}`;
  }

  setTimeout(() => {
    try { setInitDebugStatus('script:loaded'); } catch (err) { console.warn('init debug badge failed', err); }
  }, 0);

  // ── 從 localStorage 遷移舊資料（只跑一次）───────────────
  async function migrateFromLocalStorage() {
    const migrated = localStorage.getItem('_idb_migrated');
    if (migrated) return null;
    const raw = localStorage.getItem(storeKey);
    if (!raw) { localStorage.setItem('_idb_migrated', '1'); return null; }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        console.log('[Migration] 將 localStorage 資料遷移至 IndexedDB...');
        return parsed;
      }
    } catch(e) {}
    return null;
  }

  // ── loadDB：優先從較新的儲存來源載入，避免 localStorage / IndexedDB 不一致時回滾 ─
  const fallbackDB = () => ({ stocks:[], txns:[], accounts:[], snapshots:[], meta:{}, watchlist:[] });
  function sanitizeDBShape(data){
    if (!data || typeof data !== 'object') return null;
    return {
      stocks: Array.isArray(data.stocks) ? data.stocks : [],
      txns: Array.isArray(data.txns) ? data.txns : [],
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      snapshots: Array.isArray(data.snapshots) ? data.snapshots : [],
      meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
      watchlist: Array.isArray(data.watchlist) ? data.watchlist : []
    };
  }
  function getDBUpdatedAt(data){
    const ts = data?.meta?._updatedAt;
    const t = ts ? new Date(ts).getTime() : Number.NaN;
    return Number.isFinite(t) ? t : 0;
  }
  function hasUsefulPortfolioData(data){
    if(!data || typeof data !== 'object') return false;
    return ['stocks','txns','accounts','watchlist'].some(key => Array.isArray(data[key]) && data[key].length > 0);
  }
  function getLocalApiBase(){
    return (window.API_BASE || 'http://localhost:3000').replace(/\/$/, '');
  }
  let _lastServerDBSource = '';
  async function loadServerDB(){
    if(typeof fetch !== 'function') return null;
    const urls = [`${getLocalApiBase()}/api/load-db`];
    try {
      if(window.location && /^https?:$/.test(window.location.protocol)){
        const localDataURL = new URL('/data/db.json', window.location.origin).href;
        if(!urls.includes(localDataURL)) urls.push(localDataURL);
      }
    } catch(e) {}
    for(const url of urls){
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if(!res.ok) continue;
        const data = sanitizeDBShape(await res.json());
        if(data){
          _lastServerDBSource = url;
          return data;
        }
      } catch(e) {
        console.warn(`[loadDB] 備份讀取失敗：${url}`, e);
      }
    }
    return null;
  }
  function markDBUpdated(target){
    if(!target.meta || typeof target.meta !== 'object') target.meta = {};
    target.meta._updatedAt = new Date().toISOString();
    return target;
  }
  async function loadDB() {
    const migrationData = await migrateFromLocalStorage();
    let idbData = null;
    let localData = null;
    let serverData = null;
    try {
      idbData = sanitizeDBShape(await idbGet(IDB_KEY));
    } catch(e) {
      console.warn('[loadDB] IndexedDB 讀取失敗，改讀 localStorage：', e);
    }
    try {
      localData = sanitizeDBShape(migrationData || JSON.parse(localStorage.getItem(storeKey) || 'null'));
    } catch(e) {
      localData = null;
    }
    serverData = await loadServerDB();

    const candidates = [idbData, localData, serverData].filter(Boolean);
    if(candidates.length === 0) return fallbackDB();

    let db = candidates
      .slice()
      .sort((a, b) => {
        const usefulDiff = Number(hasUsefulPortfolioData(b)) - Number(hasUsefulPortfolioData(a));
        if(usefulDiff !== 0) return usefulDiff;
        return getDBUpdatedAt(b) - getDBUpdatedAt(a);
      })[0];
    db = sanitizeDBShape(db) || fallbackDB();

    try {
      await idbPut(IDB_KEY, db);
      localStorage.setItem(storeKey, JSON.stringify(db));
      dataHealthState.storageWriteError = false;
      dataHealthState.storageMessage = '';
      if(serverData && db === serverData && hasUsefulPortfolioData(serverData)) {
        const sourceLabel = _lastServerDBSource.includes('/data/db.json') ? '本機資料檔' : 'Server 備份';
        showBackupStatus(`已從${sourceLabel}載入資料 ✓`);
      }
      if(migrationData) {
        localStorage.setItem('_idb_migrated', '1');
        showBackupStatus('資料已從 localStorage 遷移至 IndexedDB ✓');
      }
    } catch(e) {
      console.warn('[loadDB] 無法回補較新的資料到雙儲存層：', e);
    }
    return db;
  }

  // ── saveDB：同時寫 IndexedDB + localStorage + Server（三重保障）──
  async function saveDB(opts = {}) {
    if(!opts.allowEmptySave && !hasUsefulPortfolioData(DB)){
      dataHealthState.storageWriteError = true;
      dataHealthState.storageMessage = '目前瀏覽器資料為空，已阻止覆蓋完整備份';
      showBackupStatus('已阻止空資料覆蓋完整備份', true);
      console.warn('[saveDB] blocked empty DB overwrite');
      return;
    }
    markDBUpdated(DB);
    invalidateTxnIndex();
    invalidateSummary();
    // 1. 同步寫 localStorage（確保即時可讀）
    try { localStorage.setItem(storeKey, JSON.stringify(DB)); } catch(e) {}
    // 2. 非同步寫 IndexedDB
    idbPut(IDB_KEY, DB).catch(e => {
      console.warn('[saveDB] IndexedDB 寫入失敗：', e);
      dataHealthState.storageWriteError = true;
      dataHealthState.storageMessage = 'IndexedDB 寫入失敗，重新整理後可能回到舊資料';
      showBackupStatus('IndexedDB 寫入失敗，重新整理後可能回到舊資料', true);
    });

    // 3. 同步到伺服器 (New!)
    try {
      const LOCAL = getLocalApiBase();
      const res = await fetch(`${LOCAL}/api/save-db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DB)
      });
      if (res.ok) {
        console.log('[saveDB] 資料已成功同步至伺服器');
      }
    } catch (e) {
      console.warn('[saveDB] 無法同步至伺服器，可能代理未啟動');
    }

    // 每次有交易異動才觸發下載備份
    if (opts.backup) triggerAutoBackup();
  }

  // ── txnIndex：交易按 stockId 分組的快取 ──────────────────
  let _txnIndexMap = null;
  let _txnIndexDirty = true;

  function invalidateTxnIndex() {
    _txnIndexMap = null;
    _txnIndexDirty = true;
  }

  function getTxnsByStockId() {
    if (_txnIndexDirty || !_txnIndexMap) {
      _txnIndexMap = new Map();
      for (const txn of DB.txns) {
        if (!_txnIndexMap.has(txn.stockId)) {
          _txnIndexMap.set(txn.stockId, []);
        }
        _txnIndexMap.get(txn.stockId).push(txn);
      }
      _txnIndexDirty = false;
    }
    return _txnIndexMap;
  }

  function getTxnsForStock(stockId) {
    return getTxnsByStockId().get(stockId) || [];
  }

  // ── summary 快取 dirty flag ─────────────────────────────
  let _summaryDirty = true;
  function invalidateSummary() { _summaryDirty = true; }
  function isSummaryDirty() { return _summaryDirty; }
  function clearSummaryDirty() { _summaryDirty = false; }

  // ── 初始化 DB（async，等待後才 fullRender）───────────────
  let DB = fallbackDB();
  const _dbReady = loadDB().then(data => { DB = data; });
  const ensureInitialCapitalEntry = () => {
    if(!DB.meta) DB.meta = {};
    if(!DB.meta.initialCapital){
      DB.meta.initialCapital = {
        amount: DEFAULT_INITIAL_CAPITAL,
        time: DEFAULT_INITIAL_DATE(),
        note: '起始投入'
      };
      saveDB();
    }
    return DB.meta.initialCapital;
  };
  const getInitialCapitalAmount = () => {
    const entry = ensureInitialCapitalEntry();
    return entry ? parseN(entry.amount) : 0;
  };
  const LOCAL_PROXY_PROJECT_DIR = '/Users/harrychao/claude-workspace/tools/vibecoding';
  const LOCAL_PROXY_START_COMMAND = `cd ${LOCAL_PROXY_PROJECT_DIR} && npm start`;
  const toTradeDateKey = (input) => {
    const ms = typeof input === 'number' ? input : new Date(input).getTime();
    if (!Number.isFinite(ms)) return null;
    const dt = new Date(ms);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const sumCapitalAdjustments = (upTo) => {
    let cutoffTime = null;
    if(upTo){
      const cutoff = new Date(upTo);
      if(!isNaN(cutoff.valueOf())){
        cutoffTime = cutoff.getTime();
        if(typeof upTo === 'string' && !upTo.includes('T')){
          cutoffTime += 86400000 - 1; // include entire day when only date is provided
        }
      }
    }
    return DB.accounts.reduce((total, acct)=>{
      return total + (acct.history||[]).reduce((acc, entry)=>{
        if(entry && (entry.type==='deposit' || entry.type==='withdraw')){
          if(cutoffTime !== null){
            const entryTime = entry.time ? new Date(entry.time).getTime() : null;
            if(entryTime !== null && entryTime > cutoffTime){
              return acc;
            }
          }
          return acc + parseN(entry.amount);
        }
        return acc;
      }, 0);
    }, 0);
  };
