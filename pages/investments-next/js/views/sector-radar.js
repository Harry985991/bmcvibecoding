(() => {
  'use strict';

  // 族群分頁嵌原儀表板整頁，不重畫清單或圖。
  // 優先走投資紀錄同一台 8901；備援為 proxy 靜態路徑與原 :5602。
  const SOURCES = [
    '/sector-radar-dashboard/',
    'http://127.0.0.1:3000/sector-radar-dashboard/',
    'http://127.0.0.1:5602/'
  ];

  const state = { sourceIndex: 0 };

  const $ = (id) => document.getElementById(id);

  function currentTheme() {
    const theme = document.documentElement.dataset.theme;
    return (theme === 'dark' || theme === 'brutal') ? theme : 'light';
  }

  function withCacheBust(url) {
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}embed=1&theme=${encodeURIComponent(currentTheme())}&t=${Date.now()}`;
  }

  function setStatus(text) {
    const el = $('sector-radar-embed-status');
    if (el) el.textContent = text || '';
  }

  async function firstReachableSource() {
    for (let i = 0; i < SOURCES.length; i += 1) {
      try {
        const res = await fetch(SOURCES[i], { cache: 'no-store' });
        if (res.ok) {
          state.sourceIndex = i;
          return SOURCES[i];
        }
      } catch {
        // 試下一個來源
      }
    }
    return '';
  }

  async function load() {
    const frame = $('sector-radar-frame');
    if (!frame) return;
    setStatus('載入原儀表板…');
    const source = await firstReachableSource();
    if (!source) {
      frame.removeAttribute('src');
      setStatus('原儀表板載入失敗。請另開原頁，或確認本機 8901／3000／5602 有在跑。');
      return;
    }
    frame.src = withCacheBust(source);
  }

  function bind() {
    $('sector-radar-refresh')?.addEventListener('click', () => {
      load();
    });
    $('sector-radar-frame')?.addEventListener('load', () => {
      const frame = $('sector-radar-frame');
      if (frame?.src && frame.src !== 'about:blank') setStatus('');
    });
  }

  window.renderSectorRadar = function renderSectorRadar() {
    const frame = $('sector-radar-frame');
    if (!frame) return;
    if (!frame.src || frame.src === 'about:blank') load();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
