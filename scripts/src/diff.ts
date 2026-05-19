import type { NormalizedRow, RawRecord, DiffResult, TaskRow } from './types.js';

// Field mapping: how NormalizedRow fields map to Feishu record field names
const COMPARE_FIELDS_MAP: Record<string, string> = {
  status: '状态',
  progress: '完成度',
  sourcePath: '源文件',
  commitShaShort: '最后提交',
};

const STATUS_MAP: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  removed: '已移除',
};

function getDisplayTitle(row: NormalizedRow): string {
  return row.type === 'task' ? (row as TaskRow).displayTitle : row.title;
}

function hasFieldChanges(row: NormalizedRow, existing: RawRecord): boolean {
  const fields = existing.fields;

  // Compare title
  const currentTitle = getDisplayTitle(row);
  if (normalizeFieldValue(fields['title']) !== currentTitle) return true;

  // Compare status (mapped to Chinese)
  const currentStatus = STATUS_MAP[row.status] ?? row.status;
  if (normalizeFieldValue(fields['status']) !== currentStatus) return true;

  // Compare description
  if (row.type === 'task') {
    const taskRow = row as any;
    if (normalizeFieldValue(fields['description'] ?? '') !== (taskRow.description ?? '')) return true;
    if (normalizeFieldValue(fields['primaryOwner'] ?? '') !== (taskRow.primaryOwner ?? '')) return true;
    if (normalizeFieldValue(fields['backupOwner'] ?? '') !== (taskRow.backupOwner ?? '')) return true;
  }

  return false;
}

/**
 * Normalize a Feishu field value for comparison.
 * Feishu returns single-select as ['value'] array, text as string or null.
 */
function normalizeFieldValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return val[0] ?? '';
  return String(val);
}

export function computeDiff(
  currentRows: NormalizedRow[],
  existingRecords: Map<string, RawRecord>,
): DiffResult {
  const created: NormalizedRow[] = [];
  const updated: Array<NormalizedRow & { recordId: string }> = [];
  const removed: Array<{ uniqueId: string; recordId: string }> = [];
  let unchanged = 0;

  // Build lookup key for current rows: specId::displayTitle
  const currentKeys = new Set<string>();
  for (const row of currentRows) {
    const title = getDisplayTitle(row);
    const key = `${row.specId}::${title}`;
    currentKeys.add(key);

    const existing = existingRecords.get(key);
    if (!existing) {
      created.push(row);
    } else {
      // Skip records that are marked as "已验收" in Feishu — never overwrite them
      const existingStatus = normalizeFieldValue(existing.fields['status']);
      if (existingStatus === '已验收') {
        unchanged++;
        continue;
      }

      if (hasFieldChanges(row, existing)) {
        updated.push({ ...row, recordId: existing.recordId });
      } else {
        unchanged++;
      }
    }
  }

  // Find removed: in existing but not in current, and not already marked as removed
  for (const [key, record] of existingRecords) {
    if (!currentKeys.has(key)) {
      const statusVal = normalizeFieldValue(record.fields['status']);
      if (statusVal !== '已移除') {
        removed.push({ uniqueId: key, recordId: record.recordId });
      }
    }
  }

  // Calculate removedRatio using active (non-removed) existing records
  const activeExistingCount = [...existingRecords.values()]
    .filter(r => normalizeFieldValue(r.fields['status']) !== '已移除')
    .length;
  const removedRatio = removed.length / Math.max(activeExistingCount, 1);

  return { created, updated, removed, unchanged, removedRatio };
}
