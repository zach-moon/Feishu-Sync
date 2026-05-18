# Requirements Document

## Introduction

本特性提供一套轻量同步脚本，将业务仓库中 `.kiro/specs/**/tasks.md` 的 Kiro spec 进度同步到一张 **飞书多维表格（Bitable）** 中。表格采用扁平结构：每条记录对应一个 TopLevel_Task（顶层任务），通过 `Spec ID` 字段标识其所属 spec。

脚本支持两种触发方式：

- **本地 CLI 模式**：开发者在工作机直接运行 `tsx scripts/sync-to-feishu.ts`，可通过 `REPO_ROOT` 环境变量指向任意外部仓库（如 `~/Documents/project/sproboagent`）；从 `.env` 文件加载飞书表配置。飞书 API 访问通过 `lark-cli`（官方 Lark CLI 工具）的 OAuth 缓存凭证完成。
- **GitLab CI 模式**：当业务仓库接入 GitLab Pipeline 后，由 push 或 merge request merge 自动触发，从 CI/CD Variables 注入 `LARK_APP_ID` + `LARK_APP_SECRET` 完成应用鉴权。

两种模式共用同一个解析与写入主流程，**不依赖任何常驻服务、不维护任何额外的存储后端**。飞书表本身即为权威状态来源。

本特性面向「3–5 人小团队、单仓库或少量仓库、目的仅为方便办公」的场景设计，强调零运维与低接入成本。

## Glossary

- **Sync_Script**: 同步脚本 `scripts/sync-to-feishu.ts`，可由本地 CLI 或 GitLab CI 调用执行。
- **Local_CLI_Mode**: 开发者在工作机直接运行 `tsx scripts/sync-to-feishu.ts` 触发的执行模式。
- **CI_Mode**: 由 GitLab Pipeline 触发执行 Sync_Script 的执行模式，对应仓库内 `.gitlab-ci.yml` 中名为 `sync-to-feishu` 的作业。
- **Repo_Root**: 待扫描的业务仓库根目录绝对路径。CI 模式下默认为 `$CI_PROJECT_DIR`；本地 CLI 模式下由 `REPO_ROOT` 环境变量显式指定。
- **Spec_Dir**: `<Repo_Root>/.kiro/specs/<specId>/` 形式的目录，每个目录代表一个 Kiro spec。
- **Spec_Id**: Spec_Dir 的目录名（如 `user-login`），仓库内唯一。
- **Tasks_File**: 单个 Spec_Dir 下的 `tasks.md` 文件。
- **TopLevel_Task**: Tasks_File 中识别出的一条**顶层任务**。它是同步到飞书表的最小粒度。识别规则见 Requirement 2，包含两种语法：顶层 checkbox 列表项（List_Task）与顶层 H3 编号标题（Heading_Task）。
- **List_Task**: 顶层 checkbox 列表项形式的 TopLevel_Task，例如 `- [x] 23. 屏蔽词四阶段检查` 或 `- [ ] **AZ-2.1 验证 Admin Zone Plugin 注册**`。状态由复选框直接决定，包含 `[ ]` / `[x]` / `[X]` / `[-]` 四种合法字面量。
- **Heading_Task**: 顶层 H3 编号标题形式的 TopLevel_Task，例如 `### 2. 数据库 Schema 设计与迁移` 或 `### Task 1: 项目初始化`。状态由其下属的子 checkbox 汇总得到。Heading_Task 的判定见 Requirement 2.4，需同时满足「文本匹配 Task_Number 正则」与「直系子 list 至少含 1 条 `checked != null` 的 listItem」。
- **Subgroup_Heading**: 仅作分组排版、不视为 TopLevel_Task 的 H3 标题。典型形态为 `### 4.2 子分组` 这类「数字.数字 + 文本」但其下并不直接挂带复选框的 list 的标题；Subgroup_Heading 不会进入 Task_Row 输出，但其下属深度 0 的 List_Task 仍按 List_Task 路径正常识别。
- **Task_Number**: TopLevel_Task 的编号字符串，如 `1`、`23`、`AZ-2.1`、`AGA-3.1`、`0.1`、`3.8A`、`Task 1`、`ACSM-1`。识别正则见 Requirement 2.5。
- **In_Progress_Status**: TopLevel_Task 的「进行中」状态。List_Task 复选框为 `[-]` 时为 In_Progress_Status；Heading_Task 在子项混合或存在 In_Progress_Status 子项时为 In_Progress_Status。进度归一化规则见 Requirement 2.12。
- **Spec_Row**: 内部数据模型中每个 Spec_Dir 对应的聚合记录（仅用于 CSV 诊断输出，不写入飞书表）。
- **Task_Row**: 飞书表中的记录行，每个 TopLevel_Task 对应恰好一条 Task_Row。
- **Unique_Id**: 行的内部业务主键（用于 CSV 诊断与 diff 逻辑）。飞书表 upsert 匹配使用 `Spec ID` + `标题` 组合。
- **Feishu_App**: 飞书自建应用，CI 模式下通过 `LARK_APP_ID` + `LARK_APP_SECRET` 提供应用身份；本地模式通过 `lark-cli auth login` 完成 OAuth 鉴权。
- **Bitable_App_Token**: 目标飞书多维表格的 `app_token`。
- **Bitable_Table_Id**: 目标飞书多维表格中具体一张表的 `table_id`。
- **CI_Variables**: GitLab 项目的 CI/CD Variables，用于安全注入 secret 类配置。
- **Dotenv_File**: 本地 CLI 模式下从中加载环境变量的 `.env` 文件，仅在 Local_CLI_Mode 启用。
- **Dry_Run_Mode**: 仅打印将执行的写入差异、不调用飞书写接口的运行模式。
- **Removed_Protection_Threshold**: 单次运行中允许标记为「已移除」的任务比例上限，默认 30%。
- **CSV_Output_Path**: 诊断 CSV 输出路径，由环境变量 `CSV_OUTPUT_PATH` 指定。当设置时，脚本将本次归一化得到的 Task_Row 以 CSV 形式落盘，仅用于本地排查解析正确性，不参与飞书同步逻辑。详见 Requirement 12。

