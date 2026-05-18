# Implementation Plan: GitLab CI Feishu Sync

## Overview

实现一个 TypeScript 脚本工具，将业务仓库 `.kiro/specs/**/tasks.md` 中的 Kiro spec 进度同步到飞书多维表格。脚本支持本地 CLI 与 GitLab CI 两种触发模式，核心流程为：扫描 → 解析 → 归一化 → CSV 诊断输出 → 飞书 diff → 移除保护 → upsert 写入。

## Notes

- 本 spec 是一个独立的脚本工具（`scripts/sync-to-feishu.ts`），不是常驻后端服务。
- 不适用 `/healthz`、`/readyz`、structured JSON logs、`policy-service`、usage event 等后端服务要求。
- 不涉及多租户隔离、跨租户拒绝测试、权限拒绝路径测试等平台级安全约束。
- 日志输出为 CI Job stdout 的分段文本格式（reporter），不使用 structlog 或 JSON 结构化日志。
- 实现语言为 TypeScript，运行于 Node.js 20，测试框架为 Vitest + fast-check。
- 所有 steering 中关于 Go/Python 服务结构、前端组件、API envelope 等规范与本脚本无关。

## Tasks

- [x] 1. Scaffold project structure and install dependencies
  - [x] 1.1 Create directory structure and package.json
    - Create `scripts/` directory with `package.json` declaring runtime deps (`unified`, `remark-parse`, `remark-gfm`, `mdast-util-to-string`, `zod`, `dotenv`) and dev deps (`vitest`, `fast-check`, `nock`, `memfs`, `execa`, `typescript`, `tsx`, `@types/node`)
    - Prerequisite: `lark-cli` installed via `npx @larksuite/cli@latest install` (not an npm dep, CLI tool)
    - Create `scripts/tsconfig.json` with strict mode, ESM output, path aliases
    - Create `scripts/src/` and `scripts/tests/` directory structure matching verification.md layout
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 1.2 Create .env.example and .gitignore
    - Create `scripts/.env.example` with all env var placeholders per design doc
    - Create or update `scripts/.gitignore` to exclude `.env` and `node_modules/`
    - _Requirements: 8.7_

- [x] 2. Implement utility modules
  - [x] 2.1 Implement hash utilities (`scripts/src/utils/hash.ts`)
    - `sha256Hex(input: string): string` using Node.js `crypto`
    - `shortHash(input: string, len = 16): string`
    - _Requirements: 3.2_

  - [x] 2.2 Implement mask utility (`scripts/src/utils/mask.ts`)
    - `mask(s: string, prefixLen = 4): string` → first N chars + `***`
    - _Requirements: 8.5_

  - [ ]* 2.3 Write unit tests for hash and mask utilities
    - Test sha256Hex determinism, shortHash length, mask output format
    - _Requirements: 3.2, 8.5_

- [x] 3. Implement config module (`scripts/src/config.ts`)
  - [x] 3.1 Implement config loading and validation with zod
    - Mode detection (`ci` vs `local-cli`) based on `CI` / `CI_PROJECT_DIR`
    - Load `.env` files in local-cli mode only (dotenv)
    - Validate required env vars: `FEISHU_APP_TOKEN`, `FEISHU_TABLE_ID`; CI-only: `LARK_APP_ID`, `LARK_APP_SECRET`
    - Parse optional `CSV_OUTPUT_PATH`, `REMOVED_PROTECTION_THRESHOLD`, `DRY_RUN`, `FORCE_SYNC`
    - `Object.freeze` the resulting Config object
    - Print missing field names on failure (never values), exit non-zero
    - _Requirements: 1.2, 1.3, 1.4, 1.6, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 3.2 Write unit tests for config module
    - Test missing required vars (FEISHU_APP_TOKEN, FEISHU_TABLE_ID) → error with field name
    - Test CI mode requires LARK_APP_ID/LARK_APP_SECRET
    - Test `CSV_OUTPUT_PATH` optional parsing
    - Test freeze behavior
    - Test mode detection logic
    - _Requirements: 8.1, 8.4_

