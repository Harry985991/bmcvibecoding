# BMC Vibe Coding Workshop 更新日誌

所有重要的變更都會記錄在這個檔案中。

## [未發布]

### 新增
- ✨ Main 頁面嵌入 YouTube 介紹影片 (https://youtu.be/GJtEJczA-9U)
  - 支援自動播放、靜音、循環播放
- 🎨 頂部導航選單加入淡紫色背景高亮效果
- 📊 Showcase 頁面新增「ALL」標籤，顯示所有作品
- 🎴 **Showcase 卡片全面改版為圖片卡片樣式**
  - 卡片改為全圖片背景
  - 右下角白字顯示專案名稱
  - 漸層半透明遮罩效果
  - Hover 懸停放大動畫
- 🎭 **新增浮動視窗互動功能**
  - 點擊卡片開啟詳細資訊視窗
  - 顯示專案截圖、介紹、分享者
  - 三個連結按鈕：影片🎥、Demo🚀、文字📝
  - 支援 ESC 鍵和背景點擊關閉
- 📊 Showcase 頁面重新設計，包含 5 個分類：
  - ALL（全部作品，共 10 個）
  - 資料轉換（2 個作品）
  - 報表儀表板（2 個作品）
  - 生產力工具（3 個作品）
  - 其他（3 個作品）
- 🎯 **首個實際案例：會議 Agenda 網頁**
  - 分享者：Harry Chao
  - 包含完整影片教學、Demo 連結、文字說明
- 💜 自訂粉紫色圓點游標，帶魔法粒子特效
- 📌 導航 Banner 固定置頂，滾動時不會消失

### 修復
- 🎯 修正自訂游標圓點與鼠標指針的對齊問題
- 🔧 修正 Showcase 頁面滾動時 Banner 被遮擋的問題

### 改進
- 🎨 移除 Showcase 頁面「Vibe Coding in BMC」標題，讓介面更簡潔
- 🎨 移除 Main 頁面「一句話，一個網站」副標題
- ♻️ 重構頁面架構：Main 頁面無標籤選單，Showcase 頁面獨立分類系統
- 📏 縮短 Showcase 標籤與 Banner 間距（60px → 20px）
- 🎯 每次點選 Showcase 都自動重置到 ALL 標籤
- 🖼️ 建立專案圖片資料夾結構 `assets/images/VibeCodingworkshop/`
- 📱 優化響應式設計，手機/平板/電腦都能完美顯示

### 技術細節
- 使用 YouTube iframe 嵌入影片，實作自動播放和循環功能
- 實作頁面切換時的導航高亮功能
- CSS `position: fixed` 實現固定導航欄
- JavaScript 動態生成浮動視窗內容
- 圖片載入失敗自動顯示 emoji 佔位圖
- JavaScript 自動切換標籤邏輯優化
- CSS 動畫優化，提升使用者體驗

---

## [1.0.0] - 2024-12-19

### 新增
- 🎉 BMC Vibe Coding Workshop 網站首次發布
- 📄 Main 頁面：Vibe Coding 介紹
- 🎨 Showcase 頁面：作品展示系統
- 🎯 Hand-on 頁面（規劃中）
- 🌐 部署到 GitHub Pages

### 特色功能
- EveryOne Can Build 品牌設計
- 漸變色標題和標語
- 平滑滾動和動畫效果
- 完整的響應式設計

---

## 版本號規則

遵循 [語義化版本](https://semver.org/lang/zh-TW/) 規範：

- **主版號 (MAJOR)**：重大更新，可能不向下兼容
- **次版號 (MINOR)**：新增功能，向下兼容
- **修訂號 (PATCH)**：錯誤修復，向下兼容

範例：v1.2.3
- 1 = 主版號
- 2 = 次版號
- 3 = 修訂號

