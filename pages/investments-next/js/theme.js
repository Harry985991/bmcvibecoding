/* theme.js — 主題切換（investments-next 專用）
 * 三主題循環：light（專業淺色）→ dark（金融終端機）→ brutal（Neo-Brutalist）→ light
 * - 偏好存 localStorage 'next.theme'（沿用 next. 前綴，不影響舊版）
 * - 必須在 <head> 內早於 body 渲染前執行，避免深色模式閃白
 * - 切換時整頁 reload，讓 Highcharts 以新主題重繪（圖表選項在建立時固定）
 */
(function(){
  var KEY = 'next.theme';
  var ORDER = ['light', 'dark', 'brutal'];
  var NEXT_LABEL = { light: '深色', dark: 'Brutal', brutal: '淺色' };

  function savedTheme(){
    try {
      var s = localStorage.getItem(KEY);
      if (ORDER.indexOf(s) >= 0) return s;
    } catch(e){}
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch(e){}
    return 'light';
  }

  function applyTheme(t){
    document.documentElement.dataset.theme = t;
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = NEXT_LABEL[t] || '深色';
  }

  applyTheme(savedTheme());

  window.toggleTheme = function(){
    var cur = document.documentElement.dataset.theme;
    var next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
    try { localStorage.setItem(KEY, next); } catch(e){}
    location.reload();
  };

  function setupHighchartsTheme(){
    if (!window.Highcharts) return;
    var theme = document.documentElement.dataset.theme;

    if (theme === 'dark') {
      var darkAxis = {
        labels: { style: { color: '#93A0B4' } },
        title: { style: { color: '#93A0B4' } },
        lineColor: '#25324A',
        tickColor: '#25324A',
        gridLineColor: '#1D2940'
      };
      Highcharts.setOptions({
        chart: { backgroundColor: 'transparent', style: { color: '#E7ECF4' } },
        title: { style: { color: '#E7ECF4' } },
        subtitle: { style: { color: '#93A0B4' } },
        xAxis: darkAxis,
        yAxis: darkAxis,
        legend: {
          itemStyle: { color: '#C2CCDB' },
          itemHoverStyle: { color: '#E7ECF4' },
          itemHiddenStyle: { color: '#55617A' }
        },
        tooltip: {
          backgroundColor: '#182338',
          borderColor: '#25324A',
          style: { color: '#E7ECF4' }
        },
        plotOptions: {
          series: { dataLabels: { style: { color: '#E7ECF4', textOutline: 'none' } } }
        }
      });
      return;
    }

    if (theme === 'brutal') {
      var brutalAxis = {
        labels: { style: { color: '#1A1A1A', fontWeight: '700' } },
        title: { style: { color: '#1A1A1A' } },
        lineColor: '#1A1A1A',
        lineWidth: 2,
        tickColor: '#1A1A1A',
        gridLineColor: '#D9D2C0'
      };
      Highcharts.setOptions({
        chart: { backgroundColor: 'transparent', style: { color: '#1A1A1A' } },
        title: { style: { color: '#1A1A1A', fontWeight: '800' } },
        subtitle: { style: { color: '#52504A' } },
        xAxis: brutalAxis,
        yAxis: brutalAxis,
        legend: {
          itemStyle: { color: '#1A1A1A', fontWeight: '700' },
          itemHoverStyle: { color: '#000000' },
          itemHiddenStyle: { color: '#B4B2A9' }
        },
        tooltip: {
          backgroundColor: '#FFFFFF',
          borderColor: '#1A1A1A',
          borderWidth: 2,
          borderRadius: 0,
          shadow: false,
          style: { color: '#1A1A1A' }
        },
        plotOptions: {
          series: {
            borderColor: '#1A1A1A',
            dataLabels: { style: { color: '#1A1A1A', textOutline: 'none' } }
          },
          treemap: { borderColor: '#1A1A1A', borderWidth: 3 },
          column: { borderColor: '#1A1A1A', borderWidth: 2 },
          area: { lineWidth: 3 },
          line: { lineWidth: 3 }
        }
      });
    }
  }

  /* 表格可橫向捲動提示：table-wrap 內容超寬時加 .scrollable，CSS 顯示右側漸層 */
  function updateScrollHints(){
    var wraps = document.querySelectorAll('.table-wrap');
    for (var i = 0; i < wraps.length; i++) {
      var w = wraps[i];
      if (w.scrollWidth > w.clientWidth + 2) w.classList.add('scrollable');
      else w.classList.remove('scrollable');
    }
  }
  var hintTimer = null;
  function scheduleScrollHints(){
    clearTimeout(hintTimer);
    hintTimer = setTimeout(updateScrollHints, 200);
  }

  document.addEventListener('DOMContentLoaded', function(){
    applyTheme(document.documentElement.dataset.theme);
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', window.toggleTheme);

    setupHighchartsTheme();

    window.addEventListener('resize', scheduleScrollHints);
    /* 表格內容是非同步渲染的，用 MutationObserver 偵測列數變化後重算 */
    try {
      var mo = new MutationObserver(scheduleScrollHints);
      mo.observe(document.body, { childList: true, subtree: true });
    } catch(e){}
    /* 捲到底時隱藏提示 */
    document.addEventListener('scroll', function(ev){
      var t = ev.target;
      if (t && t.classList && t.classList.contains('table-wrap')) {
        if (t.scrollLeft + t.clientWidth >= t.scrollWidth - 4) t.classList.add('scrolled-end');
        else t.classList.remove('scrolled-end');
      }
    }, true);
    scheduleScrollHints();
  });
})();