## Requirements

### Requirement 1: 触发模式与执行入口

**User Story:** 作为开发者或运维方，我希望脚本既能在本地直接对外部仓库跑一次同步，也能在业务仓库接入 GitLab CI 后由 Pipeline 自动触发，从而既支持现阶段的本地手动同步，也支持后续的 CI 自动化同步。

#### Acceptance Criteria

1. THE Sync_Script SHALL 提供两种触发模式：Local_CLI_Mode 与 CI_Mode；两种模式共用同一份解析、归一化、diff、写入主流程。
2. WHEN 通过 `tsx scripts/sync-to-feishu.ts` 或 `node scripts/dist/sync-to-feishu.js` 启动且未设置 `CI=true`, THE Sync_Script SHALL 进入 Local_CLI_Mode。
3. WHILE 处于 Local_CLI_Mode, THE Sync_Script SHALL 从 `REPO_ROOT` 环境变量读取待扫描的业务仓库根目录的绝对路径；IF `REPO_ROOT` 缺失, THEN THE Sync_Script SHALL 退化为脚本工作目录（`process.cwd()`）。
4. WHILE 处于 Local_CLI_Mode, THE Sync_Script SHALL 在启动时尝试加载 `<Repo_Root>/.env` 与脚本所在目录下的 `.env` 文件以补全环境变量；显式 `process.env` 已存在的 key 优先级高于 `.env` 文件。
5. WHEN 仓库的 `.gitlab-ci.yml` 中定义了名为 `sync-to-feishu` 的 CI_Job 且由 GitLab Pipeline 调度执行, THE Sync_Script SHALL 进入 CI_Mode；该作业 SHALL 使用 `node:20-alpine` 镜像。
6. WHILE 处于 CI_Mode, THE Sync_Script SHALL 使用 `$CI_PROJECT_DIR` 作为 Repo_Root，且 SHALL NOT 加载 `.env` 文件，所有凭证只能来自 CI_Variables。
7. WHEN 仓库的默认分支发生 push 或一个 merge request 合并到默认分支, THE CI_Job SHALL 在对应 GitLab Pipeline 中被触发执行。
8. THE CI_Job SHALL 仅在 `.kiro/specs/**` 路径下的文件发生变化时被触发；其他文件变化 SHALL NOT 触发该作业。
9. WHEN 用户在 GitLab UI 上手动 Run Pipeline 时携带变量 `FORCE_SYNC=true`, THE CI_Job SHALL 强制运行一次同步（用于灾难恢复或首次接入）。
10. THE CI_Job SHALL 在不超过 10 分钟内完成执行；超过该时长 SHALL 由 CI 调度器中止。

### Requirement 2: 输入扫描与顶层任务解析

**User Story:** 作为同步流程，我希望从 Repo_Root 的快照中稳定地扫描出全部 Kiro spec，并按统一规则把每个 `tasks.md` 中的**顶层任务**抽出来，从而构建确定的、跨仓库一致的任务列表。

#### Acceptance Criteria