- [x] 4. Implement types module (`scripts/src/types.ts`)
  - [x] 4.1 Define all shared TypeScript interfaces and types
    - `Status`, `ParsedTaskItem`, `SpecRow`, `TaskRow`, `NormalizedRow`, `RawRecord`
    - `IgnoreReason`, `ScanResult`, `DiffResult`, `CsvRow`, `CsvWriteResult`
    - _Requirements: 2.4, 3.1, 3.2, 4.1_

- [x] 5. Implement scanner module (`scripts/src/scanner.ts`)
  - [x] 5.1 Implement spec directory scanning logic
    - `fs.readdirSync` on `<Repo_Root>/.kiro/specs`
    - Classify entries: stray_file, dot_prefix, underscore_prefix, no_tasks_file, depth_exceeded
    - Collect valid specs with `tasks.md` present
    - Sort specs by specId lexicographically
    - Return `ScanResult { specs, ignored }`
    - _Requirements: 2.1, 2.2, 2.3, 2.13_

  - [ ]* 5.2 Write unit tests for scanner (with memfs)
    - Test exclusion of `_*`, `.*`, stray files, no_tasks_file directories
    - Test depth_exceeded detection
    - Test deterministic sort order
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 6. Checkpoint - Ensure scaffold and utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement parser module (`scripts/src/parser.ts`)
  - [x] 7.1 Implement List_Task parsing path
    - Use `unified` + `remarkParse` + `remarkGfm` to produce mdast
    - Track listItem nesting depth via stack
    - Implement `detectInProgressLiteral` for `[-]` / `[ -]` prefix detection
    - Identify depth-0 listItems with `checked != null` or `[-]` literal
    - Strip emphasis, extract optional `*` marker, match Task_Number regex
    - Determine status/progress per Req 2.6 / 2.12
    - _Requirements: 2.4, 2.5, 2.6, 2.8, 2.9, 2.10, 2.12_

  - [x] 7.2 Implement Heading_Task parsing path
    - Identify H3 headings matching Task_Number regex
    - Collect contributor listItems between H3 and next same-or-higher heading
    - Implement `aggregateHeadingStatus` for contributor aggregation
    - Handle Subgroup_Heading detection (no contributors → skip)
    - _Requirements: 2.4, 2.7, 2.12_

  - [x] 7.3 Implement helper functions (stripEmphasis, Task_Number regex)
    - `stripEmphasis(s: string): string` — strip outer `**` / `__`
    - Task_Number regex covering all sample patterns from Req 2.5
    - Merge List_Task and Heading_Task results in mdast traversal order
    - _Requirements: 2.5, 2.9, 2.10_

  - [ ]* 7.4 Write unit tests for parser
    - Test `[ ]` / `[x]` / `[X]` / `[-]` four-state recognition
    - Test nested checkbox exclusion (depth > 0)
    - Test Heading_Task contributor aggregation
    - Test Subgroup_Heading skip behavior
    - Test Task_Number regex against all sample patterns
    - Test noise/non-task bullet skip
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.12_

- [x] 8. Implement normalizer module (`scripts/src/normalizer.ts`)
  - [x] 8.1 Implement uniqueId derivation and field normalization
    - Spec_Row: `uniqueId = spec::${specId}`
    - Task_Row: `uniqueId = task::${specId}::${shortHash(taskNumber + '\x01' + title)}`
    - Fill `displayTitle`, `sourcePath`, `commitSha`, `lastSyncAt`
    - Implement `aggregateSpecStatus` for Spec_Row status/progress
    - Implement `deriveSpecTitle` reading requirements.md H1
    - Duplicate uniqueId detection → throw `DuplicateUniqueIdError`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 2.14, 4.3_

  - [ ]* 8.2 Write unit tests for normalizer
    - Test uniqueId format and stability
    - Test duplicate detection throws error
    - Test aggregateSpecStatus four-branch logic
    - Test deriveSpecTitle fallback to specId
    - _Requirements: 3.1, 3.2, 3.5, 4.3, 2.14_

