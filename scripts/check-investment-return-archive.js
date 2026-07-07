#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_DB_PATH = path.join(ROOT_DIR, 'data', 'db.json');
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, 'data', 'output', 'investment-return-check');
const CLOSE_READY_MINUTES = 13 * 60 + 30;
const TIME_ZONE = 'Asia/Taipei';

// Keep this in sync with pages/investments-next/js/views/allocation.js.
const TWSE_MARKET_HOLIDAYS_2026 = new Set([
  '2026-01-01',
  '2026-02-12',
  '2026-02-13',
  '2026-02-15',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-27',
  '2026-04-03',
  '2026-04-04',
  '2026-04-05',
  '2026-04-06',
  '2026-05-01',
  '2026-06-19',
  '2026-09-25',
  '2026-09-28',
  '2026-10-09',
  '2026-10-10',
  '2026-10-25',
  '2026-10-26',
  '2026-12-25'
]);

function usage() {
  return `Usage: node scripts/check-investment-return-archive.js [options]

Options:
  --db <path>             db.json path. Default: data/db.json
  --out-dir <path>        Report output directory. Default: data/output/investment-return-check
  --memory <path>         Append a short automation memory note. Write failures are warnings only.
  --as-of <iso>           Override check time, for testing.
  --strict                Exit 1 when status is MISSING.
  --json                  Print JSON instead of Markdown.
  --no-report             Do not write Markdown / JSON report files.
  --help                  Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    dbPath: DEFAULT_DB_PATH,
    outDir: DEFAULT_OUT_DIR,
    memoryPath: '',
    asOf: null,
    strict: false,
    json: false,
    report: true
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') {
      args.help = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--no-report') {
      args.report = false;
    } else if (arg === '--db') {
      args.dbPath = path.resolve(argv[++i] || '');
    } else if (arg === '--out-dir') {
      args.outDir = path.resolve(argv[++i] || '');
    } else if (arg === '--memory') {
      args.memoryPath = path.resolve(argv[++i] || '');
    } else if (arg === '--as-of') {
      args.asOf = new Date(argv[++i] || '');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (args.asOf && Number.isNaN(args.asOf.getTime())) {
    throw new Error('--as-of must be a valid date/time');
  }
  return args;
}

function getTaipeiParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`,
    minutes: Number(map.hour) * 60 + Number(map.minute)
  };
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestDate(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function isAllowedTwseTradingDay(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (year === 2026 && TWSE_MARKET_HOLIDAYS_2026.has(dateStr)) return false;
  return true;
}

function collectQuoteRows(stocks) {
  return (Array.isArray(stocks) ? stocks : [])
    .map((stock) => {
      const raw = String(stock?.lastPriceAt || '').trim();
      if (!raw) return null;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return null;
      const local = getTaipeiParts(date);
      return {
        symbol: String(stock?.symbol || stock?.ticker || stock?.id || '').trim(),
        lastPriceAt: raw,
        epochMs: date.getTime(),
        localDate: local.date,
        localTime: local.time,
        localMinutes: local.minutes
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.epochMs - b.epochMs || a.symbol.localeCompare(b.symbol));
}

function analyzeDB(db, options = {}) {
  const asOf = options.asOf || new Date();
  const asOfTaipei = getTaipeiParts(asOf);
  const stocks = Array.isArray(db?.stocks) ? db.stocks : [];
  const snapshots = Array.isArray(db?.snapshots) ? db.snapshots : [];
  const archive = db?.meta?.dailyArchive && typeof db.meta.dailyArchive === 'object'
    ? db.meta.dailyArchive
    : {};
  const quoteRows = collectQuoteRows(stocks);
  const snapshotDates = snapshots.map((row) => row?.date).filter(Boolean).sort();
  const archiveDates = Object.keys(archive).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort();

  const latestQuote = quoteRows.at(-1) || null;
  const latestQuoteDate = latestQuote?.localDate || null;
  const latestQuoteRows = latestQuoteDate
    ? quoteRows.filter((row) => row.localDate === latestQuoteDate)
    : [];
  const latestQuoteMinutes = latestQuoteRows.reduce(
    (max, row) => Math.max(max, row.localMinutes),
    latestQuote?.localMinutes ?? -1
  );
  const latestQuoteTime = latestQuoteRows
    .slice()
    .sort((a, b) => b.localMinutes - a.localMinutes || a.symbol.localeCompare(b.symbol))[0]?.localTime || null;

  const latestSnapshotDate = latestDate(snapshotDates);
  const latestArchiveDate = latestDate(archiveDates);
  const snapshotHasLatestQuoteDate = latestQuoteDate ? snapshotDates.includes(latestQuoteDate) : false;
  const archiveHasLatestQuoteDate = latestQuoteDate ? archiveDates.includes(latestQuoteDate) : false;
  const isTradingDay = latestQuoteDate ? isAllowedTwseTradingDay(latestQuoteDate) : false;
  const quoteCloseReady = latestQuoteMinutes >= CLOSE_READY_MINUTES;
  const missingParts = [];
  if (latestQuoteDate && !snapshotHasLatestQuoteDate) missingParts.push('snapshot');
  if (latestQuoteDate && !archiveHasLatestQuoteDate) missingParts.push('dailyArchive');

  let status = 'OK';
  let title = '總報酬已對齊';
  let action = '不需更新。';
  let reason = '最新報價日已存在於 snapshots 與 dailyArchive。';

  if (!stocks.length) {
    status = 'BLOCKED';
    title = '缺少股票資料';
    reason = 'db.json 沒有 stocks[]，無法判斷最新報價日。';
    action = '先確認 db.json 資料來源。';
  } else if (!quoteRows.length) {
    status = 'BLOCKED';
    title = '缺少報價時間';
    reason = 'stocks[] 沒有可解析的 lastPriceAt。';
    action = '先更新報價或確認資料來源。';
  } else if (!isTradingDay) {
    status = 'OK';
    title = '最新報價日非自動封存交易日';
    reason = `${latestQuoteDate} 不在目前台股自動快照允許日內。`;
    action = '不需更新。';
  } else if (!quoteCloseReady) {
    status = 'WAIT';
    title = '總報酬尚不需補齊';
    reason = `最新報價時間 ${latestQuoteTime} 未達 13:30 收盤門檻。`;
    action = '等待收盤後的報價再檢查，避免用盤前或未完成資料封存。';
  } else if (missingParts.length > 0) {
    status = 'MISSING';
    title = '總報酬封存缺漏';
    reason = `${latestQuoteDate} 已達 13:30 門檻，但缺少 ${missingParts.join(' / ')}。`;
    action = '需用 investments-next 完整計算口徑補齊，不能用舊報價硬寫新日期。';
  }

  return {
    status,
    title,
    action,
    reason,
    updated: false,
    checkedAt: `${asOfTaipei.date} ${asOfTaipei.time} CST`,
    closeReadyThreshold: '13:30',
    latestQuote: latestQuote ? {
      iso: latestQuote.lastPriceAt,
      localDate: latestQuoteDate,
      localTime: latestQuoteTime,
      symbolsOnDate: latestQuoteRows.length,
      closeReady: quoteCloseReady,
      isTradingDay
    } : null,
    snapshots: {
      count: snapshotDates.length,
      latestDate: latestSnapshotDate,
      hasLatestQuoteDate: snapshotHasLatestQuoteDate
    },
    dailyArchive: {
      count: archiveDates.length,
      latestDate: latestArchiveDate,
      hasLatestQuoteDate: archiveHasLatestQuoteDate
    },
    missingParts,
    validation: {
      jsonParse: true
    }
  };
}

function statusLine(result) {
  return `[${result.status}] ${result.title}`;
}

function renderMarkdown(result) {
  const quote = result.latestQuote;
  const lines = [
    '# 投資總報酬每日缺漏檢查',
    '',
    '```text',
    statusLine(result),
    '',
    `檢查日        ${result.checkedAt}`,
    `最新報價      ${quote ? `${quote.localDate} ${quote.localTime}` : '無'}`,
    `Snapshot      ${result.snapshots.latestDate || '無'}`,
    `DailyArchive  ${result.dailyArchive.latestDate || '無'}`,
    `是否更新      ${result.updated ? '是' : '否'}`,
    '```',
    '',
    '| 項目 | 結果 |',
    '|---|---|',
    `| 狀態 | \`${result.status}\` |`,
    `| 最新報價日 | ${quote?.localDate || '無'} |`,
    `| 最新報價時間 | ${quote?.localTime || '無'} |`,
    `| 報價日是否交易日 | ${quote ? (quote.isTradingDay ? '是' : '否') : '無法判斷'} |`,
    `| 是否達 13:30 | ${quote ? (quote.closeReady ? '是' : '否') : '無法判斷'} |`,
    `| Snapshot 最新日 | ${result.snapshots.latestDate || '無'} |`,
    `| DailyArchive 最新日 | ${result.dailyArchive.latestDate || '無'} |`,
    `| 缺漏項目 | ${result.missingParts.length ? result.missingParts.join(', ') : '無'} |`,
    '',
    '## 判斷',
    '',
    result.reason,
    '',
    '## 建議動作',
    '',
    result.action,
    '',
    '## 驗證',
    '',
    '- [x] db.json JSON parse OK'
  ];
  return `${lines.join('\n')}\n`;
}

function writeReports(result, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const date = result.checkedAt.slice(0, 10);
  const markdown = renderMarkdown(result);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const mdPath = path.join(outDir, `${date}.md`);
  const jsonPath = path.join(outDir, `${date}.json`);
  fs.writeFileSync(mdPath, markdown, 'utf8');
  fs.writeFileSync(jsonPath, json, 'utf8');
  fs.writeFileSync(path.join(outDir, 'latest.md'), markdown, 'utf8');
  fs.writeFileSync(path.join(outDir, 'latest.json'), json, 'utf8');
  return { mdPath, jsonPath };
}

function appendMemory(result, memoryPath) {
  if (!memoryPath) return null;
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  const quote = result.latestQuote;
  const note = [
    '',
    `## ${result.checkedAt}`,
    '- Task: 投資總報酬每日缺漏檢查。',
    `- Status: [${result.status}] ${result.title}`,
    `- Latest stocks[].lastPriceAt: ${quote ? `${quote.iso} = ${quote.localDate} ${quote.localTime} Asia/Taipei` : 'none'}.`,
    `- Latest DB snapshots[].date: ${result.snapshots.latestDate || 'none'}.`,
    `- Latest DB meta.dailyArchive key: ${result.dailyArchive.latestDate || 'none'}.`,
    `- Decision: ${result.reason}`,
    '- Validation: db.json JSON parse OK.',
    ''
  ].join('\n');
  fs.appendFileSync(memoryPath, note, 'utf8');
  return memoryPath;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }

  let db;
  try {
    db = readJSON(args.dbPath);
  } catch (error) {
    const asOf = getTaipeiParts(args.asOf || new Date());
    const result = {
      status: 'BLOCKED',
      title: 'db.json 無法解析',
      action: '先修復 db.json，再重新執行檢查。',
      reason: error.message,
      updated: false,
      checkedAt: `${asOf.date} ${asOf.time} CST`,
      closeReadyThreshold: '13:30',
      latestQuote: null,
      snapshots: { count: 0, latestDate: null, hasLatestQuoteDate: false },
      dailyArchive: { count: 0, latestDate: null, hasLatestQuoteDate: false },
      missingParts: [],
      validation: { jsonParse: false }
    };
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result));
    return 2;
  }

  const result = analyzeDB(db, { asOf: args.asOf });
  const warnings = [];

  if (args.report) {
    try {
      result.report = writeReports(result, args.outDir);
    } catch (error) {
      warnings.push(`report write failed: ${error.message}`);
    }
  }

  if (args.memoryPath) {
    try {
      result.memoryPath = appendMemory(result, args.memoryPath);
    } catch (error) {
      warnings.push(`memory write failed: ${error.message}`);
    }
  }

  if (warnings.length) result.warnings = warnings;
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result));
  if (warnings.length) {
    process.stderr.write(warnings.map((warning) => `[warn] ${warning}`).join('\n') + '\n');
  }

  if (result.status === 'BLOCKED') return 2;
  if (args.strict && result.status === 'MISSING') return 1;
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`[error] ${error.message}\n`);
  process.exitCode = 2;
}