1. THE Sync_Script SHALL 在 Repo_Root 下扫描所有符合 `<Repo_Root>/.kiro/specs/<specId>/tasks.md` 模式的文件路径（即恰好二级目录形式的 spec 目录），输出 `{ specId, path }[]`；`<specId>` SHALL NOT 以 `_` 或 `.` 开头。
2. THE Sync_Script SHALL 显式忽略以下条目，不视其为 spec 输入：
   - `.kiro/specs/` 下直接挂的散文件（如 `.kiro/specs/README.md`、`.kiro/specs/foo.md`），不论后缀名；
   - 以下划线 `_` 开头的目录（如 `.kiro/specs/_legacy/`、`.kiro/specs/_archive/`），视为归档内容；
   - 以点 `.` 开头的目录与文件（如 `.kiro/specs/.cache/`、`.kiro/specs/.DS_Store`）；
   - 深度大于 2 的嵌套路径下的 `tasks.md`（如 `.kiro/specs/parent/child/tasks.md`），SHALL NOT 被视为 spec。
3. WHEN 一个 `.kiro/specs/<specId>/` 目录不存在 `tasks.md` 文件, THE Sync_Script SHALL 视该目录为非 spec 输入（典型如 `project-scope/` / `p0-release-plan/` / `p1-release-plan/` 等仅放 `requirements.md` / `feature-list.md` 的规划层目录），SHALL NOT 为其生成任何 Task_Row；该忽略事实 SHALL 通过 Requirement 2.13 的 `ignored entries` 摘要中的 `no_tasks_file` 标签可见。
4. THE Sync_Script SHALL 仅识别 Tasks_File 中的**顶层任务**为 TopLevel_Task；TopLevel_Task 的语法分两类：

   - **List_Task**：mdast 嵌套深度为 0 的 listItem 且其 `checked != null`（即 `[ ] / [x] / [X] / [-]` 之一）；该 listItem 第一个段落文本剥外层强调、trim 后能匹配 `Task_Number` 正则（见 2.5）。
   - **Heading_Task**：H3 标题（mdast `heading` 节点 `depth === 3`）且**同时满足**下列两条：
     - (a) 标题文本剥外层强调、trim 后能匹配 `Task_Number` 正则（含 `^Task\s+\d+\s*[:.]\s+` 形态）；
     - (b) 该 H3 与下一个同级或更高级 heading（或文件末尾）之间，存在至少一个直系子 list 中包含 `checked != null` 的 listItem 作为贡献子项。

     仅 (a) 命中而 (b) 不命中的 H3 标题（如 `### 4.2 子分组` 这类「数字.数字 + 分组文本」但其下并不直接挂带复选框的 list 的标题）SHALL 视为 Subgroup_Heading，不进入 Task_Row 输出。

   不属于以上两类的列表项与标题（含更深层 list、说明性 bullet、`## 阶段` 标题、Subgroup_Heading 等）SHALL NOT 被视为 TopLevel_Task。Subgroup_Heading 之下的深度 0 listItem 仍按 List_Task 路径正常识别。
5. THE Sync_Script SHALL 用以下正则识别 Task_Number（先剥去外层 `**...**` / `__...__` 强调标记，再 trim 后匹配）：

   ```
   ^(?:Task\s+\d+\s*[:.]\s+|([A-Z][A-Z]*(?:-[A-Z]+)*-)?\d+(?:\.\d+)*[A-Z0-9]*(?:[\.:]\s+|\s+))
   ```

   该正则覆盖以下样式（与目标项目 `sproboagent` 中实际出现的语法一一对应）：

   | 样例标题 | 命中前缀 | `taskNumber` |
   |---|---|---|
   | `23. 屏蔽词四阶段检查` | `23. ` | `23` |
   | `1. Infrastructure setup` | `1. ` | `1` |
   | `0.1 补齐页面设计文档` | `0.1 ` | `0.1` |
   | `1.4 MSW 浏览器端 Mock 配置` | `1.4 ` | `1.4` |
   | `AZ-2.1 验证 Admin Zone Plugin 注册` | `AZ-2.1 ` | `AZ-2.1` |
   | `AGA-7.0A Debug 权限 key 统一` | `AGA-7.0A ` | `AGA-7.0A` |
   | `ACSM-1 实现 xxx` | `ACSM-1 ` | `ACSM-1` |
   | `3.8A 某个增补任务` | `3.8A ` | `3.8A` |
   | `Task 1: 项目初始化` | `Task 1: ` | `Task 1` |

   `taskNumber` 字段为命中前缀去掉尾部 `[\.:]` 与空白后的字符串；标题文本为去除编号前缀后剩余的部分 trim 之后的原文。形如 `Task N: ...` 时 `taskNumber` 取 `Task N`。
