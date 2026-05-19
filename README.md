# FeiSync

将 GitLab 仓库中 `.kiro/specs/**/tasks.md` 的任务进度自动同步到飞书多维表格。

## 工作原理

```
sync.sh → git clone/pull 目标仓库 → 扫描 .kiro/specs/ → 解析 tasks.md → diff → 写入飞书表
```

脚本通过 [lark-cli](https://github.com/larksuite/cli) 访问飞书 API（OAuth 个人登录，无需创建应用）。

## 首次配置

### 1. 安装依赖

```bash
git clone https://gitlab.com/zach-moon/feishu-sync.git
cd feishu-sync
```

需要 Node.js 20+，然后：

```bash
cd scripts && npm install && cd ..
```

### 2. 安装并登录 lark-cli

```bash
npx @larksuite/cli@latest install
lark-cli config init          # 按提示操作（会打开浏览器）
```

登录时需要一次性授权所有需要的权限：

```bash
lark-cli auth login --scope "base:app:read base:app:update base:table:read base:table:create base:field:read base:field:create base:field:update base:field:delete base:record:read base:record:create base:record:update base:record:delete im:message im:message.send_as_user im:chat:read"
```

这些权限的用途：
| 权限 | 用途 |
|------|------|
| `base:app:read` | 读取多维表格 |
| `base:table:read/create` | 读取/创建表 |
| `base:field:read/create/update/delete` | 自动创建和管理字段 |
| `base:record:read/create/update/delete` | 读写记录 |
| `im:message` | 发送消息（日报） |
| `im:message.send_as_user` | 以个人身份发消息到群 |
| `im:chat:read` | 读取群列表（获取 chat_id） |

### 3. 创建飞书多维表格

在飞书里新建一个「多维表格」，不需要手动建字段——脚本首次运行时会自动创建所有需要的列。

### 4. 配置 .env

```bash
cd scripts
cp .env.example .env
```

编辑 `.env`，填入两个必填项：

```env
# 粘贴飞书表的完整 URL
FEISHU_TABLE_URL="https://xxx.feishu.cn/base/bascnXXX?table=tblXXX"

# 目标仓库的 SSH 地址
GITLAB_REPO_URL=git@gitlab.example.com:group/project.git
GITLAB_BRANCH=main
```

### 5. 获取飞书群 chat_id（日报功能需要）

```bash
lark-cli im +chat-list --format json
```

输出中找到目标群的 `chat_id`（格式为 `oc_xxxx`），加到 `.env`：

```env
FEISHU_CHAT_ID=oc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> 如果不需要日报功能，可以跳过这步。

### 6. 运行

```bash
cd ..
./scripts/sync.sh
```

首次运行会自动：
- clone 目标仓库
- 在飞书表中创建所需字段（status 为单选类型）
- 清理空行
- 写入所有任务数据

## 日常使用

### 手动同步

```bash
./scripts/sync.sh
```

### 定时任务（每 30 分钟自动同步）

```bash
crontab -e
```

添加：
```
*/30 * * * * /path/to/feishu-sync/scripts/sync.sh >> /tmp/feisync.log 2>&1
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

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_TABLE_URL` | ✅ | 飞书多维表格完整 URL |
| `GITLAB_REPO_URL` | ✅* | 目标仓库 SSH 地址 |
| `GITLAB_BRANCH` | ❌ | 分支名，默认 `main` |
| `REPO_ROOT` | ✅* | 或者用本地仓库路径（与 GITLAB_REPO_URL 二选一） |
| `DRY_RUN` | ❌ | `true` 时不写飞书 |
| `FORCE_SYNC` | ❌ | `true` 时跳过移除保护 |
| `REMOVED_PROTECTION_THRESHOLD` | ❌ | 默认 `0.30` |
| `CSV_OUTPUT_PATH` | ❌ | 设置后输出 CSV 诊断文件 |

## 飞书表字段（自动创建）

| 列名 | 类型 | 说明 |
|------|------|------|
| 文本 | 文本（主字段） | Spec ID（目录名） |
| title | 文本 | 任务标题 |
| description | 文本 | 子任务详情 |
| status | 单选 | `未开始` / `进行中` / `已完成` / `已移除` / `已验收` |
| primaryOwner | 文本 | 主负责人 |
| backupOwner | 文本 | 备份负责人 |
| commitShaShort | 文本 | 同步时的 commit SHA |
| time | 文本 | 最后同步日期 |

## 特殊行为

- **已验收**：飞书表中 status 为「已验收」的记录不会被脚本覆盖
- **移除保护**：如果一次同步中超过 30% 的任务将被标记为「已移除」，脚本会中止
- **token 续期**：lark-cli 的 OAuth token 7 天有效，只要定时任务正常运行就会自动续期

## 换电脑部署

1. clone 本项目 + 安装依赖
2. `lark-cli auth login --recommend`（重新登录飞书）
3. 编辑 `scripts/.env`（飞书表 URL 不变，仓库地址不变）
4. `./scripts/sync.sh`
