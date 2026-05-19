import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { shortHash } from './utils/hash.js';
import type { ParsedTaskItem, SpecRow, TaskRow, Status } from './types.js';
import type { Config } from './config.js';

export class DuplicateUniqueIdError extends Error {
  constructor(
    public readonly uniqueId: string,
    public readonly first: { specId: string; taskNumber: string; title: string },
    public readonly second: { specId: string; taskNumber: string; title: string },
  ) {
    super(`Duplicate uniqueId "${uniqueId}"`);
    this.name = 'DuplicateUniqueIdError';
  }
}

interface NormalizeInput {
  specs: Array<{ specId: string; path: string | null }>;
  parsedTasks: Map<string, ParsedTaskItem[]>; // specId → tasks
  config: Config;
}

/**
 * Read owners.md from a spec directory and extract Primary/Backup Owner.
 */
export function readOwners(repoRoot: string, specId: string): { primaryOwner: string; backupOwner: string } {
  const ownersPath = path.join(repoRoot, '.kiro', 'specs', specId, 'owners.md');
  if (!existsSync(ownersPath)) return { primaryOwner: '', backupOwner: '' };
  try {
    const content = readFileSync(ownersPath, 'utf-8');
    // Match: | Primary Owner | 名字 |  (extract between 2nd and 3rd pipe, exclude \r\n and |)
    const primaryMatch = content.match(/\|\s*Primary\s+Owner\s*\|\s*([^|\r\n]+)/i);
    const backupMatch = content.match(/\|\s*Backup\s+Owner\s*\|\s*([^|\r\n]+)/i);
    return {
      primaryOwner: primaryMatch ? primaryMatch[1].trim() : '',
      backupOwner: backupMatch ? backupMatch[1].trim() : '',
    };
  } catch {
    return { primaryOwner: '', backupOwner: '' };
  }
}

export function normalize(input: NormalizeInput): { specRows: SpecRow[]; taskRows: TaskRow[] } {
  const { specs, parsedTasks, config } = input;
  const now = new Date().toISOString();
  const commitShort = config.commitSha;

  const specRows: SpecRow[] = [];
  const taskRows: TaskRow[] = [];
  const seenIds = new Map<string, { specId: string; taskNumber: string; title: string }>();

  for (const spec of specs) {
    const specId = spec.specId;
    const tasks = parsedTasks.get(specId) ?? [];
    const sourcePath = `.kiro/specs/${specId}/tasks.md`;
    const sourceUrl =
      config.gitlabBaseUrl && config.projectPath
        ? `${config.gitlabBaseUrl}/${config.projectPath}/-/blob/${config.commitSha}/${sourcePath}`
        : '';

    // Read owners for this spec
    const { primaryOwner, backupOwner } = readOwners(config.repoRoot, specId);

    // Build TaskRows
    const specTaskRows: TaskRow[] = [];
    for (const task of tasks) {
      const taskHash = shortHash(task.taskNumber + '\x01' + task.title);
      const uniqueId = `task::${specId}::${taskHash}`;

      // Duplicate detection
      const existing = seenIds.get(uniqueId);
      if (existing) {
        throw new DuplicateUniqueIdError(uniqueId, existing, {
          specId,
          taskNumber: task.taskNumber,
          title: task.title,
        });
      }
      seenIds.set(uniqueId, { specId, taskNumber: task.taskNumber, title: task.title });

      const displayTitle = task.separator
        ? `${task.taskNumber}${task.separator} ${task.title}`
        : `${task.taskNumber} ${task.title}`;

      specTaskRows.push({
        uniqueId,
        type: 'task',
        specId,
        taskNumber: task.taskNumber,
        title: task.title,
        displayTitle,
        description: task.description,
        status: task.status,
        progress: task.progress,
        optional: task.optional,
        sourcePath,
        sourceUrl,
        commitShaShort: commitShort,
        lastSyncAt: now,
        parentUniqueId: `spec::${specId}`,
        primaryOwner,
        backupOwner,
      });
    }
    taskRows.push(...specTaskRows);

    // Build SpecRow with aggregated status
    const { status: specStatus, progress: specProgress } = aggregateSpecStatus(specTaskRows);
    const specTitle = deriveSpecTitle(specId, config.repoRoot);

    specRows.push({
      uniqueId: `spec::${specId}`,
      type: 'spec',
      specId,
      title: specTitle,
      status: specStatus,
      progress: specProgress,
      sourcePath,
      sourceUrl,
      commitShaShort: commitShort,
      lastSyncAt: now,
    });
  }

  return { specRows, taskRows };
}

export function aggregateSpecStatus(tasks: TaskRow[]): { status: Status; progress: number } {
  if (tasks.length === 0) return { status: 'not_started', progress: 0 };

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const allDone = doneCount === tasks.length;
  const allNotStarted = tasks.every((t) => t.status === 'not_started');

  if (allDone) return { status: 'done', progress: 100 };
  if (allNotStarted) return { status: 'not_started', progress: 0 };

  // Mixed or has in_progress → in_progress
  const progress = Math.floor((doneCount / tasks.length) * 100);
  return { status: 'in_progress', progress };
}

export function deriveSpecTitle(specId: string, repoRoot: string): string {
  const reqPath = path.join(repoRoot, '.kiro', 'specs', specId, 'requirements.md');
  if (!existsSync(reqPath)) return specId;
  try {
    const content = readFileSync(reqPath, 'utf-8');
    const match = content.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : specId;
  } catch {
    return specId;
  }
}