6. WHEN 一个 List_Task 的复选框为 `[x]` 或 `[X]`, THE Sync_Script SHALL 将其状态设为 `done`、进度设为 100；WHEN 复选框为 `[ ]`, THE Sync_Script SHALL 将其状态设为 `not_started`、进度设为 0；WHEN 复选框为 `[-]`, THE Sync_Script SHALL 将其状态设为 `in_progress`、进度按 Requirement 2.12 的约定固定值（默认 50）填入。
7. WHEN 解析一个 Heading_Task, THE Sync_Script SHALL 扫描该 H3 与下一个同级或更高级标题（或文件末尾）之间的全部 mdast 顶层 listItem（即根级 list 的直系子项，深度 ≤ 1）作为「贡献子项」，记 `contributors`，并按以下规则聚合：

   - IF `contributors.length === 0`, THEN 状态为 `not_started`、进度为 0（注：在该情形下整个 H3 视为 Subgroup_Heading，按 2.4 不应进入 Task_Row 输出，本子句作为防御性约束保留）。
   - IF `contributors` 全部为 `[x]` / `[X]`, THEN 状态为 `done`、进度为 100。
   - IF `contributors` 全部为 `[ ]`, THEN 状态为 `not_started`、进度为 0。
   - IF `contributors` 至少含 1 条 `[-]`，或既有 `[x]` 又有 `[ ]` / `[-]` 的混合, THEN 状态为 `in_progress`、进度计算如下：
     - `donesCount > 0` 时进度为 `floor(donesCount / contributors.length * 100)`；
     - `donesCount === 0` 时进度为 Requirement 2.12 中约定的 in-progress 起始值（默认 1），以避免与 `not_started` 在 UI 上视觉混淆。

8. THE Sync_Script SHALL 把 `*` 标记位置识别出来作为 `optional` 字段：当列表项形如 `- [ ]* 1.5 ...` 或 `- [ ] * 1.5 ...`（星号在 `]` 后或被空格分隔）时 `optional = true`；其它情况 `optional = false`。`optional` 字段不影响 Task_Row 的状态判定。
9. THE Sync_Script SHALL 把 TopLevel_Task 的飞书显示标题构造为 `${taskNumber}${separator} ${title}` 完整保留，其中 `separator` 为编号在原文中实际使用的 `.` 或 `:`；例如 `23. 屏蔽词四阶段检查`、`AZ-2.1 验证 Admin Zone Plugin 注册`、`Task 1: 项目初始化`。SHALL NOT 修改其中的大小写或标点；SHALL 剥离外层 markdown 强调（`**`、`__`）。
10. THE Sync_Script SHALL 对相同的输入文件内容产生确定性输出：相同输入 SHALL 在不同次运行、不同平台、不同 Node 版本中产生顺序与字段完全一致的 TopLevel_Task 列表。
11. WHEN 一个 Tasks_File 中没有任何 TopLevel_Task 被识别出来, THE Sync_Script SHALL 在日志中输出 WARN 级提示（含 `specId` 与 `path`），但不视为错误，该 spec 不产生任何 Task_Row。
12. THE Sync_Script SHALL 使用以下 in-progress 进度归一化约定，确保 `progress` 字段对相同输入跨平台跨 Node 版本完全一致：

    - List_Task `[-]` 的进度恒为 `50`（约定的稳定确定中间值，便于飞书侧识别「正在进行但完成度未知」）。
    - Heading_Task `in_progress` 且 `donesCount > 0` 时，进度为 `floor(donesCount / contributors.length * 100)`，结果落在 `[1, 99]` 区间内；若按公式计算得到 `0`（理论上不可能，因为 `donesCount > 0`）或 `100`（理论上不可能，因为有非 `[x]` 项），SHALL 视为实现 bug 并由 normalize 阶段抛错。
    - Heading_Task `in_progress` 且 `donesCount === 0`（即所有 contributors 都是 `[ ]` 或 `[-]`，但至少含 1 条 `[-]`）时，进度恒为约定的 in-progress 起始值 `1`。
    - 上述三类 `in_progress` 进度 SHALL NOT 取 `0` 与 `100`，从而与 `not_started`（恒 0）、`done`（恒 100）在飞书数字字段上可视区分。
