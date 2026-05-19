import { readFileSync } from 'node:fs';
import type { Config } from './config.js';
import type { NormalizedRow, RawRecord, DiffResult } from './types.js';
import { scanSpecs } from './scanner.js';
import { parseTasksFile } from './parser.js';
import { normalize } from './normalizer.js';
import { toCsvRows, writeCsv } from './csvWriter.js';
import { computeDiff } from './diff.js';
import { FeishuClient } from './feishu.client.js';
import type { CreateRecord, UpdateRecord } from './feishu.client.js';
import * as reporter from './reporter.js';

const STATUS_MAP: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  removed: '已移除',
};

function toFeishuFields(row: NormalizedRow, commitSha: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    '文本': row.specId,
    'title': row.type === 'task' ? (row as any).displayTitle : row.title,
    'description': row.type === 'task' ? (row as any).description ?? '' : '',
    'status': STATUS_MAP[row.status] ?? row.status,
    'commitShaShort': commitSha,
    'time': new Date().toISOString().split('T')[0],
    'primaryOwner': row.type === 'task' ? (row as any).primaryOwner ?? '' : '',
    'backupOwner': row.type === 'task' ? (row as any).backupOwner ?? '' : '',
  };
  return fields;
}

export async function runSync(config: Config): Promise<number> {
  // 1. Report context
  reporter.reportContext(config);

  // 2. Scan specs
  const scanResult = scanSpecs(config.repoRoot, config.specsPath);

  // 3. Parse each tasks.md
  const parsedTasks = new Map<string, any[]>();
  let totalTasks = 0;
  let doneCount = 0;

  for (const spec of scanResult.specs) {
    if (spec.path) {
      try {
        const text = readFileSync(spec.path, 'utf-8');
        const tasks = parseTasksFile(text);
        parsedTasks.set(spec.specId, tasks);
        totalTasks += tasks.length;
        doneCount += tasks.filter(t => t.status === 'done').length;
      } catch (err) {
        console.warn(`[WARN] Failed to parse ${spec.path}: ${reporter.redactError(err)}`);
        parsedTasks.set(spec.specId, []);
      }
    } else {
      parsedTasks.set(spec.specId, []);
    }
  }

  reporter.reportScan(scanResult, totalTasks, doneCount);
  reporter.reportIgnored(scanResult.ignored);

  // 4. Normalize
  let specRows, taskRows;
  try {
    const result = normalize({ specs: scanResult.specs, parsedTasks, config });
    specRows = result.specRows;
    taskRows = result.taskRows;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'DuplicateUniqueIdError') {
      process.stderr.write(`[feisync] ${err.message}\n`);
      reporter.reportConclusion('FAILED');
      return 1;
    }
    throw err;
  }

  // 5. CSV output (optional, non-blocking)
  if (config.csvOutputPath) {
    const csvRows = toCsvRows(specRows, taskRows);
    const csvResult = await writeCsv(config.csvOutputPath, csvRows);
    if (csvResult.ok) {
      console.log(`[feisync] CSV written: ${config.csvOutputPath} (${csvResult.rowCount} rows)`);
    } else {
      console.warn(`[WARN] CSV write failed: ${csvResult.reason}`);
    }
  }

  // 6. Fetch existing records from Feishu (skip in dry-run if connection fails)
  const feishu = new FeishuClient();

  // Ensure all required fields exist in the table
  try {
    await feishu.ensureFields(config.feishuAppToken, config.feishuTableId);
  } catch (err) {
    console.warn(`[WARN] ensureFields failed: ${reporter.redactError(err)}`);
  }
  let existingRecords: Map<string, RawRecord>;
  try {
    const rawRecords = await feishu.listAllRecords(config.feishuAppToken, config.feishuTableId);
    existingRecords = new Map();
    for (const r of rawRecords) {
      // Match by SpecID + title combination as the upsert key
      const specId = r.fields['文本'] as string | undefined;
      const title = r.fields['title'] as string | undefined;
      if (specId && title) {
        const key = `${specId}::${title}`;
        existingRecords.set(key, r);
      }
    }
  } catch (err) {
    if (config.dryRun) {
      console.warn(`[WARN] Feishu list failed in dry-run mode, treating as empty table: ${reporter.redactError(err)}`);
      existingRecords = new Map();
    } else {
      process.stderr.write(`[feisync] Failed to list Feishu records: ${reporter.redactError(err)}\n`);
      reporter.reportConclusion('FAILED');
      return 1;
    }
  }

  // 7. Compute diff (only task rows, no spec rows in Feishu table)
  const allCurrentRows: NormalizedRow[] = [...taskRows];
  const diff = computeDiff(allCurrentRows, existingRecords);
  reporter.reportDiff(diff, config.removedProtectionThreshold);

  // 8. Removed protection check
  if (diff.removedRatio >= config.removedProtectionThreshold && !config.forceSync) {
    reporter.reportAbortedProtection(diff);
    reporter.reportConclusion('ABORTED_PROTECTION');
    return 1;
  }

  // 9. Dry-run check
  if (config.dryRun) {
    reporter.reportDryRun(diff);
    reporter.reportConclusion('DRY_RUN');
    return 0;
  }

  // 10. Write to Feishu — only task rows, no spec rows
  let failed = 0;
  let taskCreated = 0, taskUpdated = 0;
  let softRemoved = 0;

  const tasksToCreate = diff.created.filter(r => r.type === 'task');
  const tasksToUpdate = diff.updated.filter(r => r.type === 'task');

  if (tasksToCreate.length > 0) {
    try {
      const records: CreateRecord[] = tasksToCreate.map(r => ({ fields: toFeishuFields(r, config.commitSha) }));
      await feishu.batchCreate(config.feishuAppToken, config.feishuTableId, records);
      taskCreated = tasksToCreate.length;
    } catch (err) {
      console.error(`[feisync] Task create failed: ${reporter.redactError(err)}`);
      failed += tasksToCreate.length;
    }
  }

  if (tasksToUpdate.length > 0) {
    try {
      const records: UpdateRecord[] = tasksToUpdate.map(r => ({
        record_id: r.recordId,
        fields: toFeishuFields(r, config.commitSha),
      }));
      await feishu.batchUpdate(config.feishuAppToken, config.feishuTableId, records);
      taskUpdated = tasksToUpdate.length;
    } catch (err) {
      console.error(`[feisync] Task update failed: ${reporter.redactError(err)}`);
      failed += tasksToUpdate.length;
    }
  }

  // Soft remove
  if (diff.removed.length > 0) {
    try {
      const records: UpdateRecord[] = diff.removed.map(r => ({
        record_id: r.recordId,
        fields: { 'status': '已移除' },
      }));
      await feishu.batchUpdate(config.feishuAppToken, config.feishuTableId, records);
      softRemoved = diff.removed.length;
    } catch (err) {
      console.error(`[feisync] Soft remove failed: ${reporter.redactError(err)}`);
      failed += diff.removed.length;
    }
  }

  // 11. Report results
  reporter.reportWriteResult({ specCreated: 0, specUpdated: 0, taskCreated, taskUpdated, softRemoved, failed });

  if (failed > 0) {
    reporter.reportConclusion('FAILED');
    return 1;
  }

  reporter.reportConclusion('SUCCESS');

  // Save snapshot for daily report
  try {
    const { saveSnapshot, cleanOldSnapshots } = await import('./snapshot.js');
    saveSnapshot(taskRows);
    cleanOldSnapshots();
  } catch (err) {
    console.warn(`[WARN] Failed to save snapshot: ${(err as Error).message}`);
  }

  return 0;
}
