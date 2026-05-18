# Verification Document

## Overview

本文档为 [requirements.md](./requirements.md) 与 [design.md](./design.md) 提供测试策略与可执行的正确性属性。

脚本规模约 400–600 行，没有长期运行的状态机、没有持久化存储，绝大多数风险集中在「解析正确性」与「飞书写入幂等」两处。整体测试策略：

- 大部分代码路径用 example-based 单测即可覆盖；
- 仅在「解析-序列化往返」「diff 分区律」「secret 不泄露」三处保留属性测试，作为高价值不变量门禁。

## Correctness Properties

### Property 1: 解析-序列化往返一致

*For any* 由 `taskListArbitrary` 生成的合法 markdown 文本 `T`（生成器覆盖 `[ ]` / `[x]` / `[X]` / `[-]` 四种 List_Task 字面量、Heading_Task 与 Subgroup_Heading、`*` 可选标记、嵌套子项与说明性 bullet），`parse(serialize(parse(T)))` 与 `parse(T)` 在每个 item 的 `(taskNumber, title, status, progress, optional, source)` 字段上逐项相等。

**Validates: Requirement 2.4 ~ 2.10、2.12、2.13（解析的确定性、状态四态、Subgroup_Heading 跳过规则）**

### Property 2: Diff 分区律

*For any* 由 `normalizedRowArbitrary` 生成的两份 `prev: NormalizedRow[]` 与 `curr: NormalizedRow[]`，`diff(prev, curr)` 输出的 `{ created, updated, removed }` 三集合满足：

- 按 `uniqueId` 互不相交；
- `created.uniqueIds === keys(curr) − keys(prev)`；
- `removed.uniqueIds === keys(prev) − keys(curr)`；
- `updated.uniqueIds ⊆ keys(prev) ∩ keys(curr)`；
- 三集合 + unchanged 的并集 = `keys(prev) ∪ keys(curr)`。

**Validates: Requirement 5.2, 5.3, 5.4**

### Property 3: Secret 永不出现在日志

*For any* 由 zod 校验通过的随机 `Config`（含 `feishuAppSecret`、`feishuAppToken`、`feishuTableId`），运行一次端到端流程（用 nock mock 飞书 API，覆盖 success / dry-run / aborted_protection / partial-failure 各分支），断言：

- 捕获的 stdout / stderr 字符串中不包含上述三个 secret 中任一完整值；
- 仅允许出现 `mask(secret, 4)` 形式（前 4 位 + `***`）；
- 异常 stack 中也不含完整 secret。

**Validates: Requirement 8.3**

### Property 4: Unique_Id 派生函数稳定

*For any* `(specId, taskPath, title)`，相同输入 → 相同 `uniqueId`；任一字段改变 → 不同 `uniqueId`（碰撞概率忽略，sha256 假设下）。

**Validates: Requirement 3.1, 3.2, 3.3**

### Property 5: 移除保护幂等

*For any* 触发移除保护的输入 `(prev, curr)`（即 `removedRatio >= 0.30 && !FORCE_SYNC`）：

- 飞书 mock 的 `create / update / delete` 调用次数全部为 0；
- 进程退出码为 1；
- stdout 中包含 `ABORTED_PROTECTION` 关键字与全部 `removed` uniqueId 列表。

**Validates: Requirement 6.3, 6.4**

### Property 6: 状态四态聚合一致

*For any* 由 `taskRowsArbitrary` 生成的 `TaskRow[]`（每条 status 取自 `{not_started, in_progress, done}`），`aggregateSpecStatus(taskRows)` 满足：

- 空数组 → `{ status: 'not_started', progress: 0 }`；
- 全 done → `{ status: 'done', progress: 100 }`；
- 全 not_started → `{ status: 'not_started', progress: 0 }`；
- 其余（含任意 in_progress 或 done/not_started 混合）→ `status === 'in_progress'`，且 `progress === floor(donesCount / total * 100)`，`progress ∈ [0, 99]`。

并且对 Heading_Task 的 `aggregateHeadingStatus(contributors)` 对称满足：

- 空 contributors → `not_started / 0`；
- 全 done → `done / 100`；
- 全 not_started → `not_started / 0`；
- 含 in_progress 或 done/not_started 混合：`donesCount > 0` → `progress = floor(donesCount / total * 100)` 且 `∈ [1, 99]`；`donesCount === 0` → `progress = 1`。

**Validates: Requirement 2.6, 2.7, 2.12, 4.3, 4.5**

### Property 7: CSV 输出无副作用 + RFC 4180 兼容

