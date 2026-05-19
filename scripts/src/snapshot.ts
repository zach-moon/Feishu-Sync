import { writeFileSync, readFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { TaskRow } from './types.js';

const SNAPSHOTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '.snapshots',
);

const MAX_SNAPSHOTS = 7; // Keep only last 7 days

export interface SnapshotEntry {
  specId: string;
  title: string;
  status: string;
}

/**
 * Save today's snapshot after sync.
 */
export function saveSnapshot(taskRows: TaskRow[]): void {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const entries: SnapshotEntry[] = taskRows.map(t => ({
    specId: t.specId,
    title: t.displayTitle,
    status: t.status,
  }));

  const filePath = path.join(SNAPSHOTS_DIR, `${today}.json`);
  writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  console.log(`[feisync] Snapshot saved: ${filePath} (${entries.length} tasks)`);
}

/**
 * Load a snapshot by date string (YYYY-MM-DD).
 */
export function loadSnapshot(date: string): SnapshotEntry[] | null {
  const filePath = path.join(SNAPSHOTS_DIR, `${date}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Get the most recent snapshot date before the given date.
 */
export function getPreviousSnapshotDate(beforeDate: string): string | null {
  if (!existsSync(SNAPSHOTS_DIR)) return null;
  const files = readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .filter(d => d < beforeDate)
    .sort()
    .reverse();
  return files[0] ?? null;
}

/**
 * Clean up old snapshots, keeping only the most recent MAX_SNAPSHOTS.
 */
export function cleanOldSnapshots(): void {
  if (!existsSync(SNAPSHOTS_DIR)) return;
  const files = readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  // Delete files beyond MAX_SNAPSHOTS
  for (let i = MAX_SNAPSHOTS; i < files.length; i++) {
    const filePath = path.join(SNAPSHOTS_DIR, files[i]);
    try {
      unlinkSync(filePath);
      console.log(`[feisync] Cleaned old snapshot: ${files[i]}`);
    } catch { /* ignore */ }
  }
}