13. WHEN 扫描阶段完成（即 Requirement 2.1 / 2.2 中确定输入集合后），IF 存在被显式忽略的散文件、点开头条目、`_` 前缀目录、深度大于 2 的嵌套 `tasks.md`，或不含 `tasks.md` 的二级目录, THEN THE Sync_Script SHALL 在 CI 日志中以 INFO 级别输出一次 `ignored entries` 摘要，包含每条被忽略路径（相对 Repo_Root）与一项忽略原因标签（`stray_file` / `dot_prefix` / `underscore_prefix` / `depth_exceeded` / `no_tasks_file`）；该摘要 SHALL 仅输出一次、SHALL NOT 视为错误、SHALL NOT 阻断后续流程。
14. THE Sync_Script SHALL 为每个 spec 推导一个友好显示标题 `specTitle`，规则按以下顺序回退取首条命中：(a) 读取 `<Repo_Root>/.kiro/specs/<specId>/requirements.md` 文件并取其首个 `# `（H1）标题剥外层强调 + trim 后的文本；(b) 退化为 `specId` 自身。`specTitle` 仅用于 CSV 诊断输出与日志，不写入飞书表，且 IF `requirements.md` 不存在或读取失败, THEN 直接采用 (b) 不视为错误。

### Requirement 3: 唯一 ID 与层级关系

**User Story:** 作为同步流程，我希望每条飞书记录都拥有稳定的唯一 ID，并能够正确表达 spec 与顶层任务的父子层级，从而支持 upsert 与可视化树形展示。

#### Acceptance Criteria

1. THE Sync_Script SHALL 为每个 Spec_Dir 生成一条 Spec_Row 的 Unique_Id，格式为 `spec::<specId>`。
2. THE Sync_Script SHALL 为每个 TopLevel_Task 生成一条 Task_Row 的 Unique_Id，格式为 `task::<specId>::<taskHash>`，其中 `taskHash = sha256(taskNumber + '\x01' + title).slice(0, 16)`，仅由 `taskNumber` 与 `title`（已剥强调、已 trim、不含编号前缀的标题原文）决定。
3. THE `taskHash` SHALL 与该 spec 中其他 TopLevel_Task 的存在与否、与 H2 阶段标题（如 `## 阶段一：xxx`）、与 H3 子分组标题、与所属语法形式（List_Task / Heading_Task）无关；同一 `(taskNumber, title)` 在两种语法下产生相同 `taskHash`。
4. [Removed — no parent-child hierarchy in Feishu table; only Task_Row is written.]
5. WHEN 一次同步运行中两条不同的 TopLevel_Task 产生相同的 Unique_Id, THE Sync_Script SHALL 立即以非零退出码退出，输出冲突两条 TopLevel_Task 的 `specId` / `taskNumber` / `title` / 文件行号，且 SHALL NOT 对飞书表执行任何写入。

### Requirement 4: 飞书表字段映射

**User Story:** 作为同步流程，我希望将归一化后的任务字段写入飞书表的指定列，从而让用户在飞书表中看到一致的结构化信息。

#### Acceptance Criteria

1. THE Sync_Script SHALL 在飞书表中维护以下字段（首次运行时若字段缺失，由人工在飞书表中预先建好；脚本仅写入，不创建字段）：
   - `Spec ID`（文本，作为业务主键的一部分）
   - `标题`（文本，对应 `displayTitle`：`${taskNumber}${separator} ${title}`）
   - `状态`（单选：`未开始` / `已完成` / `已移除`）
   - `提交 SHA`（文本，完整 40 字符 commit hash；本地 CLI 模式下若无法读到 git HEAD 则留空）
   - `最后同步时间`（日期时间）
2. THE Sync_Script SHALL 按字段名匹配飞书表中的列；IF 飞书表中某个必填字段缺失, THEN THE Sync_Script SHALL 输出明确的缺失字段名与所需类型，并以非零退出码退出。
3. THE Sync_Script SHALL 仅写入 Task_Row（每个 TopLevel_Task 对应一条记录），不写入 Spec_Row（无父子层级）。
4. WHEN 写入 Task_Row, THE Sync_Script SHALL 将其「Spec ID」字段写入 `specId`、「标题」字段写入 `displayTitle`、「状态」字段写入对应中文单选值、「提交 SHA」字段写入完整 40 字符 commit hash、「最后同步时间」字段写入当前 ISO8601 时间戳。
5. THE Sync_Script SHALL 将内部状态值通过固定映射写入飞书：`not_started → 未开始`、`done → 已完成`、`removed → 已移除`。`in_progress` 状态的任务也映射为 `未开始`（飞书表不区分未开始与进行中）。

### Requirement 5: Upsert 与软移除

**User Story:** 作为同步流程，我希望以 upsert 方式写入飞书并以软移除处理消失的任务，从而保留历史可追溯性、避免重复行。

#### Acceptance Criteria

