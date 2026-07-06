# investments-next — 投資儀表板（新版）

> 2026-06-12 由 `pages/investments/` 完整 fork 後升級。**舊版完全未動**，隨時可退回。
> 計畫文件：`plans/2026-06-12-investments-dashboard-optimization.md`

## 定位

把「記錄導向」頁面升級為「決策導向」儀表板，支援 Harry 每日決策流程
（前一日收盤 + 美股關鍵數字 → 貼給 Buffett 要建議），並每日封存全頁數據供跨日分析。

## 與舊版的關係

| 項目 | 說明 |
|---|---|
| 資料 | 與舊版**共用同一份** db.json / IndexedDB / localStorage（單一真相） |
| UI 偏好 | 新版獨立，localStorage key 加 `next.` 前綴（視角、子頁籤記憶） |
| 退回方式 | 直接改開舊版 `pages/investments/index.html` 即可，無需任何還原動作 |
| 代理伺服器 | 同一個（`npm start`，localhost:3000） |

## meta.* 鐵律（重要）

舊版 `db.js` 存檔時會**丟棄未知的頂層欄位**、但放行整個 `meta` 物件。
因此新版所有新欄位一律放在 `meta.*` 底下，新舊版交替使用也不會遺失：

- `meta.tierTargets` — 分層配置目標（core/satellite/flex/cash/tolerance）
- `meta.cashFloorPct` — 現金安全線（% 總資產）
- `meta.decisionPackages` — 每日 Buffett 決策資料包（date → {markdown, sources, createdAt}）
- `meta.tradeJournals` — 每日預約單與成交結果（date → order[]），成交後單向連到 `txns` 的 `linkedTxnId`
- `meta.dailyArchive` — 每日全頁封存（date → {kpi, holdings, tierAlloc, cashGov, dividend, txnStats}）

**日後在新版加任何欄位，都必須放 meta.* 底下。**

## 新增功能總覽

- **首頁**：今日行動面板（停損停利/月線/配置偏差/現金安全線/預約單彙總，可點擊跳轉）、
  KPI 三組分群（資產/報酬/風險含最大回撤）、分層配置子彈圖（vs 目標 75/15/5/5 ±5%）、現金水位計（安全線 5%）
- **持股**：雙視角切換（損益/策略/全部欄位）、近 5 日 sparkline、停損停利距離
- **報酬**：總報酬＋週期報酬合併為子頁籤、新增資產回撤圖（啟用原 dormant 的 renderDrawdownChart）
- **交易**：評分×報酬散點圖、評分區間勝率長條、紀律遵循率
- **股息**：年度配息進度條
- **工具**：筆記/看盤/決策紀錄/歷史分析/設定 收為子頁籤
- **交易日誌**：每日預約單與結果保存；支援手動維護、JSON 匯入，以及本機 API 讓 Codex / Claude Code 直接掛單；成交後可單向產生正式異動紀錄
- **決策資料包**：一鍵組裝持倉+前一交易日OHLCV（proxy /quote TWSE MIS）+現金+預約單+vnext(:5050) 數字，
  自動存入決策紀錄；:5050 未啟動時輸出空白模板不報錯
- **每日封存**：報價更新成功後自動封存各頁計算結果（同日蓋舊）；歷史分析頁可兩日比較、看趨勢、匯出 JSON/CSV
- **三主題切換（2026-06-13）**：右上角按鈕循環切換 淺色 → 深色 → Brutal，偏好存 `localStorage['next.theme']`；
  首次依系統偏好；切換時整頁 reload 讓 Highcharts 重繪。
  淺色＝專業財務（海軍藍＋冷灰）、深色＝金融終端機深藍、Brutal＝Neo-Brutalist（米白底＋粗黑框＋硬陰影＋高飽和色塊）

## 新增檔案

```
js/charts/sparkline.js / bullet.js / cash-gauge.js   — 原生 SVG/HTML 微圖表
js/views/action-panel.js                              — 今日行動面板 + 分層目標 dialog
js/views/decision-package.js                          — 決策資料包（產生/存檔/查詢）
js/views/trade-journal.js                             — 每日預約單、成交結果、JSON 匯入、成交轉交易
js/views/analysis.js                                  — 歷史分析（比較/趨勢/匯出）
js/archive.js                                         — 每日全頁封存引擎
js/theme.js                                           — 深淺色主題切換 + Highcharts 深色 + 表格捲動提示
```