- [x] 9. Implement CSV writer module (`scripts/src/csvWriter.ts`)
  - [x] 9.1 Implement RFC 4180 CSV serialization and file write
    - `toCsvRows(specRows, taskRows): CsvRow[]` — flatten to CSV row sequence
    - `writeCsv(outputPath, rows): Promise<CsvWriteResult>` — write UTF-8 + LF
    - Handle RFC 4180 escaping (comma, quote, newline, carriage return)
    - Return `{ ok: false, reason }` on I/O error, never throw
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 9.2 Write unit tests for CSV writer
    - Test RFC 4180 escaping with special characters in title
    - Test UTF-8/LF output
    - Test directory-not-exist returns `{ ok: false }`
    - Test column order matches spec
    - _Requirements: 12.1, 12.2, 12.4_

- [ ] 10. Checkpoint - Ensure parser, normalizer, CSV writer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Feishu client module (`scripts/src/feishu.client.ts`)
  - [x] 11.1 Implement FeishuClient class with lark-cli shell wrapper
    - Constructor accepting appToken, tableId
    - Shell wrapper calling `lark-cli` via `child_process.execFile` for Bitable API operations
    - Auth handled by lark-cli: local mode uses cached OAuth, CI mode uses LARK_APP_ID/SECRET env vars
    - `listAllRecords()` with automatic pagination handling
    - `batchCreate(records)` with 500-record chunking
    - `batchUpdate(records)` with 500-record chunking
    - Retry logic: 429/5xx exponential backoff (250ms/1s/5s, max 3 retries)
    - _Requirements: 5.1, 5.5, 5.6_

  - [ ]* 11.2 Write unit tests for Feishu client (with nock)
    - Test pagination handling (multiple pages)
    - Test batch chunking with >500 records (split into batches)
    - Test 429 retry with Retry-After header
    - Test 5xx exponential backoff
    - Test max retry exhaustion → throw
    - _Requirements: 5.5, 5.6_

- [ ] 12. Implement diff module (`scripts/src/diff.ts`)
  - [x] 12.1 Implement diff calculation logic
    - Input: current `NormalizedRow[]` + existing `Map<uniqueId, RawRecord>`
    - Output: `DiffResult { created, updated, removed, unchanged }`
    - `updated` comparison fields: title, status, sourcePath, commitSha
    - Calculate `removedRatio` using active (non-removed) existing records
    - _Requirements: 5.2, 5.3, 5.4, 6.2_

  - [ ]* 12.2 Write unit tests for diff module
    - Test created/updated/removed/unchanged classification
    - Test removedRatio calculation
    - Test empty existing records → all created
    - Test identical records → all unchanged
    - _Requirements: 5.2, 5.3, 5.4, 6.2_

- [x] 13. Implement sync orchestrator (`scripts/src/sync.ts`)
  - [x] 13.1 Implement main sync orchestration flow
    - Wire scanner → parser → normalizer → CSV write → feishu list → diff → protection check → dry-run check → write phases
    - Phase 1: Task upsert (batchCreate + batchUpdate), matching by Spec ID + 标题 combination
    - Phase 2: Soft remove (status → 已移除)
    - Track failures per record, continue on single-record failure
    - Return exit code (0 success, 1 failure)
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4_

- [x] 14. Implement reporter module (`scripts/src/reporter.ts`)
  - [x] 14.1 Implement structured CI log output
    - Segmented output: CI Context, Scan Result, Ignored Entries, Diff Summary, Feishu Write Result, final conclusion
    - `mask()` all secret fields before output
    - `redactError(e)` to strip sensitive headers from SDK errors
    - Final line: `SUCCESS` / `DRY_RUN` / `ABORTED_PROTECTION` / `FAILED`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 8.5, 2.13_

  - [ ]* 14.2 Write unit tests for reporter
    - Test output format segments
    - Test mask behavior (first 4 chars + `***`)
    - Test ignored entries section output
    - _Requirements: 10.1, 8.5, 2.13_

- [x] 15. Implement entry point (`scripts/src/sync-to-feishu.ts`)
  - [x] 15.1 Create main entry point wiring all modules
    - Top-level `main(env)` function returning exit code
    - Top-level try/catch converting uncaught exceptions to stderr + exit 1
    - Call `redactError` on any exception before logging
    - Set `process.exitCode` based on return value
    - _Requirements: 1.1, 1.2, 10.3_

