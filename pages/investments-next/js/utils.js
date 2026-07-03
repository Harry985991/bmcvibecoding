  window.onerror = function(msg, src, line, col, err) {
    var el = document.getElementById('_init-debug-status');
    if (!el) {
      el = document.createElement('div');
      el.id = '_crash-report';
      el.style.cssText = 'position:fixed;left:12px;top:12px;z-index:999999;padding:12px 16px;border-radius:10px;font-size:13px;background:rgba(185,28,28,.95);color:#fff;max-width:80vw;word-break:break-all;font-family:monospace;white-space:pre-wrap;box-shadow:0 8px 24px rgba(0,0,0,.3)';
      document.body.appendChild(el);
    }
    el.textContent = 'JS ERROR line ' + line + ': ' + msg + (err && err.stack ? '\n' + err.stack.slice(0, 500) : '');
    el.style.display = 'block';
  };
  // ========= 基礎工具 =========
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const fmtInt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (isFinite(n)? (n*100).toFixed(2)+'%':'—');
const uid = () => Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const todayStr = () => new Date().toISOString().slice(0,10);
const localDateStr = (date = new Date()) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const nowISO = () => new Date().toISOString();
const parseN = (v) => isNaN(parseFloat(v))? 0 : parseFloat(v);
const allocationTargetDefaults = { equity: 60, bond: 40 };
const allocationTargetStorageKey = 'allocation_target_ratio';
const regionTargetDefaults = { tw: 50, global: 50 };
const regionTargetStorageKey = 'region_target_ratio';
const INIT_DEBUG_BUILD = 'INV3-20260425-2';
let allocationPlannerBase = [];
let allocationPlannerAdjustments = {};
let allocationPlannerContext = null;
  const formatIntensityBadge = (value, percent, formatter='amount') => {
    if(!Number.isFinite(value)){
      return '<span class="badge neutral">—</span>';
    }
    if(Math.abs(value) < 1e-9){
      return `<span class="badge neutral">${formatter==='percent' ? '0.0%' : '0'}</span>`;
    }
    const toneClass = value > 0 ? 'badge red-light' : value < 0 ? 'badge green-light' : 'badge neutral';
    const arrow = value >= 0 ? '▲ ' : '▼ ';
    if(formatter === 'percent'){
      return `<span class="${toneClass}">${arrow}${Math.abs(value).toFixed(1)}%</span>`;
    }
    return `<span class="${toneClass}">${arrow}${fmtInt.format(Math.round(Math.abs(value)))}</span>`;
  };

  // 預估手續費
  const estimateFee = (amount) => {
    const rate = Number(window.FEE_RATE ?? 0.001425);
    return Math.round((Math.abs(Number(amount) || 0) * rate) * 100) / 100;
  };
