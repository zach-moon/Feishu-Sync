# FeiSync — Kiro Spec 进度同步到飞书多维表格

将业务仓库 `.kiro/specs/**/tasks.md` 中的顶层任务进度同步到飞书多维表格。

## 飞书表字段

在飞书多维表格中需要以下字段（全部为文本类型）：

| 字段名 | 说明 |
|--------|------|
| SpecID | spec 目录名 |
| title | 任务标题（含编号） |
| status | 状态：`未开始` / `进行中` / `已完成` / `已移除` |
| primaryOwner | 主负责人（从 owners.md 读取） |
| backupOwner | 备份负责人（从 owners.md 读取） |
| commitShaShort | 触发同步时的 git commit SHA |
| time | 最后同步时间 |

## 本地使用

### 前置条件

- Node.js 20+
- [lark-cli](https://github.com/larksuite/cli) 已安装并登录

### 安装 lark-cli

```bash
npx @larksuite/cli@latest install
lark-cli config init      # 按提示配置（会打开浏览器）
lark-cli auth login --recommend  # OAuth 登录
```

### 配置

```bash
cd scripts
cp .env.example .env
# 编辑 .env，填入：
#   FEISHU_APP_TOKEN=<从飞书表 URL 中提取>
#   FEISHU_TABLE_ID=<从飞书表 URL 中提取>
#   REPO_ROOT=<目标仓库绝对路径>
```

飞书表 URL 格式：`https://xxx.feishu.cn/base/<APP_TOKEN>?table=<TABLE_ID>`

### 运行

```bash
cd scripts

# Dry-run（不写飞书，只看解析结果）
DRY_RUN=true npx tsx src/sync-to-feishu.ts

# 真正同步
npx tsx src/sync-to-feishu.ts

# 输出 CSV 诊断文件
CSV_OUTPUT_PATH=/tmp/preview.csv DRY_RUN=true npx tsx src/sync-to-feishu.ts
```

## GitLab CI 接入

### 前置条件

- 飞书管理员审批自建应用
- 在飞书多维表格中授权该应用

### 配置 CI Variables

在 GitLab 项目 → Settings → CI/CD → Variables 中添加：

| Variable | Type | Flags |
|----------|------|-------|
| `FEISHU_APP_ID` | Variable | Protected |
| `FEISHU_APP_SECRET` | Variable | Protected + Masked |
| `FEISHU_APP_TOKEN` | Variable | Protected |
| `FEISHU_TABLE_ID` | Variable | Protected |

### CI Job

`.gitlab-ci.yml` 中已包含 `sync-to-feishu` 作业，会在以下情况触发：

- push 到默认分支且 `.kiro/specs/**` 有变化
- MR 合并且 `.kiro/specs/**` 有变化
- 手动触发（设置 `FORCE_SYNC=true`）

## 环境变量参考

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_TOKEN` | ✅ | 飞书多维表格 app_token |
| `FEISHU_TABLE_ID` | ✅ | 飞书多维表格 table_id |
| `REPO_ROOT` | 本地必填 | 目标仓库绝对路径（CI 下默认 `$CI_PROJECT_DIR`） |
| `DRY_RUN` | ❌ | `true` 时不写飞书 |
| `FORCE_SYNC` | ❌ | `true` 时跳过移除保护阈值 |
| `REMOVED_PROTECTION_THRESHOLD` | ❌ | 默认 `0.30`（30%） |
| `CSV_OUTPUT_PATH` | ❌ | 设置后输出 CSV 诊断文件 |