*For any* 由 `normalizedRowArbitrary` 生成的 `(specRows, taskRows)`，向临时路径写出 CSV：

- `writeCsv` 返回 `{ ok: true, rows: specRows.length + taskRows.length }`；
- 文件首行恰为表头 `unique_id,type,spec_id,task_number,title,status,progress,optional,source_path,parent_unique_id`；
- 用 `papaparse` / 等价 RFC 4180 解析器读回得到的二维数组，列数与 row 数与输入完全对齐；
- 任意输入 `title` 包含 `,` / `"` / `\n` / `\r` 时仍能 round-trip 解析无损；
- 当 `writeCsv` 由于路径不可写返回 `{ ok: false, reason }`，**主流程的飞书 mock 调用次数与不设 `csvOutputPath` 时完全一致**（CSV 失败不影响 diff、移除保护、写入与最终退出码）。

**Validates: Requirement 12.1 ~ 12.5**

## Testing Strategy

### 层次

```
tests/
  unit/                          # ~80% 覆盖率目标
    config.spec.ts               # 缺字段、URL 校验、freeze、CSV_OUTPUT_PATH 可选解析
    scanner.spec.ts              # 排除 _* / .* / 散文件、no_tasks_file 标签、确定性排序
    parser.spec.ts               # [ ] / [x] / [X] / [-] 四态、嵌套 checkbox、Subgroup_Heading 跳过、噪声跳过
    normalizer.spec.ts           # uniqueId 派生、冲突检测、四态聚合、deriveSpecTitle 回退
    diff.spec.ts                 # created / updated / removed 边界
    csvWriter.spec.ts            # RFC 4180 转义、UTF-8/LF、目录不可写时返回 { ok: false }
    reporter.spec.ts             # 输出格式 + mask 行为 + ignored entries 段
  property/
    parser.roundtrip.prop.ts     # Property 1（含 [-] 与 Subgroup_Heading）
    diff.partition.prop.ts       # Property 2
    secrets.never.leak.prop.ts   # Property 3
    uniqueId.stable.prop.ts      # Property 4
    aborted.protection.prop.ts   # Property 5
    status.aggregation.prop.ts   # Property 6（aggregateSpec/HeadingStatus）
    csv.no_side_effect.prop.ts   # Property 7
  integration/
    e2e.success.spec.ts          # nock mock 飞书 API, 全链路 success（含 in_progress、specTitle）
    e2e.aborted.spec.ts          # 全链路 aborted_protection
    e2e.dry_run.spec.ts          # 全链路 dry-run（断言 CSV 仍写出）
    e2e.partial_failure.spec.ts  # 飞书 mock 返回部分 5xx, 验证退出码 1
    e2e.csv_disabled.spec.ts     # 不设 CSV_OUTPUT_PATH，断言无 CSV 文件副作用
```

### 工具链

- **Vitest** + **fast-check**：TypeScript 原生集成、watch 模式快、PBT 生态成熟。
- **nock**：拦截 `@larksuiteoapi/node-sdk` 的 outbound 请求，避免真访问飞书 API。
- **memfs**：在单测中虚拟仓库目录，避免在真实 fs 中创建临时文件。
- **`execa`**：集成测试中以子进程方式启动脚本，捕获 stdout / stderr / exit code。

### 不适合 PBT 的部分

| Requirement | 验证方式 | 理由 |
|---|---|---|
| Req 1.x（CI 触发规则） | 单测 + GitLab CI Lint API | rules 语义由 GitLab 解释，单测只能验证 yaml 合法性 |
| Req 5.5（写入顺序 spec → task） | 1 个集成测试 | 用 nock 顺序断言，单例足够 |
| Req 5.6（批量 ≤ 500） | 单测 | 注入 1200 条记录，断言切成 3 批 |
| Req 11.x（仓库交付物） | 在 CI 中加 `ls scripts/` 检查 + dependabot 检查 | 文件存在性无需 unit test |

### CI 运行

仓库自身的 CI 配置（不是用户业务仓库的）：

```yaml
test:
  image: node:20-alpine
  script:
    - cd scripts && npm ci
    - npm run lint
    - npm run test                # vitest run + property tests
    - npm run test:integration    # vitest run --config integration
```

CI 失败即合并阻塞。

### Property 测试运行约束

- `fc.configureGlobal({ numRuns: 100 })`；`Property 1 / 3` 调高到 500（roundtrip + secret 是高价值不变量）。
- 固定 seed 通过环境变量 `FAST_CHECK_SEED` 传入 CI，便于失败复现。
- 单 property 测试运行时间预算 ≤ 2s。