1. WHEN 一次同步开始, THE Sync_Script SHALL 通过 lark-cli 拉取目标表中全部记录的 `record_id`、`Spec ID` 与 `标题` 字段，并构建 `(specId, displayTitle) → record_id` 的内存映射。
2. WHEN 本次扫描得到一条 Task_Row 的 `(specId, displayTitle)` 组合在该映射中存在, THE Sync_Script SHALL 调用更新接口更新该记录；
3. WHEN 本次扫描得到一条 Task_Row 的 `(specId, displayTitle)` 组合在该映射中不存在, THE Sync_Script SHALL 调用创建接口新建一条记录；
4. WHEN 该映射中存在一条记录的 `(specId, displayTitle)` 组合在本次扫描中不再出现, THE Sync_Script SHALL 调用更新接口将该记录的「状态」字段更新为 `已移除`，SHALL NOT 调用任何物理删除接口。
5. THE Sync_Script SHALL 使用飞书 Bitable 的批量接口（每批不超过 500 条）以减少 API 调用次数。
6. IF 飞书 API 返回 429（限流）或 5xx, THEN THE Sync_Script SHALL 按 `Retry-After` 头或指数退避（250ms / 1s / 5s）重试最多 3 次。

### Requirement 6: 移除保护阈值

**User Story:** 作为运维方，我希望在一次同步将大量任务标记为「已移除」之前先进行保护性中止，从而避免误删除导致飞书表大面积失真。

#### Acceptance Criteria

1. THE Sync_Script SHALL 从环境变量 `REMOVED_PROTECTION_THRESHOLD` 读取阈值，默认值为 `0.30`。
2. WHEN 扫描与差异计算完成, THE Sync_Script SHALL 计算比例 `removedRatio = |removedUniqueIds| / max(|existingUniqueIds|, 1)`，其中 `existingUniqueIds` 仅包含飞书表中当前「状态 != 已移除」的记录。
3. IF `removedRatio >= REMOVED_PROTECTION_THRESHOLD` 且环境变量 `FORCE_SYNC` 不等于 `true`, THEN THE Sync_Script SHALL 以非零退出码退出，且 SHALL NOT 对飞书表执行任何写入。
4. WHEN 触发移除保护时, THE Sync_Script SHALL 在 CI 日志中输出本次将被移除的 Unique_Id 列表、`removedRatio` 数值与触发原因，便于人工排查。
5. WHEN 用户在 GitLab UI 上手动触发 pipeline 并设置 `FORCE_SYNC=true`, THE Sync_Script SHALL 跳过该阈值检查、按正常流程写入飞书。

### Requirement 7: Dry-Run 预览模式

**User Story:** 作为运维方，我希望在调试或首次接入时进行无副作用的预览，从而在不污染飞书数据的情况下验证脚本行为。

#### Acceptance Criteria

1. WHEN 启动时设置环境变量 `DRY_RUN=true`, THE Sync_Script SHALL 进入 Dry_Run_Mode（Local_CLI_Mode 与 CI_Mode 均适用）。
2. WHILE 处于 Dry_Run_Mode, THE Sync_Script SHALL 仍然完成扫描、解析、差异计算、飞书表查询等只读步骤。
3. WHILE 处于 Dry_Run_Mode, THE Sync_Script SHALL NOT 调用任何飞书写接口（`create` / `update` / `delete`）。
4. WHILE 处于 Dry_Run_Mode, THE Sync_Script SHALL 在日志中以表格或分组形式输出本次将执行的 `created / updated / removed / unchanged` 数量与每条对应的 Unique_Id 与标题。

### Requirement 8: 配置与凭证管理

**User Story:** 作为运维方与开发者，我希望以 GitLab CI/CD Variables（CI 模式）或本地 `.env` 文件（本地 CLI 模式）注入飞书凭证与目标表标识，从而避免在仓库代码中硬编码任何敏感信息。

#### Acceptance Criteria

