# FeiSync — Kiro Spec 进度同步到飞书多维表格

将 GitLab 仓库中 `.kiro/specs/**/tasks.md` 的任务进度自动同步到飞书多维表格。

## 工作原理

```
定时任务 → git pull 目标仓库 → 扫描 .kiro/specs/ → 解析 tasks.md → diff → 写入飞书表
```

## 快速开始

```bash
git clone https://gitlab.com/zach-moon/feishu-sync.git
cd feishu-sync
./setup.sh    # 一键完成：安装依赖 + 飞书登录 + 配置 + 定时任务
```

## 配置说明

所有配置在 `scripts/.env` 文件中（从 `.env.example` 复制）。

### 必填项

| 变量 | 说明 | 获取方式 |
|------|------|----------|
| `FEISHU_APP_TOKEN` | 飞书多维表格标识 | 从飞书表 URL 提取：`/base/<这个>?table=...` |
| `FEISHU_TABLE_ID` | 飞书表中具体一张表 | 从飞书表 URL 提取：`?table=<这个>` |
| `REPO_ROOT` | 目标仓库本地路径 | 你 clone 下来的仓库绝对路径 |

### 目标仓库配置

先在部署机器上 clone 目标仓库，然后在 `.env` 中指定路径：

```bash
git clone git@gitlab.hirobot.in:cloud/sproboagent.git ~/repos/sproboagent
```

```env
REPO_ROOT=/home/user/repos/sproboagent
```

定时任务每次运行时会自动 `git pull` 获取最新代码。

### 运行模式

| 模式 | 配置 | 说明 |
|------|------|------|
| 正常同步 | `DRY_RUN=false` | 扫描 + 写入飞书（默认） |
| 预览模式 | `DRY_RUN=true` | 只扫描不写飞书，用于调试 |
| 强制同步 | `FORCE_SYNC=true` | 跳过移除保护阈值，用于首次接入 |
| CSV 输出 | `CSV_OUTPUT_PATH=/tmp/x.csv` | 额外输出 CSV 诊断文件 |

### 飞书表字段

在飞书多维表格中需要以下字段（全部为文本类型）：

| 字段名 | 说明 |
|--------|------|
| SpecID | spec 目录名 |
| title | 任务标题（含编号） |
| status | `未开始` / `进行中` / `已完成` / `已移除` |
| primaryOwner | 主负责人（从 owners.md 读取） |
| backupOwner | 备份负责人 |
| commitShaShort | 同步时的 git commit SHA |
| time | 最后同步时间 |

## 部署到服务器

### 1. 准备环境

```bash
# 安装 Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# clone 本项目
git clone https://gitlab.com/zach-moon/feishu-sync.git ~/feishu-sync

# clone 目标仓库
git clone git@gitlab.hirobot.in:cloud/sproboagent.git ~/repos/sproboagent
```

### 2. 运行安装脚本

```bash
cd ~/feishu-sync
./setup.sh
```

按提示输入飞书表 URL 和目标仓库路径即可。

### 3. 验证

```bash
# 手动跑一次
cd ~/feishu-sync/scripts && npx tsx src/sync-to-feishu.ts

# 查看定时任务日志
tail -f /tmp/feisync.log
```

## 手动运行

```bash
cd scripts

# 正常同步
npx tsx src/sync-to-feishu.ts

# 预览模式
DRY_RUN=true npx tsx src/sync-to-feishu.ts

# 强制同步（跳过移除保护）
FORCE_SYNC=true npx tsx src/sync-to-feishu.ts
```

## 飞书认证

脚本通过 [lark-cli](https://github.com/larksuite/cli) 访问飞书 API，使用 OAuth 个人登录。

- **首次使用**：`setup.sh` 会引导你在浏览器中完成飞书 OAuth 登录
- **之后**：只要定时任务正常运行（每天至少跑一次），token 会自动续期，永不过期
- **如果超过 7 天没跑**：需要重新执行 `lark-cli auth login --recommend`

## 注意事项

- **git pull 失败**：如果目标仓库有本地修改导致 pull 失败，脚本会用当前本地状态继续同步
- **移除保护**：如果一次同步中超过 30% 的任务将被标记为"已移除"，脚本会中止并报警
- **飞书表权限**：确保你的飞书账号对目标多维表格有编辑权限
