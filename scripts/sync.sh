#!/bin/bash
# FeiSync 同步脚本
# 流程：clone/pull 目标仓库 → 扫描 specs → 同步到飞书
#
# 手动运行：./scripts/sync.sh
# 定时任务：*/30 * * * * /path/to/Feishu-Sync/scripts/sync.sh >> /tmp/feisync.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPOS_DIR="$SCRIPT_DIR/.repos"

# 加载 .env
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

# 确保工具在 PATH 中
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[feisync] $(date '+%Y-%m-%d %H:%M:%S') 开始同步"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 如果设置了 GITLAB_REPO_URL，自动 clone/pull 到 .repos/ 目录
if [ -n "$GITLAB_REPO_URL" ]; then
  # 从 URL 提取仓库名（如 sproboagent）
  REPO_NAME=$(basename "$GITLAB_REPO_URL" .git)
  REPO_DIR="$REPOS_DIR/$REPO_NAME"
  BRANCH="${GITLAB_BRANCH:-main}"

  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "[feisync] Cloning: $GITLAB_REPO_URL → $REPO_DIR"
    mkdir -p "$REPOS_DIR"
    git clone --branch "$BRANCH" --single-branch --depth 1 "$GITLAB_REPO_URL" "$REPO_DIR" 2>&1 || {
      echo "[ERROR] git clone failed"
      exit 1
    }
  else
    echo "[feisync] git pull: $REPO_DIR"
    git -C "$REPO_DIR" fetch --depth 1 origin "$BRANCH" 2>&1 || true
    git -C "$REPO_DIR" reset --hard "origin/$BRANCH" 2>&1 || true
  fi

  # 覆盖 REPO_ROOT 为 clone 下来的目录
  export REPO_ROOT="$REPO_DIR"

elif [ -n "$REPO_ROOT" ] && [ -d "$REPO_ROOT/.git" ]; then
  echo "[feisync] git pull: $REPO_ROOT"
  git -C "$REPO_ROOT" pull --ff-only --quiet 2>&1 || {
    echo "[WARN] git pull 失败，继续使用当前状态"
  }
else
  echo "[WARN] REPO_ROOT 和 GITLAB_REPO_URL 均未设置"
fi

# 执行同步
cd "$SCRIPT_DIR"
npx tsx src/sync-to-feishu.ts

echo "[feisync] $(date '+%Y-%m-%d %H:%M:%S') 同步完成"
