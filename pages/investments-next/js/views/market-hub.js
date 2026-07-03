  // ╔══════════════════════════════════════════════════════════╗
  // ║  投資筆記模組                                              ║
  // ╚══════════════════════════════════════════════════════════╝

  const SEED_MARKET_LINKS = Object.freeze([
    {
      key: 'score-swing',
      title: '評分模型 Swing 版',
      url: 'http://localhost:5052/',
      note: '查看波段評分、交易摘要與當前決策訊號。',
      type: 'local'
    },
    {
      key: 'tw-five-level',
      title: '台股五檔追蹤',
      url: 'http://localhost:5002/',
      note: '追蹤即時價格與買賣五檔深度，盤中觀察主力掛單節奏。',
      type: 'local'
    },
    {
      key: 'playbook-watchlist',
      title: '投資心法及觀察名單',
      url: 'http://localhost:5050/memo',
      note: '快速回看交易日誌、投資心法、觀察名單與盤前 SOP。',
      type: 'local'
    },
    {
      key: 'investment-roadmap',
      title: '投資 Roadmap',
      url: 'file:///Users/harrychao/Downloads/investment_roadmap_5.html',
      note: '開啟本機投資路線圖與規劃頁。',
      type: 'local'
    },
    {
      key: 'claude-ai',
      title: 'Claude AI',
      url: 'https://claude.ai/',
      note: '開啟 Claude 做盤前整理、盤後復盤與臨場判斷討論。',
      type: 'cloud'
    }
  ]);

  function normalizeMarketLinkType(type, url = ''){
    if(type === 'cloud') return 'cloud';
    if(type === 'local') return 'local';
    return isLocalMarketLink(url) ? 'local' : 'cloud';
  }

  function normalizeMarketLinkItem(item, fallback = {}){
    const source = item && typeof item === 'object' ? item : {};
    const key = String(source.key || fallback.key || `custom-${uid()}`);
    const title = String(source.title || fallback.title || '').trim();
    const url = String(source.url || fallback.url || '').trim();
    const note = String(source.note || fallback.note || '').trim();
    return {
      ...fallback,
      ...source,
      key,
      title,
      url,
      note,
      type: normalizeMarketLinkType(source.type || fallback.type, url)
    };
  }

  function ensureMarketLinks(){
    if(!DB.meta || typeof DB.meta !== 'object') DB.meta = {};
    // 首次使用：寫入初始範本
    if(!Array.isArray(DB.meta.marketLinks) || DB.meta.marketLinks.length === 0){
      DB.meta.marketLinks = SEED_MARKET_LINKS.map(item => ({ ...item }));
      return DB.meta.marketLinks;
    }
    // 已有資料：直接使用，不再回補預設值
    return DB.meta.marketLinks;
  }

  function isLocalMarketLink(url){
    const value = String(url || '').trim();
    return /^file:\/\//i.test(value) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(value);
  }

  function buildMarketLinkCard(item, index){
    const url = String(item.url || '').trim();
    const hasUrl = Boolean(url);
    const type = normalizeMarketLinkType(item.type, url);
    const badgeText = type === 'local' ? '本機服務' : '雲端服務';
    const safeUrl = hasUrl ? escapeHtml(url) : '尚未設定';
    const safeTitle = escapeHtml(item.title || '未命名入口');
    const safeNote = escapeHtml(item.note || '尚無說明');
    const safeKey = escapeAttr(item.key || '');
    const openDisabled = hasUrl ? '' : 'disabled';
    const copyDisabled = hasUrl ? '' : 'disabled';

    const div = document.createElement('article');
    div.className = 'market-link-card';
    div.innerHTML = `
      <div class="market-link-top">
        <div>
          <div class="market-link-index">0${index + 1}</div>
          <div class="market-link-title">${safeTitle}</div>
        </div>
        <span class="market-link-badge ${type}">${badgeText}</span>
      </div>
      <div class="market-link-note">${safeNote}</div>
      ${hasUrl
        ? `<div class="market-link-url">${safeUrl}</div>`
        : `<div class="market-link-empty">此入口尚未設定網址，之後可在設定頁補上。</div>`
      }
      <div class="market-link-meta">
        <span>${type === 'local' ? '適合固定工作流' : '跨裝置可用'}</span>
        <span class="dot" aria-hidden="true"></span>
        <span>${hasUrl ? '已配置入口' : '待補連結'}</span>
      </div>
      <div class="market-link-footer">
        <div class="stack">
          <button type="button" class="btn primary" data-action="market-open" data-url="${escapeAttr(url)}" ${openDisabled}>開啟</button>
          <button type="button" class="btn" data-action="market-copy" data-url="${escapeAttr(url)}" ${copyDisabled}>複製連結</button>
        </div>
        <div class="market-link-edit-actions">
          <button type="button" class="btn" data-action="market-edit" data-key="${safeKey}">編輯</button>
          <button type="button" class="btn danger" data-action="market-delete" data-key="${safeKey}">刪除</button>
        </div>
      </div>
    `;
    return div;
  }

  function renderMarketHub(){
    const container = document.getElementById('market-hub-body');
    if(!container) return;
    const links = ensureMarketLinks();
    container.innerHTML = '';
    links.forEach((item, index) => {
      container.appendChild(buildMarketLinkCard(item, index));
    });
  }

  function openMarketLink(url){
    const targetUrl = String(url || '').trim();
    if(!targetUrl){
      showBackupStatus('此入口尚未設定網址', true);
      return false;
    }
    const opened = window.open(targetUrl, '_blank', 'noopener');
    if(!opened){
      showBackupStatus('瀏覽器封鎖了新分頁，請允許彈出視窗', true);
      return false;
    }
    return true;
  }

  async function copyAllMarketLinks(){
    const links = ensureMarketLinks().filter(item => item.url);
    if(!links.length){
      showBackupStatus('目前沒有可複製的連結', true);
      return;
    }
    const text = links.map((item, index) => `${index + 1}. ${item.title}\n${item.url}`).join('\n\n');
    const copied = await copyTextToClipboard(text);
    showBackupStatus(copied ? '已複製全部連結' : '複製全部連結失敗', !copied);
  }

  function openAllMarketLinks(){
    const links = ensureMarketLinks().filter(item => item.url);
    if(!links.length){
      showBackupStatus('目前沒有可開啟的連結', true);
      return;
    }
    let openedCount = 0;
    links.forEach(item => {
      if(openMarketLink(item.url)) openedCount += 1;
    });
    if(openedCount){
      showBackupStatus(`已嘗試開啟 ${openedCount} 個入口`);
    }
  }

  let _marketEditingKey = null;

  function isValidMarketLinkUrl(url){
    const value = String(url || '').trim();
    if(!value) return true;
    try{
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:';
    }catch(e){
      return false;
    }
  }

  function openMarketLinkDialog(item = null){
    const dlg = document.getElementById('dlg-market-link');
    if(!dlg) return;
    _marketEditingKey = item?.key || null;
    document.getElementById('dlg-market-link-title').textContent = item ? '編輯看盤入口' : '新增看盤入口';
    document.getElementById('market-link-title').value = item?.title || '';
    document.getElementById('market-link-url').value = item?.url || '';
    document.getElementById('market-link-note').value = item?.note || '';
    document.getElementById('market-link-type').value = normalizeMarketLinkType(item?.type, item?.url);
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', async () => {
      if(dlg.returnValue !== 'ok') return;
      const title = document.getElementById('market-link-title').value.trim();
      const url = document.getElementById('market-link-url').value.trim();
      const note = document.getElementById('market-link-note').value.trim();
      const type = document.getElementById('market-link-type').value === 'cloud' ? 'cloud' : 'local';
      if(!title){
        alert('請輸入看盤入口標題');
        return;
      }
      if(!isValidMarketLinkUrl(url)){
        alert('網址需以 http:// 或 https:// 開頭');
        return;
      }
      const links = ensureMarketLinks();
      const payload = normalizeMarketLinkItem({
        key: _marketEditingKey || `custom-${uid()}`,
        title,
        url,
        note,
        type
      });
      const index = links.findIndex(link => link.key === payload.key);
      if(index >= 0){
        links[index] = { ...links[index], ...payload };
      }else{
        links.push(payload);
      }
      DB.meta.marketLinks = links;
      await saveDB();
      renderMarketHub();
      showBackupStatus(_marketEditingKey ? '已更新看盤入口' : '已新增看盤入口');
      _marketEditingKey = null;
    }, { once: true });
  }

  async function deleteMarketLinkByKey(key){
    const targetKey = String(key || '');
    if(!targetKey) return;
    const links = ensureMarketLinks();
    const item = links.find(link => link.key === targetKey);
    if(!item) return;
    if(!confirm(`確定刪除「${item.title || '未命名入口'}」？`)) return;
    DB.meta.marketLinks = links.filter(link => link.key !== targetKey);
    await saveDB();
    renderMarketHub();
    showBackupStatus('已刪除看盤入口');
  }