1. THE Sync_Script SHALL 从以下环境变量读取配置：
   - `FEISHU_APP_TOKEN`（必填，对应 Bitable_App_Token，仓库专属）
   - `FEISHU_TABLE_ID`（必填，对应 Bitable_Table_Id，仓库专属）
   - `REPO_ROOT`（Local_CLI_Mode 下必填，指向待扫描业务仓库根目录的绝对路径；CI 模式下若设置则覆盖 `$CI_PROJECT_DIR`，否则取 `$CI_PROJECT_DIR`）
   - `REMOVED_PROTECTION_THRESHOLD`（可选，默认 `0.30`）
   - `DRY_RUN`（可选，默认 `false`）
   - `FORCE_SYNC`（可选，默认 `false`）
   - `CSV_OUTPUT_PATH`（可选，默认未设置；含义见 Requirement 12）
   - CI-only: `LARK_APP_ID`（CI_Mode 必填，飞书应用 App ID，用于 lark-cli app identity）
   - CI-only: `LARK_APP_SECRET`（CI_Mode 必填，飞书应用 App Secret，用于 lark-cli app identity）
   飞书 API 访问通过 `lark-cli`（官方 Lark CLI 工具）实现：
   - Local_CLI_Mode：开发者预先执行 `lark-cli auth login` 完成 OAuth 登录（无需管理员审批），脚本运行时 lark-cli 自动使用已缓存的用户凭证。
   - CI_Mode：通过 `LARK_APP_ID` + `LARK_APP_SECRET` 环境变量提供应用身份，lark-cli 自动获取 tenant_access_token。
2. WHILE 处于 Local_CLI_Mode, THE Sync_Script SHALL 在加载环境变量前依次尝试读取 `<Repo_Root>/.env` 与脚本所在目录的 `.env` 文件作为补充来源；显式存在的 `process.env` key 优先于 `.env` 文件中的同名 key；`.env` 文件不存在不视为错误。
3. WHILE 处于 CI_Mode, THE Sync_Script SHALL NOT 读取任何 `.env` 文件，所有配置只能来自 CI/CD Variables 与 CI 内置变量。
4. IF 任一必填变量缺失或为空字符串, THEN THE Sync_Script SHALL 以非零退出码退出，并在 stderr 中明确指出缺失的变量名（不打印任何变量值）。
5. THE Sync_Script SHALL NOT 在日志、stdout、stderr 或异常 stack 中输出 `LARK_APP_SECRET`、`FEISHU_APP_TOKEN`、`FEISHU_TABLE_ID` 与 `tenant_access_token` 的完整值；如需在日志中引用，仅显示前 4 位字符加 `***`。
6. THE Sync_Script SHALL 仅以 HTTPS 协议访问飞书 Open API，且 SHALL NOT 接受任何 `http://` 形式的 base URL。
7. THE 仓库交付物 SHALL 包含一份 `.env.example`（位于 `scripts/` 目录），列出全部环境变量名与示例占位值，且 SHALL NOT 包含任何真实凭证；`.gitignore` SHALL 排除 `scripts/.env`。
8. THE Sync_Script SHALL 依赖 `lark-cli` 作为飞书 API 后端。本地使用前需执行以下前置步骤：
   ```
   npx @larksuite/cli@latest install
   lark-cli config init
   lark-cli auth login --recommend
   ```
   CI 模式下通过 `LARK_APP_ID` + `LARK_APP_SECRET` 环境变量自动完成应用鉴权，无需手动登录。

### Requirement 9: 仓库与飞书表的独占关系

**User Story:** 作为运维方，我希望每个 GitLab 仓库独占一张飞书多维表格、且不同仓库之间互不干扰，从而让每个仓库的接入完全独立、配置简单清晰。

#### Acceptance Criteria

1. THE Sync_Script SHALL 假定 `FEISHU_APP_TOKEN` + `FEISHU_TABLE_ID` 指向的飞书表 **仅服务于当前 GitLab 仓库**，且该表中的全部记录都由本仓库的 CI 维护。
2. THE Sync_Script SHALL 在 `listAllRecords` 时拉取目标飞书表的全部记录，不带任何按仓库的服务端过滤条件。
3. THE Sync_Script SHALL NOT 在写入飞书表时增加任何「区分仓库来源」的字段；记录的归属由 `FEISHU_APP_TOKEN` + `FEISHU_TABLE_ID` 自身的隔离性保证。
4. THE 接入文档 SHALL 明确说明：每个新仓库需要在飞书侧单独创建一张多维表格，并在该仓库的 GitLab CI Variables 中配置专属的 `FEISHU_APP_TOKEN` 与 `FEISHU_TABLE_ID`。

### Requirement 10: 日志、可观测性与 CI 反馈

**User Story:** 作为运维方，我希望脚本运行结果在 CI 日志中清晰可读、失败时能快速定位原因，从而无需额外日志系统。

#### Acceptance Criteria

