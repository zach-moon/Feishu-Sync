import { execSync } from 'node:child_process';
import type { RawRecord } from './types.js';

export interface FeishuFieldsMap {
  [fieldName: string]: unknown;
}

export interface CreateRecord {
  fields: FeishuFieldsMap;
}

export interface UpdateRecord {
  record_id: string;
  fields: FeishuFieldsMap;
}

const FIELD_NAMES = ['文本', 'title', 'description', 'status', 'primaryOwner', 'backupOwner', 'commitShaShort', 'time'];
const BATCH_SIZE = 200; // lark-cli limit

// Required fields and their types for auto-creation
const REQUIRED_FIELDS: Array<{ name: string; type: string; options?: any }> = [
  // "文本" is the primary field (auto-exists), used as SpecID
  { name: 'title', type: 'text' },
  { name: 'description', type: 'text' },
  { name: 'status', type: 'select', options: { multiple: false, options: [{ name: '未开始' }, { name: '进行中' }, { name: '已完成' }, { name: '已移除' }, { name: '已验收' }] } },
  { name: 'primaryOwner', type: 'text' },
  { name: 'backupOwner', type: 'text' },
  { name: 'commitShaShort', type: 'text' },
  { name: 'time', type: 'text' },
];

export class FeishuClient {
  constructor() {}

  /**
   * Ensure all required fields exist in the table. Creates missing ones automatically.
   * Also renames the default "文本" field to "SpecID" and cleans up empty rows.
   */
  async ensureFields(appToken: string, tableId: string): Promise<void> {
    // Get existing fields
    const result = this.execJson(
      `base +field-list --base-token ${appToken} --table-id ${tableId}`,
    );
    const existingFieldsList: Array<{ id: string; name: string }> = (result?.data?.fields ?? []).map((f: any) => ({ id: f.id, name: f.name }));
    const existingNames = existingFieldsList.map(f => f.name);

    // Create missing fields ("文本" is the primary field, used as SpecID — already exists)
    for (const field of REQUIRED_FIELDS) {
      if (!existingNames.includes(field.name)) {
        const fieldDef: any = { field_name: field.name, type: field.type };
        if (field.options) {
          Object.assign(fieldDef, field.options);
        }
        const payload = JSON.stringify(fieldDef);
        const escaped = payload.replace(/'/g, "'\\''");
        try {
          this.exec(
            `base +field-create --base-token ${appToken} --table-id ${tableId} --json '${escaped}'`,
          );
          console.log(`[feisync] Created field: ${field.name} (${field.type})`);
        } catch (err) {
          console.warn(`[WARN] Failed to create field "${field.name}": ${(err as Error).message?.slice(0, 100)}`);
        }
      }
    }

    // Clean up empty rows (rows where all fields are null/empty)
    await this.cleanEmptyRows(appToken, tableId);
  }

  /**
   * Delete rows where all fields are null/empty (default empty rows from new table).
   */
  private async cleanEmptyRows(appToken: string, tableId: string): Promise<void> {
    try {
      const records = await this.listAllRecords(appToken, tableId);
      if (records.length > 10) return; // Not a fresh table, skip cleanup

      const emptyRecordIds: string[] = [];

      for (const record of records) {
        const allEmpty = Object.values(record.fields).every(
          v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.every(x => x === null)),
        );
        if (allEmpty) {
          emptyRecordIds.push(record.recordId);
        }
      }

      if (emptyRecordIds.length > 0) {
        for (const id of emptyRecordIds) {
          try {
            this.exec(
              `base +record-delete --base-token ${appToken} --table-id ${tableId} --record-id ${id} --yes`,
            );
          } catch { /* ignore individual delete failures */ }
        }
        console.log(`[feisync] Cleaned ${emptyRecordIds.length} empty row(s)`);
      }
    } catch (err) {
      console.warn(`[WARN] Failed to clean empty rows: ${(err as Error).message?.slice(0, 100)}`);
    }
  }

  private exec(args: string): string {
    try {
      return execSync(`lark-cli ${args}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      }).trim();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'stderr' in err) {
        const stderr = (err as any).stderr?.toString() ?? '';
        throw new Error(`lark-cli failed: ${stderr.slice(0, 500)}`);
      }
      throw err;
    }
  }

  private execJson(args: string): any {
    const raw = this.exec(args);
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`lark-cli returned non-JSON: ${raw.slice(0, 200)}`);
    }
  }

  async listAllRecords(appToken: string, tableId: string): Promise<RawRecord[]> {
    const records: RawRecord[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = this.execJson(
        `base +record-list --base-token ${appToken} --table-id ${tableId} --limit 200 --offset ${offset} --format json`,
      );

      const data = result?.data;
      if (!data) break;

      const fieldNames: string[] = data.fields ?? [];
      const recordIds: string[] = data.record_id_list ?? [];
      const rows: (unknown[] | null)[] = data.data ?? [];

      for (let i = 0; i < recordIds.length; i++) {
        const row = rows[i];
        const fields: Record<string, unknown> = {};
        if (row && Array.isArray(row)) {
          for (let j = 0; j < fieldNames.length; j++) {
            fields[fieldNames[j]] = row[j];
          }
        }
        records.push({ recordId: recordIds[i], fields });
      }

      hasMore = data.has_more ?? false;
      offset += recordIds.length;
    }

    return records;
  }

  /**
   * Batch create records, chunked at 200.
   */
  async batchCreate(
    appToken: string,
    tableId: string,
    records: CreateRecord[],
  ): Promise<RawRecord[]> {
    const results: RawRecord[] = [];

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      const rows = chunk.map(rec =>
        FIELD_NAMES.map(name => {
          const val = rec.fields[name];
          return val === undefined || val === null ? '' : String(val);
        }),
      );

      const payload = JSON.stringify({ fields: FIELD_NAMES, rows });
      const escaped = payload.replace(/'/g, "'\\''");

      const result = this.execJson(
        `base +record-batch-create --base-token ${appToken} --table-id ${tableId} --json '${escaped}'`,
      );

      const recordIds: string[] = result?.data?.record_id_list ?? [];
      for (let j = 0; j < recordIds.length; j++) {
        results.push({
          recordId: recordIds[j],
          fields: chunk[j].fields as Record<string, unknown>,
        });
      }
    }

    return results;
  }

  /**
   * Batch update records using raw API (supports per-record different values).
   * Chunks at 200 records.
   */
  async batchUpdate(
    appToken: string,
    tableId: string,
    records: UpdateRecord[],
  ): Promise<RawRecord[]> {
    const results: RawRecord[] = [];
    const BATCH_SIZE = 200;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);

      // Use raw API: POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_update
      const apiRecords = chunk.map(rec => ({
        record_id: rec.record_id,
        fields: rec.fields,
      }));

      const payload = JSON.stringify({ records: apiRecords });
      const escaped = payload.replace(/'/g, "'\\''");

      try {
        this.exec(
          `api POST /open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update --data '${escaped}'`,
        );
      } catch (err) {
        // If raw API fails, fall back to one-by-one upsert
        for (const rec of chunk) {
          const fieldsJson = JSON.stringify(rec.fields);
          const esc = fieldsJson.replace(/'/g, "'\\''");
          this.exec(
            `base +record-upsert --base-token ${appToken} --table-id ${tableId} --record-id ${rec.record_id} --json '${esc}'`,
          );
        }
      }

      for (const rec of chunk) {
        results.push({
          recordId: rec.record_id,
          fields: rec.fields as Record<string, unknown>,
        });
      }
    }

    return results;
  }
}