- [ ] 16. Checkpoint - Ensure all unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Create GitLab CI job definition
  - [x] 17.1 Add `sync-to-feishu` job to `.gitlab-ci.yml`
    - `image: node:20-alpine`
    - `rules` for push to default branch, MR merge, manual FORCE_SYNC
    - `changes` filter on `.kiro/specs/**/*`
    - `before_script: cd scripts && npm ci && cd -` + `npx @larksuite/cli@latest install`
    - `script: node --enable-source-maps scripts/dist/sync-to-feishu.js`
    - `timeout: 10 minutes`, `retry` on runner failures
    - CI Variables: `LARK_APP_ID`, `LARK_APP_SECRET`, `FEISHU_APP_TOKEN`, `FEISHU_TABLE_ID`
    - _Requirements: 1.5, 1.7, 1.8, 1.9, 1.10, 11.3_

- [ ] 18. Create scripts/README.md onboarding documentation
  - [ ] 18.1 Write README with setup and onboarding instructions
    - Local CLI usage instructions
    - CI integration steps (copy files → configure variables → create Feishu fields)
    - Environment variable reference
    - _Requirements: 9.4, 11.1, 11.4_

- [ ] 19. Checkpoint - Ensure project builds and lints cleanly
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Write property test: 解析-序列化往返一致
  - [ ]* 20.1 Implement Property 1 test (`tests/property/parser.roundtrip.prop.ts`)
    - **Property 1: 解析-序列化往返一致**
    - Build `taskListArbitrary` generator covering `[ ]` / `[x]` / `[X]` / `[-]`, Heading_Task, Subgroup_Heading, `*` optional marker, nested sub-items
    - Assert `parse(serialize(parse(T)))` equals `parse(T)` on all key fields
    - numRuns: 500
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.12, 2.13**

- [ ] 21. Write property test: Diff 分区律
  - [ ]* 21.1 Implement Property 2 test (`tests/property/diff.partition.prop.ts`)
    - **Property 2: Diff 分区律**
    - Build `normalizedRowArbitrary` for prev/curr arrays
    - Assert created/updated/removed sets are disjoint by uniqueId
    - Assert set algebra: created = curr − prev, removed = prev − curr, updated ⊆ prev ∩ curr
    - Assert union of all four = keys(prev) ∪ keys(curr)
    - **Validates: Requirements 5.2, 5.3, 5.4**

- [ ] 22. Write property test: Secret 永不出现在日志
  - [ ]* 22.1 Implement Property 3 test (`tests/property/secrets.never.leak.prop.ts`)
    - **Property 3: Secret 永不出现在日志**
    - Generate random Config with secrets via zod-compatible arbitrary
    - Run end-to-end flow with nock mocks (success / dry-run / aborted / partial-failure)
    - Assert stdout/stderr never contain full secret values
    - Assert only `mask(secret, 4)` form appears
    - numRuns: 500
    - **Validates: Requirements 8.3**

- [ ] 23. Write property test: Unique_Id 派生函数稳定
  - [ ]* 23.1 Implement Property 4 test (`tests/property/uniqueId.stable.prop.ts`)
    - **Property 4: Unique_Id 派生函数稳定**
    - Generate random `(specId, taskNumber, title)` tuples
    - Assert same input → same uniqueId
    - Assert any single field change → different uniqueId
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [ ] 24. Write property test: 移除保护幂等
  - [ ]* 24.1 Implement Property 5 test (`tests/property/aborted.protection.prop.ts`)
    - **Property 5: 移除保护幂等**
    - Generate inputs triggering removedRatio >= 0.30 with FORCE_SYNC=false
    - Assert feishu mock create/update/delete call count = 0
    - Assert exit code = 1
    - Assert stdout contains `ABORTED_PROTECTION` keyword and removed uniqueId list
    - **Validates: Requirements 6.3, 6.4**