1. THE Sync_Script SHALL 在 CI 日志中按以下分段输出：扫描结果（spec 数 / task 数）、差异摘要（created / updated / removed / unchanged 数）、飞书写入结果（成功 / 失败计数）、最终结论（一行：`SUCCESS` / `DRY_RUN` / `ABORTED_PROTECTION` / `FAILED`）。
2. WHEN 任一飞书写入失败, THE Sync_Script SHALL 在 CI 日志中输出失败的 Unique_Id、阶段（`create` / `update` / `softRemove`）、HTTP 状态码或飞书业务错误码，且单条失败 SHALL NOT 中止其他记录的写入。
3. WHEN 一次同步全部写入完成后存在任意失败记录, THE Sync_Script SHALL 以非零退出码退出，使 CI Job 标记为失败，便于触发 GitLab 的失败通知。
4. THE Sync_Script SHALL 在日志中至少输出 `CI_PROJECT_PATH`、`CI_COMMIT_SHA`、`CI_PIPELINE_ID`、`CI_JOB_ID` 四个 CI 上下文字段，以支撑事后排查。

### Requirement 11: 仓库内交付物

**User Story:** 作为运维方，我希望本特性的交付物全部位于业务仓库内、易于复制到其他仓库，从而支持多项目低成本接入。

#### Acceptance Criteria

1. THE 本特性的交付物 SHALL 包含以下文件：
   - `scripts/sync-to-feishu.ts`（同步脚本源码）
   - `scripts/package.json`（仅声明 `remark`、`remark-gfm`、`unified` 等运行期依赖与 TypeScript 类型）
   - `scripts/tsconfig.json`
   - `.gitlab-ci.yml` 中的 `sync-to-feishu` 作业定义片段
   - `scripts/README.md`（描述如何在新仓库接入：安装 lark-cli → 复制文件 → 配置 CI Variables → 在飞书表中预建字段）
   前置依赖：`lark-cli`（通过 `npx @larksuite/cli@latest install` 安装），用于飞书 API 访问。
2. THE Sync_Script SHALL 仅依赖 npm 公开 registry 的包，且 SHALL NOT 引入任何需要编译的 native 模块（如 `better-sqlite3`），以保证在标准 `node:20-alpine` 镜像内开箱即用。
3. THE `.gitlab-ci.yml` 中的 `sync-to-feishu` 作业 SHALL 使用 `node:20-alpine` 作为镜像，并通过 `npm ci --prefix scripts` 安装依赖。
4. WHEN 接入新仓库时, THE 接入流程 SHALL 仅需以下三步：（a）复制 `scripts/` 目录与 `.gitlab-ci.yml` 中的作业定义；（b）在 GitLab 项目中配置必填的 CI/CD Variables；（c）在飞书表中确认或创建 Requirement 4.1 所列字段。

### Requirement 12: CSV 诊断输出

**User Story:** 作为开发者，我希望在本地排查 `tasks.md` 解析与归一化逻辑时能够拿到一份结构化的 CSV 快照，从而无需依赖飞书侧即可校验 SpecRow 与 TaskRow 的字段是否符合预期。

#### Acceptance Criteria

1. WHERE 环境变量 `CSV_OUTPUT_PATH` 已设置且非空字符串, THE Sync_Script SHALL 在解析与归一化完成后、调用任何飞书写接口之前（包括 Dry_Run_Mode 与正常写入模式），把本次归一化得到的全部 Task_Row 以 UTF-8 + LF 行尾的 CSV 格式写入 `CSV_OUTPUT_PATH`。
2. THE CSV 输出 SHALL 使用以下固定列顺序，并以首行作为表头：

   ```
   spec_id, task_number, title, status, progress, optional, source_path
   ```

   其中：`title` 写入 Task_Row 的 `displayTitle`（含编号前缀）；`status` 取内部值 `not_started` / `in_progress` / `done` / `removed`（不做飞书中文映射）；`progress` 为 `[0, 100]` 整数。CSV 字段值 SHALL 按 RFC 4180 处理换行、逗号与双引号转义。
3. WHILE 处于 Dry_Run_Mode, THE Sync_Script SHALL 仍然按 12.1 写出 CSV 文件；CSV 写入 SHALL NOT 被视为对飞书的写副作用，不与 Requirement 7.3 冲突。
4. IF `CSV_OUTPUT_PATH` 指向的目录不存在、路径不可写、磁盘空间不足或写入过程发生 I/O 错误, THEN THE Sync_Script SHALL 在日志中输出一条 WARN 级提示（包含 `CSV_OUTPUT_PATH` 与具体错误原因），并继续执行后续飞书同步流程，SHALL NOT 因 CSV 写入失败以非零退出码退出。
5. THE CSV 输出 SHALL NOT 参与飞书同步逻辑：CSV 内容、CSV 写入成功与否、CSV 文件是否存在，均 SHALL NOT 影响 diff 计算、移除保护判定、飞书写入或最终退出码（除单纯的 WARN 日志外）。
