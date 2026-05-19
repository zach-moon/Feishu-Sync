# Feishu-Sync

将任意 Git 仓库中的 Spec 任务进度（`tasks.md`）自动同步到飞书多维表格，并支持每日进度日报推送到飞书群。

## 功能

- 扫描仓库中的 `tasks.md` 文件，解析顶层任务的状态
- 自动同步到飞书多维表格（增量 upsert + 软移除）
- 自动创建飞书表字段（首次运行无需手动建表结构）
- 支持 `owners.md` 读取负责人信息
- 每日日报：对比昨日快照，推送变化摘要到飞书群
- 移除保护：防止误操作导致大面积数据丢失
- 已验收保护：飞书表中标记为「已验收」的记录不会被覆盖

## 快速开始

## 前置条件

- Node.js 20+
- Git
- **飞书企业版**（个人版不支持 lark-cli OAuth 登录和多维表格 API）
- 目标仓库的 SSH 访问权限（如果用 SSH 地址）

> ⚠️ 本工具通过 [lark-cli](https://github.com/larksuite/cli)（飞书官方命令行工具）访问飞书 API，使用 OAuth 个人登录。飞书个人版无法使用。

### 第一步：克隆本项目

```bash
git clone https://gitlab.com/zach-moon/feishu-sync.git
or
git clone https://github.com/zach-moon/Feishu-Sync.git
cd feishu-sync
```

### 第二步：安装依赖

```bash
cd scripts && npm install && cd ..
```

### 第三步：安装并登录 lark-cli

```bash
npx @larksuite/cli@latest install
lark-cli config init
```

登录时一次性授权所有需要的权限：

```bash
lark-cli auth login --scope "base:app:read base:app:update base:table:read base:table:create base:field:read base:field:create base:field:update base:field:delete base:record:read base:record:create base:record:update base:record:delete im:message im:message.send_as_user im:chat:read"
```

权限说明：

| 权限 | 用途 |
|------|------|
| `base:*` | 读写飞书多维表格（字段管理 + 记录读写） |
| `im:message` | 发送日报消息 |
| `im:message.send_as_user` | 以个人身份发消息到群 |
| `im:chat:read` | 获取群列表（用于查找 chat_id） |

### 第四步：创建飞书多维表格

在飞书中新建一个「多维表格」。不需要手动建字段——脚本首次运行时会自动创建。

### 第五步：配置 .env

```bash
cd scripts
cp .env.example .env
```

编辑 `scripts/.env`：

```env
# 必填：粘贴飞书多维表格的完整 URL
FEISHU_TABLE_URL="https://xxx.feishu.cn/base/bascnXXX?table=tblXXX"

# 必填：目标仓库地址（支持 GitLab / GitHub / 任何 git 仓库）
GIT_REPO_URL=git@gitlab.example.com:group/project.git
GIT_BRANCH=main
```

**飞书表 URL 怎么获取：** 打开飞书多维表格，浏览器地址栏的完整 URL 就是。

**仓库地址格式示例：**
```
git@gitlab.hirobot.in:cloud/sproboagent.git     # GitLab SSH
git@github.com:your-org/your-project.git        # GitHub SSH
https://github.com/your-org/your-project.git    # GitHub HTTPS（公开仓库）
```

### 第六步：获取飞书群 chat_id（日报功能）

```bash
lark-cli im +chat-list --format json
```

在输出中找到目标群的 `chat_id`（格式 `oc_xxxx`），加到 `.env`：

```env
FEISHU_CHAT_ID=oc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> 不需要日报功能可跳过此步。

### 第七步：运行

```bash
cd ..
./scripts/sync.sh
```

首次运行会自动：
1. Clone 目标仓库到 `scripts/.repos/`
2. 在飞书表中创建所需字段（status 为单选类型）
3. 清理默认空行
4. 写入所有任务数据
5. 保存快照（用于日报对比）

## 日常使用

### 定时任务（推荐）

一键设置定时任务（每小时同步 + 每天 17:00 发日报）：

```bash
./scripts/start-cron.sh
```

停止定时任务：
```bash
crontab -l | grep -v feisync | grep -v sync.sh | grep -v daily-report | crontab -
```

### 手动同步

```bash
./scripts/sync.sh
```

### 生成日报

```bash
cd scripts && npx tsx src/daily-report.ts
```

### 预览模式（不写飞书）

```bash
cd scripts
DRY_RUN=true npx tsx src/sync-to-feishu.ts
```

### 强制同步（跳过移除保护）

```bash
cd scripts
FORCE_SYNC=true npx tsx src/sync-to-feishu.ts
```

## 配置参考

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `FEISHU_TABLE_URL` | ✅ | — | 飞书多维表格完整 URL |
| `GIT_REPO_URL` | ✅* | — | 目标仓库地址（SSH 或 HTTPS） |
| `GIT_BRANCH` | ❌ | `main` | 分支名 |
| `REPO_ROOT` | ✅* | — | 或用本地仓库路径（与 GIT_REPO_URL 二选一） |
| `SPECS_PATH` | ❌ | `.kiro/specs` | Spec 目录相对路径（可自定义） |
| `FEISHU_CHAT_ID` | ❌ | — | 日报发送的飞书群 chat_id |
| `DRY_RUN` | ❌ | `false` | 预览模式 |
| `FORCE_SYNC` | ❌ | `false` | 跳过移除保护 |
| `REMOVED_PROTECTION_THRESHOLD` | ❌ | `0.30` | 移除保护阈值 |
| `CSV_OUTPUT_PATH` | ❌ | — | CSV 诊断输出路径 |

## 飞书表字段（自动创建）

| 列名 | 类型 | 说明 |
|------|------|------|
| 文本 | 文本（主字段） | Spec ID |
| title | 文本 | 任务标题（含编号） |
| description | 文本 | 子任务详情 |
| status | 单选 | `未开始` / `进行中` / `已完成` / `已移除` / `已验收` |
| primaryOwner | 文本 | 主负责人（从 owners.md 读取） |
| backupOwner | 文本 | 备份负责人 |
| commitShaShort | 文本 | 同步时的 commit SHA |
| time | 文本 | 最后同步日期 |

## 特殊行为

| 行为 | 说明 |
|------|------|
| 已验收保护 | 飞书表中 status 为「已验收」的记录不会被脚本覆盖 |
| 移除保护 | 单次同步中超过 30% 任务将被标记为「已移除」时，脚本中止 |
| 增量更新 | 只有 title / status / description / owner 变化的记录才会被更新 |
| commit + time | 只在记录被创建或更新时写入，unchanged 记录保持原值 |
| 快照清理 | 自动保留最近 7 天快照，超过的自动删除 |

## 目录结构

```
feishu-sync/
├── README.md
├── .gitignore
└── scripts/
    ├── sync.sh                     # 同步脚本（git pull + 同步）
    ├── start-cron.sh               # 一键设置定时任务
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── .env.example                # 配置模板
    ├── .env                        # 实际配置（不提交 git）
    ├── .gitignore
    └── src/
        ├── sync-to-feishu.ts       # 入口
        ├── sync.ts                 # 主流程编排
        ├── config.ts               # 配置加载与校验
        ├── scanner.ts              # Spec 目录扫描
        ├── parser.ts               # tasks.md 解析（List_Task + Heading_Task）
        ├── normalizer.ts           # 归一化 + owners.md 读取
        ├── diff.ts                 # 差异计算（created/updated/removed）
        ├── feishu.client.ts        # 飞书 API 客户端（通过 lark-cli）
        ├── reporter.ts             # 日志格式化输出
        ├── snapshot.ts             # 快照保存与清理
        ├── daily-report.ts         # 日报生成 + 飞书群发送
        ├── csvWriter.ts            # CSV 诊断输出
        ├── types.ts                # 类型定义
        └── utils/
            ├── hash.ts             # SHA-256 哈希
            └── mask.ts             # 敏感信息脱敏
```

## 换电脑部署

```bash
# 1. 克隆本项目
git clone https://gitlab.com/zach-moon/feishu-sync.git
cd feishu-sync

# 2. 安装依赖
cd scripts && npm install && cd ..

# 3. 安装 lark-cli
npx @larksuite/cli@latest install

# 4. 登录飞书（会打开浏览器授权）
lark-cli config init
lark-cli auth login --scope "base:app:read base:app:update base:table:read base:table:create base:field:read base:field:create base:field:update base:field:delete base:record:read base:record:create base:record:update base:record:delete im:message im:message.send_as_user im:chat:read"

# 5. 配置 .env（飞书表 URL + 仓库地址 + chat_id）
cd scripts
cp .env.example .env
# 编辑 .env 填入实际值

# 6. 配置 SSH key（如果目标仓库用 SSH 地址）
# 确保 ssh-keygen 生成的公钥已添加到 GitLab/GitHub

# 7. 手动跑一次验证
cd ..
./scripts/sync.sh

# 8. 设置定时任务（每小时同步 + 每天 17:00 日报）
./scripts/start-cron.sh
```

## 认证说明

- 使用 [lark-cli](https://github.com/larksuite/cli) 的 OAuth 个人登录，无需创建飞书应用
- Token 有效期 7 天，自动续期——只要定时任务正常运行就永不过期
- 超过 7 天没跑需要重新 `lark-cli auth login --scope "..."`
