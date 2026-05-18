import { mask } from './utils/mask.js';
import type { Config } from './config.js';
import type { ScanResult, DiffResult, IgnoredEntry } from './types.js';

const SEP = '━'.repeat(40);

export function reportContext(config: Config): void {
  console.log(SEP);
  console.log('[feisync] CI Context');
  console.log(`  mode:        ${config.mode}`);
  if (config.projectPath) console.log(`  repo:        ${config.projectPath}`);
  if (config.commitSha) console.log(`  commit:      ${config.commitSha.slice(0, 8)}`);
  if (config.pipelineId) console.log(`  pipeline:    #${config.pipelineId}`);
  if (config.jobId) console.log(`  job:         #${config.jobId}`);
  console.log(`  table:       ${mask(config.feishuTableId)}`);
  console.log(`  dry-run:     ${config.dryRun}`);
  console.log(`  force-sync:  ${config.forceSync}`);
  console.log(SEP);
}

export function reportScan(scan: ScanResult, taskCount: number, doneCount: number): void {
  console.log('[feisync] Scan Result');
  console.log(`  specs found:    ${scan.specs.length}`);
  console.log(`  tasks found:    ${taskCount}  (done: ${doneCount}, remaining: ${taskCount - doneCount})`);
  console.log(SEP);
}

export function reportIgnored(ignored: IgnoredEntry[]): void {
  if (ignored.length === 0) return;
  console.log('[feisync] Ignored Entries');
  for (const entry of ignored) {
    console.log(`  [${entry.reason}] ${entry.name}`);
  }
  console.log(SEP);
}

export function reportDiff(diff: DiffResult, threshold: number): void {
  console.log('[feisync] Diff Summary');
  console.log(`  created:        ${diff.created.length}`);
  console.log(`  updated:        ${diff.updated.length}`);
  console.log(`  removed:        ${diff.removed.length}   (ratio: ${(diff.removedRatio * 100).toFixed(1)}%, threshold: ${(threshold * 100).toFixed(0)}%)`);
  console.log(`  unchanged:      ${diff.unchanged}`);
  console.log(SEP);
}

export function reportWriteResult(result: {
  specCreated: number;
  specUpdated: number;
  taskCreated: number;
  taskUpdated: number;
  softRemoved: number;
  failed: number;
}): void {
  console.log('[feisync] Feishu Write Result');
  console.log(`  spec phase:     ok  (${result.specCreated} created, ${result.specUpdated} updated)`);
  console.log(`  task phase:     ok  (${result.taskCreated} created, ${result.taskUpdated} updated)`);
  console.log(`  soft remove:    ok  (${result.softRemoved} updated)`);
  console.log(`  failed:         ${result.failed}`);
  console.log(SEP);
}

export function reportConclusion(
  conclusion: 'SUCCESS' | 'DRY_RUN' | 'ABORTED_PROTECTION' | 'FAILED',
): void {
  console.log(`[feisync] ${conclusion}`);
}

export function reportAbortedProtection(diff: DiffResult): void {
  console.log('[feisync] ⚠️  ABORTED: Removed protection threshold exceeded');
  console.log(`  Will be removed (${diff.removed.length}):`);
  for (const r of diff.removed) {
    console.log(`    - ${r.uniqueId}`);
  }
  console.log(SEP);
}

export function reportDryRun(diff: DiffResult): void {
  console.log('[feisync] 🔍 DRY-RUN Preview');
  if (diff.created.length > 0) {
    console.log(`  Would create (${diff.created.length}):`);
    for (const r of diff.created.slice(0, 20)) {
      console.log(`    + ${r.uniqueId}`);
    }
    if (diff.created.length > 20) console.log(`    ... and ${diff.created.length - 20} more`);
  }
  if (diff.updated.length > 0) {
    console.log(`  Would update (${diff.updated.length}):`);
    for (const r of diff.updated.slice(0, 20)) {
      console.log(`    ~ ${r.uniqueId}`);
    }
    if (diff.updated.length > 20) console.log(`    ... and ${diff.updated.length - 20} more`);
  }
  if (diff.removed.length > 0) {
    console.log(`  Would remove (${diff.removed.length}):`);
    for (const r of diff.removed.slice(0, 20)) {
      console.log(`    - ${r.uniqueId}`);
    }
    if (diff.removed.length > 20) console.log(`    ... and ${diff.removed.length - 20} more`);
  }
  console.log(SEP);
}

/**
 * Strip sensitive fields from error objects before logging.
 */
export function redactError(err: unknown): string {
  if (err instanceof Error) {
    const cleaned = err.message
      .replace(/Bearer\s+\S+/gi, 'Bearer ***')
      .replace(/token['":\s]+\S+/gi, 'token: ***');
    return `${err.name}: ${cleaned}`;
  }
  return String(err);
}
