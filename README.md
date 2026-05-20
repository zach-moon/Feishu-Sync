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

## 前置条件

- Node.js 20+（项目根有 `.nvmrc`，nvm/fnm 会自动切到正确版本）
- Git
- **飞书企业版**（个人版不支持 lark-cli OAuth 登录和多维表格 API）
- 目标仓库的 SSH 访问权限（如果用 SSH 地址）

> 已在 macOS / Linux / Windows (PowerShell + WSL) 上验证可用。
> ⚠️ 本工具通过 [lark-cli](https://github.com/larksuite/cli)（飞书官方命令行工具）访问飞书 API，使用 OAuth 个人登录。飞书个人版无法使用。

## 快速开始

### 第一步：克隆本项目

```bash
git clone https://gitlab.com/zach-moon/feishu-sync.git
# 或
git clone https://github.com/zach-moon/Feishu-Sync.git
cd feishu-sync
```

### 第二步：安装依赖

```bash
npm install
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
cp .env.example .env
```

编辑 `.env`：

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

### 第七步：首次手动运行验证

先手动跑一次，确认能正常 clone 仓库、创建字段、写入数据：

```bash
# macOS / Linux
./sync.sh

# Windows PowerShell
.\sync.ps1

# 跨平台通用方式
npm run sync       # 仅同步
npm run report     # 仅日报
```

首次运行会自动：

1. Clone 目标仓库到 `.repos/`
2. 在飞书表中创建所需字段（status 为单选类型）
3. 清理默认空行
4. 写入所有任务数据
5. 保存快照（用于日报对比）

确认手动跑通过后，再按下方对应平台的指引配置定时任务。

## 定时任务配置

不同操作系统下推荐的调度机制不同。**先选你的平台，再按对应步骤配置：**

| 平台 | 推荐方案 | 原因 |
|------|---------|------|
| macOS | **launchd LaunchAgent**（`./install-launchd.sh`） | 用户 session 内运行，能访问 Keychain（lark-cli 必需）和受保护目录 |
| Linux | cron（`./start-cron.sh`） | 标准方案，环境干净 |
| Windows | 任务计划程序（Task Scheduler） | 系统原生 |

> ⚠️ **macOS 不要用 cron。** macOS 的 cron 跑在系统级守护进程里，不在用户登录 session：
> 1. 拿不到 Keychain → lark-cli 发飞书会失败
> 2. 访问不了 `~/Documents`、`~/Desktop` 等受保护目录
> launchd LaunchAgent 没这两个问题。

### macOS：launchd（推荐）

项目已经预置好两个 plist 文件（`launchd/com.feisync.sync.plist`、`launchd/com.feisync.report.plist`），一行命令就能装上：

```bash
./install-launchd.sh
```

会自动完成：

- 把 plist 复制到 `~/Library/LaunchAgents/`
- 调用 `launchctl load` 加载
- 创建日志目录 `~/Library/Logs/feisync/`

默认调度：

| 任务 | 频率 | 日志位置 |
|------|------|---------|
| `com.feisync.sync` | 每小时整点 | `~/Library/Logs/feisync/sync.log` |
| `com.feisync.report` | 每天 17:00 | `~/Library/Logs/feisync/report.log` |

**常用管理命令：**

```bash
# 查看是否已加载
launchctl list | grep com.feisync

# 立即手动触发（测试用，等同于到点自动执行）
launchctl kickstart -k "gui/$(id -u)/com.feisync.sync"
launchctl kickstart -k "gui/$(id -u)/com.feisync.report"

# 看实时日志
tail -f ~/Library/Logs/feisync/sync.log
tail -f ~/Library/Logs/feisync/report.log

# 卸载
./install-launchd.sh uninstall
```

**改频率：** 编辑 `launchd/com.feisync.sync.plist` 或 `com.feisync.report.plist` 里的 `StartCalendarInterval`，然后重跑 `./install-launchd.sh`（会自动 unload 再 load）。

举例，把同步改成每 30 分钟一次：

```xml
<!-- 替换原来的 StartCalendarInterval 为 StartInterval（秒） -->
<key>StartInterval</key>
<integer>1800</integer>
```

或者保留整点触发改成每 2 小时：

```xml
<key>StartCalendarInterval</key>
<array>
  <dict><key>Minute</key><integer>0</integer><key>Hour</key><integer>0</integer></dict>
  <dict><key>Minute</key><integer>0</integer><key>Hour</key><integer>2</integer></dict>
  <dict><key>Minute</key><integer>0</integer><key>Hour</key><integer>4</integer></dict>
  <!-- ... -->
</array>
```

### Linux：cron

```bash
./start-cron.sh
```

默认行为：

- 同步：每小时整点（`0 * * * *`）
- 日报：每天 17:00（`0 17 * * *`）
- 日志：`./logs/sync.log`、`./logs/report.log`

**自定义频率：** 编辑 `start-cron.sh` 里这两行：

```bash
SYNC_CRON="0 * * * * ..."
REPORT_CRON="0 17 * * * ..."
```

常用 cron 表达式：

| 需求 | 表达式 |
|------|--------|
| 每小时 | `0 * * * *` |
| 每 30 分钟 | `*/30 * * * *` |
| 每 2 小时 | `0 */2 * * *` |
| 工作时间每小时 | `0 9-18 * * 1-5` |
| 每天早 9 点 | `0 9 * * *` |
| 每天晚 10 点 | `0 22 * * *` |

修改后重新运行 `./start-cron.sh` 生效。

**管理命令：**

```bash
# 查看已设置的 cron
crontab -l | grep -F "$(pwd)"

# 删除当前项目的所有定时任务
crontab -l | grep -vF "$(pwd)" | crontab -
```

### Windows：任务计划程序

用 `schtasks` 命令行注册（PowerShell 管理员模式）：

```powershell
# 每小时同步（不发日报）
schtasks /Create /SC HOURLY /TN "FeiSync-Sync" `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\path\to\Feishu-Sync\sync.ps1 -NoReport"

# 每天 17:00 发日报
schtasks /Create /SC DAILY /ST 17:00 /TN "FeiSync-Report" `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\path\to\Feishu-Sync\sync.ps1 -ReportOnly"
```

**管理命令：**

```powershell
# 查看
schtasks /Query /TN "FeiSync-Sync"

# 立即触发（测试）
schtasks /Run /TN "FeiSync-Sync"

# 删除
schtasks /Delete /TN "FeiSync-Sync" /F
schtasks /Delete /TN "FeiSync-Report" /F
```

> Windows 也可以用 WSL + Linux cron 方案，注意 WSL 必须保持运行。

## 手动同步

```bash
# macOS / Linux
./sync.sh                # 同步 + 日报
./sync.sh --no-report    # 仅同步
./sync.sh --report-only  # 仅日报

# Windows PowerShell
.\sync.ps1
.\sync.ps1 -NoReport
.\sync.ps1 -ReportOnly

# 跨平台通用
npm run sync
npm run report
```

### 预览模式（不写飞书）

```bash
DRY_RUN=true npm run sync
```

### 强制同步（跳过移除保护）

```bash
FORCE_SYNC=true npm run sync
```

## 配置参考

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `FEISHU_TABLE_URL` | ✅ | — | 飞书多维表格完整 URL |
| `GIT_REPO_URL` | ✅* | — | 目标仓库地址（SSH 或 HTTPS） |
| `GIT_BRANCH` | ❌ | `main` | 分支名 |
| `REPO_ROOT` | ✅* | — | 或用本地仓库路径（与 GIT_REPO_URL 二选一） |
| `SPECS_PATH` | ❌ | `.kiro/specs` | Spec 目录相对路径 |
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

## 故障排查

| 现象 | 可能原因 | 解决 |
|------|---------|------|
| `command not found: lark-cli` | PATH 没有拿到 npm 全局目录 | 检查 `~/.npm-global/bin` 或 `/opt/homebrew/bin` 在 `$PATH`，必要时改 `sync.sh` 顶部的 `EXTRA_PATHS` |
| `lark-cli auth ...` 报 token 过期 | OAuth token 7 天没续就过期 | 重新跑 `lark-cli auth login --scope "..."` |
| macOS cron 任务跑了但没发飞书 | cron 拿不到 Keychain | 改用 launchd（`./install-launchd.sh`） |
| launchd 装好了但没触发 | 系统休眠错过了时间点 | launchd 不会补跑，可加 `<key>StartInterval</key>` 兜底 |
| `git pull` 失败 | SSH key 没加 | `ssh -T git@github.com` 验证 |
| 任务全部被标记「已移除」 | tasks.md 路径或格式变了 | 用 `DRY_RUN=true` 预览，必要时 `FORCE_SYNC=true` |

## 目录结构

```
feishu-sync/
├── README.md
├── .gitignore
├── .nvmrc                          # 锁定 Node 版本
├── .env.example                    # 配置模板
├── .env                            # 实际配置（不提交 git）
├── package.json
├── tsconfig.json
├── sync.sh                         # 同步脚本（macOS / Linux）
├── sync.ps1                        # 同步脚本（Windows PowerShell）
├── start-cron.sh                   # 一键设置 cron（Linux）
├── install-launchd.sh              # 一键安装 LaunchAgent（macOS）
├── launchd/
│   ├── com.feisync.sync.plist      # macOS 同步任务定义
│   └── com.feisync.report.plist    # macOS 日报任务定义
├── logs/                           # 运行日志（自动创建，不提交）
└── src/
    ├── sync-to-feishu.ts           # 入口
    ├── sync.ts                     # 主流程编排
    ├── config.ts                   # 配置加载与校验
    ├── scanner.ts                  # Spec 目录扫描
    ├── parser.ts                   # tasks.md 解析
    ├── normalizer.ts               # 归一化 + owners.md 读取
    ├── diff.ts                     # 差异计算
    ├── feishu.client.ts            # 飞书 API 客户端（通过 lark-cli）
    ├── reporter.ts                 # 日志格式化输出
    ├── snapshot.ts                 # 快照保存与清理
    ├── daily-report.ts             # 日报生成 + 飞书群发送
    ├── csvWriter.ts                # CSV 诊断输出
    ├── types.ts                    # 类型定义
    └── utils/
        ├── hash.ts                 # SHA-256 哈希
        └── mask.ts                 # 敏感信息脱敏
```

## 认证说明

- 使用 [lark-cli](https://github.com/larksuite/cli) 的 OAuth 个人登录，无需创建飞书应用
- Token 有效期 7 天，自动续期——只要定时任务正常运行就永不过期
- 超过 7 天没跑需要重新 `lark-cli auth login --scope "..."`
