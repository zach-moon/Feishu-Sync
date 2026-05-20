/**
 * Daily report script — compares today's snapshot with yesterday's
 * and sends a summary to a Feishu group chat.
 *
 * Usage: npx tsx src/daily-report.ts
 */
import { execSync } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSnapshot, getPreviousSnapshotDate, type SnapshotEntry } from './snapshot.js';

// Load .env (Windows-safe ESM __dirname)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

const CHAT_ID = process.env.FEISHU_CHAT_ID || '';

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

interface DailyDiff {
  newlyCompleted: Array<{ specId: string; title: string }>;
  newlyInProgress: Array<{ specId: string; title: string }>;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  specStats: Array<{ specId: string; done: number; total: number }>;
}

function computeDailyDiff(today: SnapshotEntry[], yesterday: SnapshotEntry[] | null): DailyDiff {
  // Build yesterday's status map
  const yesterdayMap = new Map<string, string>();
  if (yesterday) {
    for (const entry of yesterday) {
      yesterdayMap.set(`${entry.specId}::${entry.title}`, entry.status);
    }
  }

  const newlyCompleted: Array<{ specId: string; title: string }> = [];
  const newlyInProgress: Array<{ specId: string; title: string }> = [];
  let completedTasks = 0;
  let inProgressTasks = 0;

  // Per-spec stats
  const specMap = new Map<string, { done: number; total: number }>();

  for (const entry of today) {
    const key = `${entry.specId}::${entry.title}`;
    const prevStatus = yesterdayMap.get(key);

    if (entry.status === 'done') completedTasks++;
    if (entry.status === 'in_progress') inProgressTasks++;

    // Newly completed (was not done yesterday)
    if (entry.status === 'done' && prevStatus !== 'done') {
      newlyCompleted.push({ specId: entry.specId, title: entry.title });
    }

    // Newly in progress (was not_started yesterday)
    if (entry.status === 'in_progress' && prevStatus === 'not_started') {
      newlyInProgress.push({ specId: entry.specId, title: entry.title });
    }

    // Spec stats
    const spec = specMap.get(entry.specId) ?? { done: 0, total: 0 };
    spec.total++;
    if (entry.status === 'done') spec.done++;
    specMap.set(entry.specId, spec);
  }

  const specStats = [...specMap.entries()]
    .map(([specId, s]) => ({ specId, ...s }))
    .sort((a, b) => (b.done / b.total) - (a.done / a.total));

  return {
    newlyCompleted,
    newlyInProgress,
    totalTasks: today.length,
    completedTasks,
    inProgressTasks,
    specStats,
  };
}

function formatReport(diff: DailyDiff, today: string): string {
  const lines: string[] = [];
  const pct = diff.totalTasks > 0 ? ((diff.completedTasks / diff.totalTasks) * 100).toFixed(1) : '0';

  lines.push(`📊 FeiSync 日报 (${today})`);
  lines.push('');

  if (diff.newlyCompleted.length > 0) {
    lines.push(`✅ 今日完成 (${diff.newlyCompleted.length}):`);
    for (const t of diff.newlyCompleted.slice(0, 20)) {
      lines.push(`  • ${t.specId}: ${t.title}`);
    }
    if (diff.newlyCompleted.length > 20) {
      lines.push(`  ... 还有 ${diff.newlyCompleted.length - 20} 项`);
    }
    lines.push('');
  }

  if (diff.newlyInProgress.length > 0) {
    lines.push(`🔄 今日开始 (${diff.newlyInProgress.length}):`);
    for (const t of diff.newlyInProgress.slice(0, 10)) {
      lines.push(`  • ${t.specId}: ${t.title}`);
    }
    if (diff.newlyInProgress.length > 10) {
      lines.push(`  ... 还有 ${diff.newlyInProgress.length - 10} 项`);
    }
    lines.push('');
  }

  if (diff.newlyCompleted.length === 0 && diff.newlyInProgress.length === 0) {
    lines.push('📝 今日无变化');
    lines.push('');
  }

  lines.push(`📈 整体进度: ${diff.completedTasks}/${diff.totalTasks} (${pct}%)`);
  lines.push(`   进行中: ${diff.inProgressTasks}`);
  lines.push('');

  lines.push('📋 各模块进度:');
  for (const s of diff.specStats) {
    const specPct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    const bar = specPct === 100 ? '✅' : specPct > 0 ? '🔶' : '⬜';
    lines.push(`  ${bar} ${s.specId.padEnd(30)} ${s.done}/${s.total} (${specPct}%)`);
  }

  return lines.join('\n');
}

function sendToFeishu(text: string, chatId: string): void {
  const msgContent = JSON.stringify({ text });
  const escaped = msgContent.replace(/'/g, "'\\''");
  try {
    execSync(
      `lark-cli im +messages-send --chat-id ${chatId} --msg-type text --content '${escaped}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 },
    );
    console.log('[feisync] Daily report sent to Feishu group');
  } catch (err: unknown) {
    const stderr = (err as any)?.stderr?.toString() ?? '';
    console.error(`[feisync] Failed to send report: ${stderr.slice(0, 200)}`);
  }
}

// Main
const today = getToday();
const todaySnapshot = loadSnapshot(today);

if (!todaySnapshot) {
  console.log('[feisync] No snapshot for today. Run sync first.');
  process.exit(0);
}

const prevDate = getPreviousSnapshotDate(today);
const yesterdaySnapshot = prevDate ? loadSnapshot(prevDate) : null;

const diff = computeDailyDiff(todaySnapshot, yesterdaySnapshot);
const report = formatReport(diff, today);

console.log(report);

if (CHAT_ID) {
  sendToFeishu(report, CHAT_ID);
} else {
  console.log('\n[feisync] FEISHU_CHAT_ID not set, skipping send. Add it to .env to enable.');
}