## 交易日誌匯入契約

Codex / Claude Code 可用本機 API 直接掛預約單：

```bash
curl -X POST http://localhost:3000/api/trade-journals/import \
  -H 'Content-Type: application/json' \
  -d '{
    "date": "2026-06-14",
    "source": "codex",
    "sourceText": "原始 Battle Plan 或預約單文字",
    "orders": [
      {
        "symbol": "0052",
        "side": "buy",
        "plannedPrice": 180.5,
        "plannedQty": 100,
        "condition": "評分 >= +3",
        "strategyNote": "符合今日主策略"
      }
    ]
  }'
```

同一份 JSON 也可在工具頁 `交易日誌` 用「匯入 JSON」手動匯入。第一版只支援 `planned / filled / expired / cancelled`；數量一律用股數。若匯入或手動編輯為 `filled`，系統會在找到對應持股標的時單向新增一筆 `txns`，並把交易日誌的 `linkedTxnId` 回填；已連結後不做雙向同步。

## 風格系統（2026-06-12 重整）

- 所有顏色集中在 `style.css` 開頭的 `:root`（淺色）與 `html[data-theme="dark"]`（深色）兩個 token 區塊
- 狀態色一律用三件組 token：`--tint-{ok|warn|err|info}-{bg|line|text}`，不要再寫死 hex
- 實心按鈕底色用 `--brand-strong` / `--danger-strong` / `--ok-strong`（深色模式下與文字色分離）
- Brutal 主題（`html[data-theme="brutal"]`）除 token 外另有元件覆寫區（粗框/硬陰影/直角），新增元件時記得三主題都檢查
- 數字字體改用 Inter + `tabular-nums`（已移除 Fira Code）

## 已知限制

- 純前端：當天沒開頁面就不會自動封存（瀏覽器關閉無法排程）
- 決策資料包的 OHLCV 走 proxy `/quote`（TWSE MIS）：盤後查詢即為當日完整開高低收量；
  Yahoo fallback 路徑缺高低與量，該欄顯示「待補」
- vnext 數字以原始 JSON 附入資料包（欄位名稱以 trading-dashboard 為準），抓不到時留手動模板

## 第一期優化（2026-07-07，P0 四項）

計畫文件：`plans/2026-07-07-investments-next-phase1-p0.md`（workspace root）

- **Highcharts / 字體本地化**：Highcharts 鎖定 11.4.8 存於 `js/vendor/`（含 treemap module，index.html 靜態載入）；
  Inter 改用本地可變字體 `fonts/inter/`（latin subset，wght 400–800）。CDN 僅留作動態載入器的備援候選。
- **今日行動置頂**：首頁最上方新增 `#action-panel` 容器，`renderActionPanel`（原休眠）接入
  fullRender / 首頁 tab click / refreshPortfolioViews(overview) / refreshActiveViews 四個渲染入口。
- **資料層單一真相**：`loadDB` 改以伺服器（`/api/load-db` → `/data/db.json`）為權威，
  移除舊的三源「擇優排序」啟發式；本機 IndexedDB / localStorage 降為快取，
  只用 `mergePerformanceHistory` 補回 additive 的 snapshots / dailyArchive。
  伺服器讀不到 → 離線模式常駐警示；`saveDB` 同步失敗 → 顯著警示（不再靜默）。
- **分頁互鎖**：`navigator.locks`（fallback：localStorage heartbeat）確保同時只有一個分頁可寫，
  後開分頁進唯讀模式（saveDB 早退 + 頂部紅色橫幅 + 資料健康面板列示）。
  限制：不涵蓋舊版 `pages/investments/`（鐵律不動舊版），習慣上請只開一版。
- **存檔後部分重繪**：`persistAndRefresh` 不再 `fullRender()` 全量重繪，
  改走 `refreshActiveViews()`（header + 目前頁籤）；隱藏頁由既有的切頁重算機制補上；
  報酬「總報酬」子頁切入時補繪回撤圖。

改動前的 db.json 備份：`data/backups/db-pre-phase1-20260707.json`
