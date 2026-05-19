import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { SpecRow, TaskRow, CsvRow, CsvWriteResult } from './types.js';

const CSV_COLUMNS: (keyof CsvRow)[] = [
  'specId', 'title', 'status', 'commitShaShort',
];

const HEADER = CSV_COLUMNS.join(',');

function escapeField(value: string | number | boolean): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function toCsvRows(specRows: SpecRow[], taskRows: TaskRow[]): CsvRow[] {
  const rows: CsvRow[] = [];

  // Only output task rows (no spec rows in the table)
  for (const task of taskRows) {
    rows.push({
      uniqueId: task.uniqueId,
      type: 'task',
      specId: task.specId,
      taskNumber: task.taskNumber,
      title: task.displayTitle,
      status: task.status,
      progress: task.progress,
      optional: task.optional,
      sourcePath: task.sourcePath,
      sourceUrl: task.sourceUrl,
      commitShaShort: task.commitShaShort,
    });
  }

  return rows;
}

export async function writeCsv(outputPath: string, rows: CsvRow[]): Promise<CsvWriteResult> {
  try {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    await mkdir(dir, { recursive: true });

    // Build CSV content
    const lines = [HEADER];
    for (const row of rows) {
      const fields = CSV_COLUMNS.map(col => escapeField(row[col]));
      lines.push(fields.join(','));
    }
    const content = lines.join('\n') + '\n';

    await writeFile(outputPath, content, 'utf-8');
    return { ok: true, rowCount: rows.length };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}
