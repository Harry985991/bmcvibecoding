'use strict';

// 決策流程參考（唯讀）：最新 battle-plan 標題 + CFO / Buffett work-log 最後一則摘要。
// 由 tools/portfolio-observatory/data_sources.fetch_decision_flow 移植。
// 僅供對照，不取代 battle-plan 裁決；任何來源讀不到都只回報該項錯誤，不影響其他項。

const fs = require('fs');
const path = require('path');

const BATTLE_PLAN_RE = /^battle-plan-2\d{3}-\d{2}-\d{2}\.html$/;
const TAIL_MAX_CHARS = 600;

function stripTags(text) {
  return String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** 取 markdown 最後一個標題區塊，截斷到 600 字。 */
function lastEntry(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const blocks = trimmed.split(/\n(?=#{1,3} )/);
  const tail = blocks.length ? blocks[blocks.length - 1] : trimmed;
  return tail.trim().slice(0, TAIL_MAX_CHARS);
}

/**
 * @param {object} deps
 * @param {string} deps.battlePlanDir
 * @param {string} deps.workLogDir
 */
function createDecisionFlow({ battlePlanDir, workLogDir }) {
  function getDecisionFlow() {
    const out = { fetched_at: new Date().toISOString() };

    try {
      const plans = fs.existsSync(battlePlanDir)
        ? fs.readdirSync(battlePlanDir).filter((name) => BATTLE_PLAN_RE.test(name)).sort()
        : [];
      if (plans.length) {
        const latest = plans[plans.length - 1];
        const html = fs.readFileSync(path.join(battlePlanDir, latest), 'utf8');
        const title = html.match(/<title>([\s\S]*?)<\/title>/);
        const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
        out.battle_plan = {
          file: latest,
          title: title ? stripTags(title[1]) : latest.replace(/\.html$/, ''),
          headline: h1 ? stripTags(h1[1]) : null
        };
      }
    } catch (error) {
      out.battle_plan_error = error.message;
    }

    for (const who of ['cfo', 'buffett']) {
      try {
        const filePath = path.join(workLogDir, `work-log-${who}.md`);
        if (fs.existsSync(filePath)) {
          out[`${who}_tail`] = lastEntry(fs.readFileSync(filePath, 'utf8'));
        }
      } catch (error) {
        out[`${who}_error`] = error.message;
      }
    }

    return out;
  }

  return { getDecisionFlow };
}

module.exports = { createDecisionFlow, __test: { lastEntry, stripTags } };
