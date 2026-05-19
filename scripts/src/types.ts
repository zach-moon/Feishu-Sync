export type Status = 'not_started' | 'in_progress' | 'done' | 'removed';

export interface ParsedTaskItem {
  ordinal: number;
  source: 'list' | 'heading';
  taskNumber: string;
  separator: '.' | ':' | '';
  title: string;
  description: string;
  status: 'not_started' | 'in_progress' | 'done';
  progress: number;
  optional: boolean;
}

export interface SpecRow {
  uniqueId: string;
  type: 'spec';
  specId: string;
  title: string;
  status: Status;
  progress: number;
  sourcePath: string;
  sourceUrl: string;
  commitShaShort: string;
  lastSyncAt: string;
}

export interface TaskRow {
  uniqueId: string;
  type: 'task';
  specId: string;
  taskNumber: string;
  title: string;
  displayTitle: string;
  description: string;
  status: Status;
  progress: number;
  optional: boolean;
  sourcePath: string;
  sourceUrl: string;
  commitShaShort: string;
  lastSyncAt: string;
  parentUniqueId: string;
  primaryOwner: string;
  backupOwner: string;
}

export type NormalizedRow = SpecRow | TaskRow;

export interface RawRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

export type IgnoreReason =
  | 'stray_file'
  | 'dot_prefix'
  | 'underscore_prefix'
  | 'no_tasks_file'
  | 'depth_exceeded';

export interface IgnoredEntry {
  name: string;
  reason: IgnoreReason;
  path: string;
}

export interface ScanResult {
  specs: Array<{ specId: string; path: string | null }>;
  ignored: IgnoredEntry[];
}

export interface DiffResult {
  created: NormalizedRow[];
  updated: Array<NormalizedRow & { recordId: string }>;
  removed: Array<{ uniqueId: string; recordId: string }>;
  unchanged: number;
  removedRatio: number;
}

export interface CsvRow {
  uniqueId: string;
  type: 'spec' | 'task';
  specId: string;
  taskNumber: string;
  title: string;
  status: string;
  progress: number;
  optional: boolean;
  sourcePath: string;
  sourceUrl: string;
  commitShaShort: string;
}

export interface CsvWriteResult {
  ok: boolean;
  reason?: string;
  rowCount?: number;
}