- [ ] 25. Write property test: 状态四态聚合一致
  - [ ]* 25.1 Implement Property 6 test (`tests/property/status.aggregation.prop.ts`)
    - **Property 6: 状态四态聚合一致**
    - Generate `TaskRow[]` with status from `{not_started, in_progress, done}`
    - Assert `aggregateSpecStatus` invariants: empty→not_started/0, all done→done/100, all not_started→not_started/0, mixed→in_progress with correct progress
    - Assert `aggregateHeadingStatus` symmetric invariants
    - **Validates: Requirements 2.6, 2.7, 2.12, 4.3, 4.5**

- [ ] 26. Write property test: CSV 输出无副作用 + RFC 4180 兼容
  - [ ]* 26.1 Implement Property 7 test (`tests/property/csv.no_side_effect.prop.ts`)
    - **Property 7: CSV 输出无副作用 + RFC 4180 兼容**
    - Generate `normalizedRowArbitrary` for specRows/taskRows
    - Assert writeCsv returns `{ ok: true, rows }` with correct count
    - Assert first line is exact header
    - Assert RFC 4180 round-trip parse (papaparse) matches input
    - Assert titles with `,` / `"` / `\n` / `\r` survive round-trip
    - Assert CSV write failure does not affect feishu mock call counts
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5**

- [ ] 27. Checkpoint - Ensure all property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 28. Write integration test: end-to-end success flow
  - [ ]* 28.1 Implement e2e success test (`tests/integration/e2e.success.spec.ts`)
    - Use execa to run script as subprocess with nock-intercepted feishu API
    - Verify exit code 0, correct stdout segments, feishu write calls made
    - Verify in_progress tasks and specTitle derivation
    - _Requirements: 1.1, 5.2, 5.3, 5.5, 10.1_

- [ ] 29. Write integration test: aborted protection flow
  - [ ]* 29.1 Implement e2e aborted test (`tests/integration/e2e.aborted.spec.ts`)
    - Trigger removedRatio >= threshold
    - Verify exit code 1, no feishu write calls, ABORTED_PROTECTION in stdout
    - _Requirements: 6.3, 6.4_

- [ ] 30. Write integration test: dry-run flow
  - [ ]* 30.1 Implement e2e dry-run test (`tests/integration/e2e.dry_run.spec.ts`)
    - Set DRY_RUN=true
    - Verify exit code 0, no feishu write calls, preview output present
    - Verify CSV file still written when CSV_OUTPUT_PATH set
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 12.3_

- [ ] 31. Write integration test: partial failure flow
  - [ ]* 31.1 Implement e2e partial failure test (`tests/integration/e2e.partial_failure.spec.ts`)
    - Mock feishu API returning 5xx for some records
    - Verify exit code 1, other records still written, failure summary in stdout
    - _Requirements: 10.2, 10.3_

- [ ] 32. Write integration test: CSV disabled flow
  - [ ]* 32.1 Implement e2e CSV disabled test (`tests/integration/e2e.csv_disabled.spec.ts`)
    - Do not set CSV_OUTPUT_PATH
    - Verify no CSV file created, feishu sync proceeds normally
    - _Requirements: 12.5_

- [ ] 33. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "4.1"] },
    { "id": 2, "tasks": ["2.3", "3.1", "5.1"] },
    { "id": 3, "tasks": ["3.2", "5.2", "7.1"] },
    { "id": 4, "tasks": ["7.2", "7.3"] },
    { "id": 5, "tasks": ["7.4", "8.1"] },
    { "id": 6, "tasks": ["8.2", "9.1"] },
    { "id": 7, "tasks": ["9.2", "11.1", "12.1"] },
    { "id": 8, "tasks": ["11.2", "12.2", "14.1"] },
    { "id": 9, "tasks": ["13.1", "14.2"] },
    { "id": 10, "tasks": ["15.1", "17.1", "18.1"] },
    { "id": 11, "tasks": ["20.1", "21.1", "23.1", "25.1", "26.1"] },
    { "id": 12, "tasks": ["22.1", "24.1"] },
    { "id": 13, "tasks": ["28.1", "29.1", "30.1", "31.1", "32.1"] }
  ]
}
```
