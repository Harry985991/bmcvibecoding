# 🎨 BMC Vibe Coding Workshop

> 人人都能用 AI 寫程式 - BMC Vibe Coding 工作坊網站

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-success)](https://harry985991.github.io/bmcvibecoding/pages/bmc-workshop.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 📖 關於專案

這是為 BMC Vibe Coding Workshop 打造的互動式網站，介紹 Vibe Coding 的概念並展示學員作品。

**Vibe Coding** 是由前 Tesla AI 總監 Andrej Karpathy 提出的全新開發哲學 - 只要告訴 AI 你的想法，就能生成程式、網站，甚至是 App！

## ✨ 主要特色

- 🎯 **Main 頁面**：Vibe Coding 概念介紹 + YouTube 影片（自動播放、循環）
- 🎨 **Showcase 頁面**：作品展示（5 大分類）
  - 🌟 ALL（全部作品）
  - 📊 資料轉換
  - 📈 報表儀表板
  - ✅ 生產力工具
  - 🎮 其他創意專案
- 📌 **固定導航欄**：滾動時 Banner 始終置頂
- 💜 **魔法游標**：粉紫色圓點 + 彩色粒子特效
- 📱 **響應式設計**：完美支援手機、平板、電腦
- 🎭 **平滑動畫**：優雅的頁面切換和互動效果

## 🚀 線上瀏覽

**正式網址：** https://harry985991.github.io/bmcvibecoding/pages/bmc-workshop.html

## 💻 本地開發

### 預覽網站

```bash
# 啟動本地伺服器
cd /Users/harrychao/Documents/VibeCoding
python3 -m http.server 8000

# 在瀏覽器開啟
open http://localhost:8000/pages/bmc-workshop.html
```

### 推送更新

```bash
# 添加檔案
git add .

# 提交變更（請寫清楚的說明）
git commit -m "feat: 添加新功能描述"

# 推送到 GitHub
git push origin main
```

## 📋 版本歷程

查看 [CHANGELOG.md](CHANGELOG.md) 了解詳細的更新記錄。

### 最新更新（v1.2.0）

- 📌 導航 Banner 固定置頂
- 🌟 新增 ALL 標籤顯示所有作品
- 📏 優化 Showcase 版面間距
- 🔄 每次點選 Showcase 自動重置到 ALL
- 🎨 介面簡化，移除多餘標題文字

## 🎨 設計特色

### 色彩系統
- **主色調**：紫色漸變 (#9D4EDD → #C77DFF)
- **強調色**：橘粉漸變 (#FF6B35 → #FFB088)
- **背景**：淡紫漸變 (#E8E3F3 → #FFF5F0)

### 互動效果
- 粉紫色自訂游標（20px，點擊變 32px）
- 彩色魔法粒子（粉紫、粉橘、粉黃）
- 平滑的頁面切換動畫
- Hover 效果與視覺回饋

## 📁 專案結構

```
VibeCoding/
├── pages/
│   └── bmc-workshop.html    # 主要網頁
├── CHANGELOG.md             # 更新日誌
├── README.md                # 專案說明
└── LICENSE                  # 授權文件
```

## 🛠️ 技術棧

- **HTML5**：語義化標籤
- **CSS3**：Flexbox、Grid、動畫
- **JavaScript (ES6)**：DOM 操作、事件處理
- **YouTube Embed API**：影片嵌入

## 📝 開發規範

### Commit Message 格式

```
<type>: <subject>

範例：
feat: 新增 Showcase 分類系統
fix: 修復游標對齊問題
style: 調整導航選單樣式
docs: 更新 README 文件
```

### 類型說明
- `feat`: 新功能
- `fix`: 修復 bug
- `style`: 樣式調整
- `refactor`: 重構
- `docs`: 文件更新
- `perf`: 性能優化

## 🤝 貢獻

歡迎提交 Issue 或 Pull Request！

## 📄 授權

本專案採用 MIT 授權 - 詳見 [LICENSE](LICENSE) 文件

## 👨‍💻 作者

**Harry Chao** - [GitHub](https://github.com/Harry985991)

## 🙏 致謝

- [Everyone Can Build](https://everyonecanbuild.org) - Vibe Coding 社群
- Andrej Karpathy - Vibe Coding 概念創始人

---

**✨ 用 AI 寫程式，讓創意成真！**
